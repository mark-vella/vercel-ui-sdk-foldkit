import assert from "node:assert/strict"
import { test } from "node:test"
import { syncFrames, verifyFrame } from "../components.mjs"

const writeTools = new Set([
  "create_artboard",
  "update_styles",
  "write_html",
  "move_nodes",
  "set_text_content",
])

const fakePaper = ({ tokens }) => {
  const state = { tokens, writes: [], nodes: new Map(), artboards: [] }
  let nextId = 1
  const unescape = (text) =>
    text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  const store = (html) => {
    const node = {
      id: `${nextId++}-0`,
      name: html.match(/layer-name="([^"]+)"/)[1],
      html: html.replace(/var\((--[\w-]+)\)/g, (bound, token) =>
        state.tokens.includes(token) ? bound : "#000000"
      ),
    }
    state.nodes.set(node.id, node)
    return node
  }
  const tools = {
    get_basic_info: ({ pageId }) =>
      pageId
        ? { artboards: state.artboards }
        : { pages: [{ type: "page", id: "p-3-0", name: "02 Components" }] },
    get_tokens: () => ({ tokens: state.tokens.map((name) => ({ name })) }),
    create_artboard: ({ name }) => {
      const artboard = { id: `${nextId++}-0`, name, children: [] }
      state.artboards.push(artboard)
      return artboard
    },
    get_children: ({ nodeId }) => ({
      children: state.artboards
        .find(({ id }) => id === nodeId)
        .children.map((id) => state.nodes.get(id)),
    }),
    get_node_info: ({ nodeId }) => ({
      textContent: unescape(
        state.nodes.get(nodeId).html.replace(/<[^>]+>/g, "")
      ),
    }),
    get_jsx: ({ nodeId }) => state.nodes.get(nodeId).html,
    get_tree_summary: ({ nodeId }) => ({
      summary: `Frame "${state.nodes.get(nodeId).name}" (${nodeId}) 10×10`,
    }),
    write_html: ({ html, targetNodeId, mode }) => {
      const node = store(html)
      if (mode === "replace") {
        state.nodes.delete(targetNodeId)
        node.id = targetNodeId
        state.nodes.set(targetNodeId, node)
      } else {
        state.artboards
          .find(({ id }) => id === targetNodeId)
          .children.push(node.id)
      }
      return { createdNodes: [node] }
    },
    set_text_content: ({ updates: [{ nodeId, html }] }) => {
      state.nodes.get(nodeId).html =
        `<div layer-name="provenance">${html}</div>`
    },
    update_styles: () => ({}),
    move_nodes: () => ({}),
    finish_working_on_nodes: () => ({}),
  }
  const call = async (tool, args) => {
    if (writeTools.has(tool)) {
      state.writes.push(tool)
    }
    return tools[tool](args)
  }
  return { state, call }
}

const buttonCapture = {
  html: '<div layer-name="button/basic" style="color: var(--ink)"></div>',
  sidecar: {
    name: "button/basic",
    hash: "a".repeat(64),
    commit: "b".repeat(40),
    dirty: false,
    sources: ["examples/components/button/web/basic.html"],
    bindings: [{ layer: "button/basic", property: "color", token: "--ink" }],
  },
}

const syncButton = (paper) =>
  syncFrames(paper, "file", {
    page: "02 Components",
    sourceOf: () => "examples/components/button",
    captures: [buttonCapture],
  })

const syncQuietly = async (paper) => {
  const { log } = console
  console.log = () => {}
  try {
    await syncButton(paper)
  } finally {
    console.log = log
  }
}

test("reports two frames with one name and how to fix it", async () => {
  const paper = {
    call: async (tool) => {
      assert.equal(tool, "get_children")
      return {
        children: [
          { id: "1", name: "button/basic" },
          { id: "2", name: "button/basic" },
        ],
      }
    },
  }
  const context = {
    artboards: [{ id: "0", name: "button" }],
    sidecar: { name: "button/basic" },
  }
  assert.deepEqual(await verifyFrame(paper, "file", context), [
    "2 frames are named button/basic. Sync never deletes, so remove the copies in Paper.",
  ])
})

test("writes nothing to a file that lacks a token the frames use", async () => {
  const paper = fakePaper({ tokens: ["--space-8"] })
  await assert.rejects(syncQuietly(paper), {
    message:
      "Paper is missing tokens these frames use (--ink). Run node paper/sync.mjs tokens --file file first.",
  })
  assert.deepEqual(paper.state.writes, [])
})

const frameHtml = (paper) =>
  [...paper.state.nodes.values()].find(({ name }) => name === "button/basic")
    .html

test("writes the frame bound to its tokens when Paper has them", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  await syncQuietly(paper)
  assert.deepEqual(
    [paper.state.writes, frameHtml(paper)],
    [
      ["create_artboard", "update_styles", "write_html", "write_html"],
      '<div layer-name="button/basic" style="color: var(--ink)"></div>',
    ]
  )
})

test("rewrites a frame synced before Paper had its tokens, then stays", async () => {
  const paper = fakePaper({ tokens: [] })
  const { call } = paper
  paper.call = (tool, args) =>
    tool === "get_tokens" ? { tokens: [{ name: "--ink" }] } : call(tool, args)
  await syncQuietly(paper)
  paper.call = call
  paper.state.tokens = ["--ink"]
  const writesOfNextSync = async () => {
    paper.state.writes = []
    await syncQuietly(paper)
    return paper.state.writes
  }
  assert.deepEqual(
    [await writesOfNextSync(), await writesOfNextSync(), frameHtml(paper)],
    [
      ["write_html", "set_text_content"],
      [],
      '<div layer-name="button/basic" style="color: var(--ink)"></div>',
    ]
  )
})
