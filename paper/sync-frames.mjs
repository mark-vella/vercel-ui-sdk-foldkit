import { headerHtml, headerTexts, readTexts } from "./artboards.mjs"
import {
  compareNames,
  componentOf,
  isTooLarge,
  readArtboard,
  readArtboards,
  readPaperFrame,
  shortHash,
  tooLargeReason,
} from "./frames.mjs"
import { PrerequisiteError } from "./pages.mjs"
import { escapeText, formatProvenance, lossesOf } from "./provenance.mjs"
import { readPaperTokens } from "./tokens.mjs"

const columnStyles = {
  width: "fit-content",
  height: "fit-content",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "var(--space-8)",
  padding: "var(--space-8)",
  backgroundColor: "var(--tint)",
}
const layoutKeys = [
  "width",
  "height",
  "left",
  "top",
  "flexDirection",
  "flexWrap",
]
const provenanceStyle =
  "font-family: var(--mono); font-size: var(--text-xs); line-height: var(--leading); color: var(--muted); white-space: pre-wrap"

const assertTokensPresent = async (paper, fileId, captures) => {
  const present = new Set(
    (await readPaperTokens(paper, fileId)).map(({ name }) => name)
  )
  const missing = new Set(
    captures
      .flatMap(({ sidecar }) => sidecar.bindings)
      .map(({ token }) => token)
      .filter((token) => !present.has(token))
  )
  if (missing.size > 0) {
    throw new PrerequisiteError(
      `Paper is missing tokens these frames use (${[...missing].join(", ")}). Run node paper/sync.mjs tokens --file ${fileId} first.`
    )
  }
}

const isInSync = async (paper, fileId, { frame, entry, sidecar }) => {
  if (!frame || entry?.sourceHash !== shortHash(sidecar)) {
    return false
  }
  const { fingerprint } = await readPaperFrame(paper, fileId, frame)
  return entry.fingerprint === fingerprint
}

const repairArtboards = async (paper, fileId, context) => {
  const { artboards, styles, places, write } = context
  if (artboards.length === 0) {
    return
  }
  const { styles: stored } = await paper.call("get_computed_styles", {
    fileId,
    nodeIds: artboards.map(({ id }) => id),
  })
  const updates = artboards.flatMap(({ id, name }) => {
    const wanted = { ...styles, ...places?.get(name) }
    // Paper's computed styles leave out a flex direction or wrap at its default.
    const current = { flexDirection: "row", flexWrap: "nowrap", ...stored[id] }
    const isLaidOut = layoutKeys.every(
      (key) => !(key in wanted) || current[key] === wanted[key]
    )
    return isLaidOut ? [] : [{ nodeIds: [id], styles: wanted }]
  })
  if (updates.length > 0) {
    await write("update_styles", { updates })
    console.log(`artboards laid out again ${updates.length}`)
  }
}

const syncHeader = async (paper, fileId, context) => {
  const { artboard, children, texts, write } = context
  const header = children.find(({ name }) => name === "header")
  if (header) {
    const jsx = await paper.call("get_jsx", {
      fileId,
      nodeId: header.id,
      includeNodeIds: false,
    })
    if (readTexts(jsx).join("\n") === texts.join("\n")) {
      return
    }
  }
  const {
    createdNodes: [written],
  } = await write("write_html", {
    html: headerHtml(texts),
    targetNodeId: header?.id ?? artboard.id,
    mode: header ? "replace" : "insert-children",
  })
  if (!header && children.length > 0) {
    await write("move_nodes", {
      moves: [{ nodeId: written.id, parentId: artboard.id, index: 0 }],
    })
  }
}

const plannedEntries = (recorded, group) => {
  const planned = new Map(recorded)
  for (const { sidecar } of group) {
    planned.set(
      sidecar.name,
      isTooLarge(sidecar)
        ? { skipped: tooLargeReason(sidecar) }
        : { losses: lossesOf(sidecar) }
    )
  }
  return planned
}

const syncFrames = async (paper, fileId, kind) => {
  const { page, sourceOf, captures, board } = kind
  const { pageId, artboards } = await readArtboards(paper, fileId, page)
  await assertTokensPresent(paper, fileId, captures)
  let writes = 0
  const write = (tool, args) => {
    writes++
    return paper.call(tool, { fileId, ...args })
  }
  const groups = Map.groupBy(
    captures.toSorted((a, b) => compareNames(a.sidecar.name, b.sidecar.name)),
    ({ sidecar }) => componentOf(sidecar.name)
  )
  const styles = board?.styles ?? columnStyles
  await repairArtboards(paper, fileId, {
    artboards: artboards.filter(({ name }) => groups.has(name)),
    styles,
    places: board?.places,
    write,
  })
  for (const [component, group] of groups) {
    const writesBefore = writes
    const sourcePath = sourceOf(group[0].sidecar)
    let artboard = artboards.find(({ name }) => name === component)
    if (!artboard) {
      artboard = await write("create_artboard", {
        name: component,
        pageId,
        styles,
      })
      const place = board?.places.get(component)
      if (place) {
        await write("update_styles", {
          updates: [{ nodeIds: [artboard.id], styles: place }],
        })
      }
      console.log(`${component}: artboard created`)
    }
    const { children, provenance, text, recorded } = await readArtboard(
      paper,
      fileId,
      artboard.id
    )
    if (board) {
      await syncHeader(paper, fileId, {
        artboard,
        children,
        texts: headerTexts({
          component,
          sourcePath,
          entries: plannedEntries(recorded, group),
        }),
        write,
      })
    }
    const entries = new Map(recorded)
    for (const { html, sidecar } of group) {
      const { name } = sidecar
      if (isTooLarge(sidecar)) {
        entries.set(name, { skipped: tooLargeReason(sidecar) })
        console.log(`${name}: not imported, ${tooLargeReason(sidecar)}`)
        continue
      }
      const losses = lossesOf(sidecar)
      const frame = children.find((child) => child.name === name)
      const entry = recorded.get(name)
      if (await isInSync(paper, fileId, { frame, entry, sidecar })) {
        entries.set(name, { ...entry, losses })
        console.log(`${name}: unchanged`)
        continue
      }
      const {
        createdNodes: [written],
      } = await write("write_html", {
        html,
        targetNodeId: frame?.id ?? artboard.id,
        mode: frame ? "replace" : "insert-children",
      })
      const next = children.find(
        (child) =>
          child.name.includes("/") &&
          componentOf(child.name) === component &&
          child.name > name
      )
      const before = next ?? provenance
      if (!frame && before) {
        await write("move_nodes", {
          moves: [{ nodeId: written.id, before: before.id }],
        })
      }
      entries.set(name, {
        sourceHash: shortHash(sidecar),
        fingerprint: (await readPaperFrame(paper, fileId, written)).fingerprint,
        commit: sidecar.commit.slice(0, 12),
        dirty: sidecar.dirty,
        losses,
      })
      console.log(
        `${name}: ${frame ? "replaced" : "created"}, ${shortHash(sidecar)}`
      )
    }
    const wanted = formatProvenance(sourcePath, entries)
    if (!provenance) {
      const width = board ? "width: 100%; " : ""
      await write("write_html", {
        html: `<div layer-name="provenance" style="${width}${provenanceStyle}">${escapeText(wanted)}</div>`,
        targetNodeId: artboard.id,
        mode: "insert-children",
      })
    } else if (text !== wanted) {
      await write("set_text_content", {
        updates: [{ nodeId: provenance.id, html: escapeText(wanted) }],
      })
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

export { syncFrames }
