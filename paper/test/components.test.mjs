import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { boardStyles } from "../artboards.mjs"
import {
  followsFromLoss,
  syncFrames,
  verifyFrame,
  verifyFrames,
} from "../components.mjs"
import { formatProvenance, parseProvenance } from "../provenance.mjs"

const writeTools = new Set([
  "create_artboard",
  "update_styles",
  "write_html",
  "move_nodes",
  "set_text_content",
])

const unescape = (text) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

const fakePaper = ({ tokens }) => {
  const state = { tokens, writes: [], nodes: new Map(), artboards: [] }
  let nextId = 1
  const boardOf = (id) => state.artboards.find((board) => board.id === id)
  const parentOf = (id) =>
    state.artboards.find(({ children }) => children.includes(id))
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
    create_artboard: ({ name, styles }) => {
      const artboard = {
        id: `${nextId++}-0`,
        name,
        styles: { ...styles },
        children: [],
      }
      state.artboards.push(artboard)
      return artboard
    },
    get_computed_styles: ({ nodeIds }) => ({
      styles: Object.fromEntries(
        nodeIds.map((id) => [id, { ...boardOf(id).styles }])
      ),
    }),
    update_styles: ({ updates }) => {
      for (const { nodeIds, styles } of updates) {
        for (const id of nodeIds) {
          Object.assign(boardOf(id).styles, styles)
        }
      }
      return {}
    },
    get_children: ({ nodeId }) => ({
      children: boardOf(nodeId).children.map((id) => state.nodes.get(id)),
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
        boardOf(targetNodeId).children.push(node.id)
      }
      return { createdNodes: [node] }
    },
    set_text_content: ({ updates: [{ nodeId, html }] }) => {
      state.nodes.get(nodeId).html =
        `<div layer-name="provenance">${html}</div>`
    },
    move_nodes: ({ moves }) => {
      for (const { nodeId, before, parentId, index } of moves) {
        const from = parentOf(nodeId).children
        from.splice(from.indexOf(nodeId), 1)
        const to = before
          ? parentOf(before).children
          : boardOf(parentId).children
        const at = before ? to.indexOf(before) : (index ?? to.length)
        to.splice(at, 0, nodeId)
      }
      return {}
    },
    finish_working_on_nodes: () => ({}),
  }
  const call = async (tool, args) => {
    if (writeTools.has(tool)) {
      if (state.writes.length === state.stopAfter) {
        throw new Error("Paper stopped")
      }
      state.writes.push(tool)
    }
    return tools[tool](args)
  }
  return { state, call }
}

const captureOf = (
  name,
  { unsupported = [], unbound = [], layers = 1 } = {}
) => ({
  html: `<div layer-name="${name}" style="color: var(--ink)"></div>`,
  sidecar: {
    name,
    hash: createHash("sha256").update(name).digest("hex"),
    commit: "b".repeat(40),
    dirty: false,
    sources: [`examples/components/${name.split("/")[0]}/web/x.html`],
    layers: Array.from({ length: layers }, () => ({})),
    bindings: [{ layer: name, property: "color", token: "--ink" }],
    unsupported,
    unbound,
  },
})

const buttonCapture = captureOf("button/basic")

const quietly = async (run) => {
  const lines = []
  const { log } = console
  console.log = (line) => lines.push(line)
  try {
    await run()
  } finally {
    console.log = log
  }
  return lines
}

const places = new Map([
  ["button", { left: "0px", top: "0px" }],
  ["select", { left: "1968px", top: "0px" }],
])

const sync = (paper, captures, { board = true } = {}) =>
  quietly(() =>
    syncFrames(paper, "file", {
      page: "02 Components",
      sourceOf: (sidecar) =>
        `examples/components/${sidecar.name.split("/")[0]}`,
      captures,
      board: board ? { styles: boardStyles(32), places } : undefined,
    })
  )

const writesOfNextSync = async (paper, captures, options) => {
  paper.state.writes = []
  await sync(paper, captures, options)
  return paper.state.writes
}

const childNames = (paper, artboard) =>
  paper.state.artboards
    .find(({ name }) => name === artboard)
    .children.map((id) => paper.state.nodes.get(id).name)

const textOf = (paper, name) =>
  unescape(
    [...paper.state.nodes.values()]
      .find((node) => node.name === name)
      .html.replace(/<[^>]+>/g, "\n")
      .replace(/\n+/g, "\n")
      .trim()
  )

const selectCaptures = [
  captureOf("select/rtl", {
    unsupported: [
      { layer: "select/rtl", property: "size", value: "1x1" },
      { layer: "select/rtl", property: "picture", value: "1x1 at 0,0" },
    ],
    unbound: [{ layer: "select/rtl", property: "gap", value: "3px" }],
  }),
  captureOf("select/basic"),
  captureOf("select/huge", { layers: 2501 }),
]

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
  const message =
    "2 frames are named button/basic. Sync never deletes, so remove the copies in Paper."
  assert.deepEqual(await verifyFrame(paper, "file", context), {
    differences: [message],
    unrecorded: [message],
  })
})

