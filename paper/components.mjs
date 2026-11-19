import { copyFile, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { boardStyles, placeBoards } from "./artboards.mjs"
import { launchBrowser } from "./capture.mjs"
import {
  compareNames,
  componentOf,
  isTooLarge,
  readArtboard,
  readArtboards,
  readPaperFrame,
  shortHash,
} from "./frames.mjs"
import { PrerequisiteError } from "./pages.mjs"
import { escapeText, lossesOf } from "./provenance.mjs"
import { checkEmitted, checkExport } from "./roundtrip.mjs"
import { syncFrames } from "./sync-frames.mjs"
import { readCodeTokens } from "./tokens.mjs"

const components = {
  label: "components",
  page: "02 Components",
  outFolder: fileURLToPath(new URL("./out/", import.meta.url)),
  sourceOf: (sidecar) => path.dirname(path.dirname(sidecar.sources[0])),
}
const examplesFolder = fileURLToPath(
  new URL("../examples/components/", import.meta.url)
)

const readCapture = async (name) => {
  const base = path.join(components.outFolder, name)
  const [html, sidecar] = await Promise.all([
    readFile(`${base}.html`, "utf8"),
    readFile(`${base}.json`, "utf8"),
  ]).catch((error) => {
    if (error.code !== "ENOENT") {
      throw error
    }
    throw new PrerequisiteError(
      `${name} isn't captured. Run \`scripts/test-slot.sh node paper/capture.mjs ${name}\` first.`
    )
  })
  return { html: html.trim(), sidecar: JSON.parse(sidecar) }
}

const listCaptureNames = async () => {
  const folders = await readdir(examplesFolder)
  const names = await Promise.all(
    folders.map(async (component) => {
      const files = await readdir(
        path.join(components.outFolder, component)
      ).catch((error) => {
        if (error.code !== "ENOENT") {
          throw error
        }
        return []
      })
      return files
        .filter((file) => /^[^.]+\.json$/.test(file))
        .map((file) => `${component}/${file.slice(0, -".json".length)}`)
    })
  )
  return names.flat().toSorted(compareNames)
}

const readSpace = async () => {
  const { tokens } = await readCodeTokens()
  return Number.parseFloat(
    tokens.find(({ name }) => name === "--space-8").value
  )
}

const emittedHeight = (sidecar) => {
  const size = sidecar.unsupported.find(
    ({ layer, property }) => layer === sidecar.name && property === "size"
  )
  return size
    ? Number(size.value.match(/x([\d.]+) in the emitted HTML/)[1])
    : sidecar.frame.height
}

const layoutCatalogue = async (space) => {
  const sidecars = await Promise.all(
    (await listCaptureNames()).map(async (name) =>
      JSON.parse(
        await readFile(path.join(components.outFolder, `${name}.json`), "utf8")
      )
    )
  )
  const boards = [
    ...Map.groupBy(sidecars, ({ name }) => componentOf(name)),
  ].map(([component, group]) => ({
    component,
    frameHeights: group
      .filter((sidecar) => !isTooLarge(sidecar))
      .map(emittedHeight),
    lines: group.map(
      (sidecar) =>
        sidecar.name.length + 48 + lossesOf(sidecar).join(", ").length
    ),
  }))
  return placeBoards(boards, space)
}

const syncComponents = async (paper, fileId, names) => {
  const space = await readSpace()
  await syncFrames(paper, fileId, {
    ...components,
    captures: await Promise.all(names.map(readCapture)),
    board: { styles: boardStyles(space), places: await layoutCatalogue(space) },
  })
}

const saveScreenshot = async (paper, fileId, { frame, sidecar, outFolder }) => {
  const { exports } = await paper.call("export", {
    fileId,
    nodes: { [frame.id]: [{ format: "png", scale: "2x" }] },
  })
  const target = path.join(outFolder, `${sidecar.name}.paper.png`)
  await copyFile(exports[0].filePath, target)
  await rm(exports[0].filePath)
  console.log(
    `${sidecar.name}: Paper screenshot ${path.relative(process.cwd(), target)}`
  )
}

const subjects = [
  /^layer \d+ is (.+) in Paper's export, missing in capture$/,
  /^layer \d+ is .+ in Paper's export, (.+) in capture$/,
  /^(.+?): [\w-]+ (?:is bound to|has the literal) /,
  /^(.+) is [\d.]+x[\d.]+ in Paper's export/,
  /^(.+) looks different in Paper's export/,
  /^(.+) is hidden in Paper$/,
]
const effects = new Set(["size", "picture"])

const followsFromLoss = (text, { layers, unsupported }) => {
  const subject = subjects
    .map((pattern) => text.match(pattern)?.[1])
    .find(Boolean)
  if (!subject) {
    return false
  }
  if (
    text.includes(" looks different in Paper's export") &&
    unsupported.some(({ property }) => property === "picture")
  ) {
    return true
  }
  const names = new Set(layers.map(({ layer }) => layer.split(" > ").at(-1)))
  const named = (path) =>
    path
      .split(" > ")
      .filter((segment) => names.has(segment))
      .join(" > ")
  const path = named(subject)
  return unsupported.some(({ layer, property }) => {
    const cause = named(layer)
    return (
      !effects.has(property) &&
      (path === cause || path.startsWith(`${cause} > `))
    )
  })
}

const unexplained = async (browser, context, differences) => {
  const { sidecar, html, tokens } = context
  if (lossesOf(sidecar).length === 0) {
    return differences
  }
  const offline = await checkEmitted(browser, { sidecar, html, tokens })
  const explained = new Set([
    ...offline.map((text) =>
      text.replaceAll("the emitted HTML", "Paper's export")
    ),
    ...sidecar.unsupported.map(
      ({ layer, property, value }) =>
        `${layer}: ${property} ${value} is not imported`
    ),
  ])
  return differences.filter(
    (text) => !explained.has(text) && !followsFromLoss(text, sidecar)
  )
}

const unrecordedOnly = (differences) => ({
  differences,
  unrecorded: differences,
})

const verifyFrame = async (paper, fileId, context) => {
  const { artboards, browser, sidecar, outFolder } = context
  const component = componentOf(sidecar.name)
  const artboard = artboards.find(({ name }) => name === component)
  if (!artboard) {
    return unrecordedOnly([`no artboard named ${component}`])
  }
  const { children, recorded } = await readArtboard(paper, fileId, artboard.id)
  const entry = recorded.get(sidecar.name)
  if (entry?.skipped && isTooLarge(sidecar)) {
    return { differences: [`not imported, ${entry.skipped}`], unrecorded: [] }
  }
  const frames = children.filter(({ name }) => name === sidecar.name)
  if (frames.length === 0) {
    return unrecordedOnly([`no frame named ${sidecar.name} in ${component}`])
  }
  if (frames.length > 1) {
    return unrecordedOnly([
      `${frames.length} frames are named ${sidecar.name}. Sync never deletes, so remove the copies in Paper.`,
    ])
  }
  const provenance = []
  const { jsx, tree, fingerprint } = await readPaperFrame(
    paper,
    fileId,
    frames[0]
  )
  const sourceHash = shortHash(sidecar)
  if (entry?.sourceHash !== sourceHash) {
    provenance.push(
      `provenance records ${entry?.sourceHash ?? "no hash"}, capture is ${sourceHash}`
    )
  } else if (entry.fingerprint !== fingerprint) {
    provenance.push("the frame was edited in Paper after the last sync")
  }
  const [listed, losses] = [entry?.losses ?? [], lossesOf(sidecar)].map(
    (kinds) => kinds.join(", ") || "nothing"
  )
  if (entry && listed !== losses) {
    provenance.push(
      `provenance lists ${listed} as lost, capture records ${losses}`
    )
  }
  const found = await checkExport(browser, { ...context, jsx, tree })
  await saveScreenshot(paper, fileId, {
    frame: frames[0],
    sidecar,
    outFolder,
  })
  return {
    differences: [...provenance, ...found],
    unrecorded: [
      ...provenance,
      ...(await unexplained(browser, context, found)),
    ],
  }
}

const verifyFrames = async (paper, fileId, context) => {
  const { label, page, outFolder, captures, browser, tokens } = context
  const { artboards } = await readArtboards(paper, fileId, page)
  const differences = []
  const kinds = { exact: 0, recorded: 0, unrecorded: [] }
  for (const { sidecar, html } of captures) {
    const found = await verifyFrame(paper, fileId, {
      artboards,
      browser,
      tokens,
      sidecar,
      html,
      outFolder,
    })
    differences.push(
      ...found.differences.map((text) => `${sidecar.name}: ${text}`)
    )
    if (found.unrecorded.length > 0) {
      kinds.unrecorded.push(sidecar.name)
    } else if (
      found.differences.length === 0 &&
      lossesOf(sidecar).length === 0
    ) {
      kinds.exact++
    } else {
      kinds.recorded++
    }
  }
  const notes = captures.flatMap(({ sidecar }) =>
    sidecar.unbound.map(
      ({ layer, property, value }) =>
        `${sidecar.name}: note, ${layer}: ${property} ${value} is bound to no token`
    )
  )
  for (const line of [...differences, ...notes]) {
    console.log(line)
  }
  console.log(
    `${label}: ${captures.length} checked, ${differences.length} differences, ${notes.length} unbound`
  )
  console.log(
    `${label}: ${kinds.exact} match with nothing recorded, ${kinds.recorded} differ only by recorded losses, ${kinds.unrecorded.length} differ in a way nothing records`
  )
  if (kinds.unrecorded.length > 0) {
    console.log(`unrecorded: ${kinds.unrecorded.join(", ")}`)
  }
  return differences.length === 0
}

const verifyComponents = async (paper, fileId, names) => {
  const captures = await Promise.all(names.map(readCapture))
  const { tokens } = await readCodeTokens()
  const browser = await launchBrowser()
  try {
    return await verifyFrames(paper, fileId, {
      ...components,
      captures,
      browser,
      tokens,
    })
  } finally {
    await browser.close()
  }
}

export {
  escapeText,
  followsFromLoss,
  listCaptureNames,
  syncComponents,
  syncFrames,
  verifyComponents,
  verifyFrame,
  verifyFrames,
}
