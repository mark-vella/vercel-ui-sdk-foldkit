import { createHash } from "node:crypto"
import { copyFile, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { launchBrowser } from "./capture.mjs"
import { checkExport, flattenTree, parseTree } from "./roundtrip.mjs"
import { readCodeTokens } from "./tokens.mjs"

const outFolder = fileURLToPath(new URL("./out/", import.meta.url))
const artboardStyles = {
  width: "400px",
  height: "400px",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "var(--space-8)",
  padding: "var(--space-8)",
  backgroundColor: "var(--tint)",
}
const provenanceStyle =
  "font-family: var(--mono); font-size: var(--text-xs); line-height: var(--leading); color: var(--muted); white-space: pre-wrap"

const readCapture = async (name) => {
  const base = path.join(outFolder, name)
  const [html, sidecar] = await Promise.all([
    readFile(`${base}.html`, "utf8"),
    readFile(`${base}.json`, "utf8"),
  ])
  return { html: html.trim(), sidecar: JSON.parse(sidecar) }
}

const componentOf = (name) => name.split("/")[0]
const shortHash = (sidecar) => sidecar.hash.slice(0, 12)
const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const formatProvenance = (sidecar, hashes) => {
  const [example] = sidecar.sources
  const commit = `${sidecar.commit.slice(0, 12)}${sidecar.dirty ? " with uncommitted changes" : ""}`
  return [
    `source ${path.dirname(path.dirname(example))}`,
    `commit ${commit}`,
    ...[...hashes]
      .sort()
      .map(([name, { source, paper }]) => `${name} ${source} ${paper}`),
  ].join("\n")
}

const parseProvenance = (text) =>
  new Map(
    [...text.matchAll(/^(\S+\/\S+) ([0-9a-f]{12}) ([0-9a-f]{12})$/gm)].map(
      ([, name, source, paper]) => [name, { source, paper }]
    )
  )

const readTree = async (paper, fileId, nodeId) => {
  const { summary } = await paper.call("get_tree_summary", {
    fileId,
    nodeId,
    depth: 10,
  })
  const tree = parseTree(summary)
  for (const node of flattenTree(tree).filter(({ isElided }) => isElided)) {
    node.children = (await readTree(paper, fileId, node.id)).children
  }
  return tree
}

const readPaperFrame = async (paper, fileId, frame) => {
  const jsx = await paper.call("get_jsx", {
    fileId,
    nodeId: frame.id,
    includeNodeIds: false,
  })
  const tree = await readTree(paper, fileId, frame.id)
  const fingerprint = createHash("sha256")
    .update([jsx, ...flattenTree(tree).map(({ name }) => name)].join("\n"))
    .digest("hex")
    .slice(0, 12)
  return { jsx, tree, fingerprint }
}

const readArtboards = async (paper, fileId) => {
  const info = await paper.call("get_basic_info", { fileId })
  const page = info.pages.find(({ type }) => type === "page")
  const { artboards } =
    page.id === info.pageId
      ? info
      : await paper.call("get_basic_info", { fileId, pageId: page.id })
  return { pageId: page.id, artboards }
}

const readArtboard = async (paper, fileId, artboardId) => {
  const { children } = await paper.call("get_children", {
    fileId,
    nodeId: artboardId,
  })
  const provenance = children.find(({ name }) => name === "provenance")
  const recorded = provenance
    ? parseProvenance(
        (await paper.call("get_node_info", { fileId, nodeId: provenance.id }))
          .textContent
      )
    : new Map()
  return { children, provenance, recorded }
}

const syncComponents = async (paper, fileId, names) => {
  const captures = await Promise.all(names.map(readCapture))
  const { pageId, artboards } = await readArtboards(paper, fileId)
  let writes = 0
  const write = (tool, args) => {
    writes++
    return paper.call(tool, { fileId, ...args })
  }
  const groups = Map.groupBy(captures, ({ sidecar }) =>
    componentOf(sidecar.name)
  )
  for (const [component, group] of groups) {
    const writesBefore = writes
    let artboard = artboards.find(({ name }) => name === component)
    if (!artboard) {
      artboard = await write("create_artboard", {
        name: component,
        pageId,
        styles: artboardStyles,
      })
      await write("update_styles", {
        updates: [
          {
            nodeIds: [artboard.id],
            styles: { width: "fit-content", height: "fit-content" },
          },
        ],
      })
      console.log(`${component}: artboard created`)
    }
    const { children, provenance, recorded } = await readArtboard(
      paper,
      fileId,
      artboard.id
    )
    const hashes = new Map(recorded)
    for (const { html, sidecar } of group) {
      const source = shortHash(sidecar)
      const frame = children.find(({ name }) => name === sidecar.name)
      const entry = recorded.get(sidecar.name)
      if (
        frame &&
        entry?.source === source &&
        entry.paper === (await readPaperFrame(paper, fileId, frame)).fingerprint
      ) {
        console.log(`${sidecar.name}: unchanged`)
        continue
      }
      const {
        createdNodes: [written],
      } = await write("write_html", {
        html,
        targetNodeId: frame?.id ?? artboard.id,
        mode: frame ? "replace" : "insert-children",
      })
      if (!frame && provenance) {
        await write("move_nodes", {
          moves: [{ nodeId: written.id, before: provenance.id }],
        })
      }
      hashes.set(sidecar.name, {
        source,
        paper: (await readPaperFrame(paper, fileId, written)).fingerprint,
      })
      console.log(
        `${sidecar.name}: ${frame ? "replaced" : "created"}, ${source}`
      )
    }
    if (writes > writesBefore) {
      const text = escapeText(formatProvenance(group[0].sidecar, hashes))
      if (provenance) {
        await write("set_text_content", {
          updates: [{ nodeId: provenance.id, html: text }],
        })
      } else {
        await write("write_html", {
          html: `<div layer-name="provenance" style="${provenanceStyle}">${text}</div>`,
          targetNodeId: artboard.id,
          mode: "insert-children",
        })
      }
    }
    if (provenance && children.at(-1).id !== provenance.id) {
      await write("move_nodes", {
        moves: [{ nodeId: provenance.id, parentId: artboard.id }],
      })
    }
    if (writes > writesBefore) {
      await paper.call("finish_working_on_nodes", {
        fileId,
        nodeIds: [artboard.id],
      })
    }
  }
  console.log(`writes ${writes}`)
}

const saveScreenshot = async (paper, fileId, frame, sidecar) => {
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

const verifyFrame = async (paper, fileId, context) => {
  const { artboards, browser, tokens, sidecar } = context
  const component = componentOf(sidecar.name)
  const artboard = artboards.find(({ name }) => name === component)
  if (!artboard) {
    return [`no artboard named ${component}`]
  }
  const { children, recorded } = await readArtboard(paper, fileId, artboard.id)
  const frames = children.filter(({ name }) => name === sidecar.name)
  if (frames.length === 0) {
    return [`no frame named ${sidecar.name} in ${component}`]
  }
  if (frames.length > 1) {
    return [
      `${frames.length} frames are named ${sidecar.name}. Sync never deletes, so remove the copies in Paper.`,
    ]
  }
  const differences = []
  const { jsx, tree, fingerprint } = await readPaperFrame(
    paper,
    fileId,
    frames[0]
  )
  const source = shortHash(sidecar)
  const entry = recorded.get(sidecar.name)
  if (entry?.source !== source) {
    differences.push(
      `provenance records ${entry?.source ?? "no hash"}, capture is ${source}`
    )
  } else if (entry.paper !== fingerprint) {
    differences.push("the frame was edited in Paper after the last sync")
  }
  differences.push(
    ...(await checkExport(browser, { jsx, tree, sidecar, tokens }))
  )
  await saveScreenshot(paper, fileId, frames[0], sidecar)
  return differences
}

const verifyComponents = async (paper, fileId, names) => {
  const captures = await Promise.all(names.map(readCapture))
  const { artboards } = await readArtboards(paper, fileId)
  const { tokens } = await readCodeTokens()
  const browser = await launchBrowser()
  const differences = []
  try {
    for (const { sidecar } of captures) {
      const found = await verifyFrame(paper, fileId, {
        artboards,
        browser,
        tokens,
        sidecar,
      })
      differences.push(...found.map((text) => `${sidecar.name}: ${text}`))
    }
  } finally {
    await browser.close()
  }
  for (const difference of differences) {
    console.log(difference)
  }
  console.log(
    `components: ${captures.length} checked, ${differences.length} differences`
  )
  return differences.length === 0
}

export { syncComponents, verifyComponents, verifyFrame }