test("writes nothing to a file that lacks a token the frames use", async () => {
  const paper = fakePaper({ tokens: ["--space-8"] })
  await assert.rejects(sync(paper, [buttonCapture]), {
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
  await sync(paper, [buttonCapture], { board: false })
  assert.deepEqual(
    [paper.state.writes, frameHtml(paper)],
    [
      ["create_artboard", "write_html", "write_html"],
      '<div layer-name="button/basic" style="color: var(--ink)"></div>',
    ]
  )
})

test("keeps a frame whose binding Paper drops, and writes it once", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  const { call } = paper
  paper.call = (tool, args) =>
    tool === "write_html"
      ? call(tool, {
          ...args,
          html: args.html.replace("var(--ink)", "#171717"),
        })
      : call(tool, args)
  await sync(paper, [buttonCapture], { board: false })
  assert.deepEqual(
    [
      await writesOfNextSync(paper, [buttonCapture], { board: false }),
      frameHtml(paper),
    ],
    [[], '<div layer-name="button/basic" style="color: #171717"></div>']
  )
})

test("syncs components and their frames in alphabetical order", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  const lines = await sync(paper, [...selectCaptures, buttonCapture])
  assert.deepEqual(
    [
      paper.state.artboards.map(({ name }) => name),
      childNames(paper, "select"),
      lines.filter((line) => line.startsWith("select/")),
    ],
    [
      ["button", "select"],
      ["header", "select/basic", "select/rtl", "provenance"],
      [
        "select/basic: created, 7ae43f2070f0",
        "select/huge: not imported, 2501 layers, above the 2500 Paper takes",
        "select/rtl: created, 74bb0870d248",
      ],
    ]
  )
})

test("records each frame's commit and losses, and a frame it did not import", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  await sync(paper, selectCaptures)
  const text = textOf(paper, "provenance")
  const fingerprint = text.match(/select\/basic \w+ (\w+)/)[1]
  const rtlFingerprint = text.match(/select\/rtl \w+ (\w+)/)[1]
  assert.equal(
    text,
    [
      "source examples/components/select",
      "frame, capture hash, Paper fingerprint, commit it was captured at, losses",
      `select/basic 7ae43f2070f0 ${fingerprint} bbbbbbbbbbbb exact`,
      "select/huge not imported, 2501 layers, above the 2500 Paper takes",
      `select/rtl 74bb0870d248 ${rtlFingerprint} bbbbbbbbbbbb loses picture, size, unbound token`,
    ].join("\n")
  )
  assert.deepEqual(
    [...parseProvenance(text)],
    [
      [
        "select/basic",
        {
          sourceHash: "7ae43f2070f0",
          fingerprint,
          commit: "bbbbbbbbbbbb",
          dirty: false,
          losses: [],
        },
      ],
      ["select/huge", { skipped: "2501 layers, above the 2500 Paper takes" }],
      [
        "select/rtl",
        {
          sourceHash: "74bb0870d248",
          fingerprint: rtlFingerprint,
          commit: "bbbbbbbbbbbb",
          dirty: false,
          losses: ["picture", "size", "unbound token"],
        },
      ],
    ]
  )
})

test("parses back the provenance it formats, a dirty commit included", () => {
  const entries = new Map([
    [
      "tabs/basic",
      {
        sourceHash: "0123456789ab",
        fingerprint: "ba9876543210",
        commit: "cccccccccccc",
        dirty: true,
        losses: ["display", "unbound token"],
      },
    ],
  ])
  const text = formatProvenance("examples/components/tabs", entries)
  assert.equal(
    text.split("\n").at(-1),
    "tabs/basic 0123456789ab ba9876543210 cccccccccccc-dirty loses display, unbound token"
  )
  assert.deepEqual(parseProvenance(text), entries)
})

test("keeps the commit of a frame it does not rewrite", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  await sync(paper, [captureOf("select/basic"), captureOf("select/rtl")])
  const changed = captureOf("select/rtl")
  changed.sidecar.hash = "f".repeat(64)
  changed.sidecar.commit = "d".repeat(40)
  const unchanged = captureOf("select/basic")
  unchanged.sidecar.commit = "d".repeat(40)
  await sync(paper, [unchanged, changed])
  assert.deepEqual(
    textOf(paper, "provenance")
      .split("\n")
      .slice(2)
      .map((line) => line.split(" ").toSpliced(1, 2).join(" ")),
    ["select/basic bbbbbbbbbbbb exact", "select/rtl dddddddddddd exact"]
  )
})

test("a second sync of the catalogue writes nothing", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  const captures = [...selectCaptures, buttonCapture]
  await sync(paper, captures)
  assert.deepEqual(await writesOfNextSync(paper, captures), [])
})

test("updates the losses it lists when only the capture's records change", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  await sync(paper, [captureOf("select/basic")])
  const relisted = captureOf("select/basic", {
    unsupported: [{ layer: "select/basic", property: "resize", value: "both" }],
  })
  assert.deepEqual(
    [
      await writesOfNextSync(paper, [relisted]),
      textOf(paper, "provenance").split("\n").at(-1).split(" ").slice(4),
      await writesOfNextSync(paper, [relisted]),
    ],
    [["write_html", "set_text_content"], ["loses", "resize"], []]
  )
})

