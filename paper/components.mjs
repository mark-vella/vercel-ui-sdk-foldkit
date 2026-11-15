import { createHash } from "node:crypto"
import { copyFile, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readPaperTokens } from "./tokens.mjs"

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
const camelCase = (property) =>
  property.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())

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

const readSubtree = async (paper, fileId, node) => {
  if (node.childCount === 0) {
    return [node]
  }
  const { children } = await paper.call("get_children", {
    fileId,
    nodeId: node.id,
  })
  const descendants = []
  for (const child of children) {
    descendants.push(...(await readSubtree(paper, fileId, child)))
  }
  return [node, ...descendants]
}

const readPaperFrame = async (paper, fileId, frame) => {
  const jsx = await paper.call("get_jsx", {
    fileId,
    nodeId: frame.id,
    includeNodeIds: false,
  })
  const nodes = await readSubtree(paper, fileId, frame)
  const fingerprint = createHash("sha256")
    .update([jsx, ...nodes.map(({ name }) => name)].join("\n"))
    .digest("hex")
    .slice(0, 12)
  return { nodes, fingerprint }
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

const checkLayers = async (paper, fileId, nodes, sidecar, differ) => {
  const expected = sidecar.layers.map(({ name }) => name)
  const expectedNames = new Set(expected)
  const found = nodes.filter(({ name }) => expectedNames.has(name))
  if (found.map(({ name }) => name).join() !== expected.join()) {
    differ(
      `layers are [${found.map(({ name }) => name).join(", ")}] in Paper, [${expected.join(", ")}] in capture`
    )
    return
  }
  let largest = 0
  for (const [index, layer] of sidecar.layers.entries()) {
    const { width, height } = await paper.call("get_node_info", {
      fileId,
      nodeId: found[index].id,
    })
    const [widthDelta, heightDelta] = [
      Math.abs(width - layer.width),
      Math.abs(height - layer.height),
    ]
    largest = Math.max(largest, widthDelta, heightDelta)
    if (
      widthDelta > Math.max(1, layer.textColumns) ||
      heightDelta > Math.max(1, layer.textRows)
    ) {
      differ(
        `${layer.name} is ${width}x${height} in Paper, ${layer.width}x${layer.height} in capture`
      )
    }
  }
  console.log(
    `${sidecar.name}: ${found.length} layers, largest size delta ${largest.toFixed(3)}px`
  )
}

const tally = (keys) =>
  keys.reduce(
    (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1),
    new Map()
  )

const checkBindings = async (paper, fileId, frame, sidecar, differ) => {
  const expected = tally(
    sidecar.bindings.map(
      ({ token, property }) => `${token} ${camelCase(property)}`
    )
  )
  const found = []
  for (const token of new Set(sidecar.bindings.map(({ token }) => token))) {
    const { nodes } = await paper.call("find_nodes", {
      fileId,
      nodeId: frame.id,
      filters: [{ styleValue: token }],
    })
    for (const { matched } of nodes) {
      for (const { styleName, styleValue } of matched) {
        if (styleValue === `var(${token})`) {
          found.push(`${token} ${styleName}`)
        }
      }
    }
  }
  const actual = tally(found)
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const [inCapture = 0, inPaper = 0] = [expected.get(key), actual.get(key)]
    if (inCapture !== inPaper) {
      differ(
        `${key}: bound on ${inPaper} nodes in Paper, ${inCapture} in capture`
      )
    }
  }
}

const checkLiteralColors = async (
  paper,
  fileId,
  { frame, tokens, sidecar },
  differ
) => {
  const values = new Set(
    tokens
      .filter(
        ({ type, value }) => type === "color" && !value.startsWith("var(")
      )
      .map(({ value }) => value)
  )
  for (const value of values) {
    const { nodes } = await paper.call("find_nodes", {
      fileId,
      nodeId: frame.id,
      filters: [{ styleValue: value }],
    })
    const literals = nodes.flatMap(({ name, matched }) =>
      matched
        .filter(({ styleValue }) => !styleValue.startsWith("var("))
        .map(({ styleName }) => `${name} ${styleName}`)
    )
    const authored = sidecar.literals.filter(
      (literal) => literal.value === value
    ).length
    if (literals.length !== authored) {
      differ(
        `${value} is a literal on ${literals.length} styles in Paper (${literals.join(", ")}), ${authored} in capture`
      )
    }
  }
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

const verifyComponents = async (paper, fileId, names) => {
  const captures = await Promise.all(names.map(readCapture))
  const { artboards } = await readArtboards(paper, fileId)
  const tokens = await readPaperTokens(paper, fileId)
  const differences = []
  for (const { sidecar } of captures) {
    const differ = (message) => differences.push(`${sidecar.name}: ${message}`)
    const component = componentOf(sidecar.name)
    const artboard = artboards.find(({ name }) => name === component)
    if (!artboard) {
      differ(`no artboard named ${component}`)
      continue
    }
    const { children, recorded } = await readArtboard(
      paper,
      fileId,
      artboard.id
    )
    const frame = children.find(({ name }) => name === sidecar.name)
    if (!frame) {
      differ(`no frame named ${sidecar.name} in ${component}`)
      continue
    }
    const source = shortHash(sidecar)
    const entry = recorded.get(sidecar.name)
    const { nodes, fingerprint } = await readPaperFrame(paper, fileId, frame)
    if (entry?.source !== source) {
      differ(
        `provenance records ${entry?.source ?? "no hash"}, capture is ${source}`
      )
    } else if (entry.paper !== fingerprint) {
      differ("the frame was edited in Paper after the last sync")
    }
    await checkLayers(paper, fileId, nodes, sidecar, differ)
    await checkBindings(paper, fileId, frame, sidecar, differ)
    await checkLiteralColors(paper, fileId, { frame, tokens, sidecar }, differ)
    await saveScreenshot(paper, fileId, frame, sidecar)
  }
  for (const difference of differences) {
    console.log(difference)
  }
  console.log(
    `components: ${captures.length} checked, ${differences.length} differences`
  )
  return differences.length === 0
}

export { syncComponents, verifyComponents }
