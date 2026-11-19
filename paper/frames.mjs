import { createHash } from "node:crypto"
import { findPageId } from "./pages.mjs"
import { parseProvenance } from "./provenance.mjs"
import { flattenTree, parseTree } from "./roundtrip.mjs"

const maxLayers = 2500

const componentOf = (name) => name.split("/")[0]
const compareNames = (a, b) => {
  const [first, second] = [componentOf(a), componentOf(b)]
  if (first !== second) {
    return first < second ? -1 : 1
  }
  return a < b ? -1 : a > b ? 1 : 0
}

const shortHash = (sidecar) => sidecar.hash.slice(0, 12)
const isTooLarge = (sidecar) => sidecar.layers.length > maxLayers
const tooLargeReason = (sidecar) =>
  `${sidecar.layers.length} layers, above the ${maxLayers} Paper takes`

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

const readArtboards = async (paper, fileId, page) => {
  const pageId = await findPageId(paper, fileId, page)
  const { artboards } = await paper.call("get_basic_info", { fileId, pageId })
  return { pageId, artboards }
}

const readArtboard = async (paper, fileId, artboardId) => {
  const { children } = await paper.call("get_children", {
    fileId,
    nodeId: artboardId,
  })
  const provenance = children.find(({ name }) => name === "provenance")
  const text = provenance
    ? (await paper.call("get_node_info", { fileId, nodeId: provenance.id }))
        .textContent
    : ""
  return { children, provenance, text, recorded: parseProvenance(text) }
}

export {
  compareNames,
  componentOf,
  isTooLarge,
  readArtboard,
  readArtboards,
  readPaperFrame,
  shortHash,
  tooLargeReason,
}