test("puts a header before the frames that names the component and counts its frames", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  await sync(paper, selectCaptures)
  assert.deepEqual(
    [childNames(paper, "select"), textOf(paper, "header").split("\n")],
    [
      ["header", "select/basic", "select/rtl", "provenance"],
      [
        "select",
        "examples/components/select",
        "https://ui-sdk.dev/docs/web-components/components/select",
        "3 frames, 1 record nothing, 1 list a loss, 1 not imported",
      ],
    ]
  )
})

test("places a new artboard and lays out one a crash left at 400x400", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  paper.state.artboards.push({
    id: "a-0",
    name: "button",
    styles: { width: "400px", height: "400px", flexDirection: "column" },
    children: [],
  })
  await sync(paper, [buttonCapture, captureOf("select/basic")])
  const [button, select] = paper.state.artboards.map(({ styles }) => [
    styles.width,
    styles.height,
    styles.flexWrap,
    styles.left,
    styles.top,
  ])
  assert.deepEqual(
    [button, select, await writesOfNextSync(paper, [buttonCapture])],
    [
      ["1808px", "fit-content", "wrap", "0px", "0px"],
      ["1808px", "fit-content", "wrap", "1968px", "0px"],
      [],
    ]
  )
})

test("finishes a sync stopped half way without a duplicate, then stays", async () => {
  const captures = [...selectCaptures, buttonCapture]
  const paper = fakePaper({ tokens: ["--ink"] })
  paper.state.stopAfter = 9
  await assert.rejects(sync(paper, captures), { message: "Paper stopped" })
  delete paper.state.stopAfter
  await sync(paper, captures)
  assert.deepEqual(
    [
      paper.state.artboards.map(({ name }) => name),
      childNames(paper, "button"),
      childNames(paper, "select"),
      await writesOfNextSync(paper, captures),
    ],
    [
      ["button", "select"],
      ["header", "button/basic", "provenance"],
      ["header", "select/basic", "select/rtl", "provenance"],
      [],
    ]
  )
})

test("places a frame added later among the frames it sorts between", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  await sync(paper, [captureOf("select/basic"), captureOf("select/rtl")])
  await sync(paper, [captureOf("select/groups")])
  assert.deepEqual(childNames(paper, "select"), [
    "header",
    "select/basic",
    "select/groups",
    "select/rtl",
    "provenance",
  ])
})

test("counts a frame it did not import as a recorded loss, and a missing one as unrecorded", async () => {
  const paper = fakePaper({ tokens: ["--ink"] })
  const [, , huge] = selectCaptures
  await sync(paper, [huge])
  const missing = captureOf("tabs/basic", {
    unbound: [{ layer: "tabs/basic", property: "padding", value: "0px 13px" }],
  })
  const lines = await quietly(() =>
    verifyFrames(paper, "file", {
      label: "components",
      page: "02 Components",
      captures: [huge, missing],
    })
  )
  assert.deepEqual(lines, [
    "select/huge: not imported, 2501 layers, above the 2500 Paper takes",
    "tabs/basic: no artboard named tabs",
    "tabs/basic: note, tabs/basic: padding 0px 13px is bound to no token",
    "components: 2 checked, 2 differences, 1 unbound",
    "components: 0 match with nothing recorded, 1 differ only by recorded losses, 1 differ in a way nothing records",
    "unrecorded: tabs/basic",
  ])
})

test("takes a difference on a layer that records a cause, or below it, as following from that loss", () => {
  const sidecar = {
    layers: [
      "pagination/basic",
      "pagination/basic > preview",
      "pagination/basic > preview > pagination-next",
      "pagination/basic > preview > pagination-next > div > visually-hidden",
      "pagination/basic > preview > pagination-next > div > visually-hidden > label",
      "pagination/basic > preview > hint",
    ].map((layer) => ({ layer })),
    unsupported: [
      {
        layer:
          "pagination/basic > preview > pagination-next > div > visually-hidden",
        property: "clip-path",
        value: "inset(50%)",
      },
      {
        layer: "pagination/basic > preview > hint",
        property: "size",
        value: "1x1",
      },
    ],
  }
  const hidden =
    "pagination/basic > preview > pagination-next > visually-hidden"
  assert.deepEqual(
    [
      `layer 4 is missing in Paper's export, ${hidden} in capture`,
      `${hidden} > label: color is bound to --ink in capture, not in Paper's export`,
      `${hidden} is 1x1 in Paper's export, 2x2 in capture`,
      "pagination/basic > preview > pagination-next: gap is bound to --space-2 in capture, not in Paper's export",
      "pagination/basic > preview > hint is 3x3 in Paper's export, 1x1 in capture",
      "pagination/basic > preview > hint looks different in Paper's export, in the 3x3 region at 0,0 of the frame",
      "provenance records no hash, capture is 0123456789ab",
    ].map((text) => followsFromLoss(text, sidecar)),
    [true, true, true, false, false, false, false]
  )
})
