import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureExamples, captureFrame, launchBrowser } from "../capture.mjs"
import {
  captionsIn,
  describeExample,
  inspectExample,
  summarize,
} from "../census.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
let browser
let tokens

before(async () => {
  browser = await launchBrowser()
  ;({ tokens } = await readCodeTokens())
})
after(() => browser.close())

const inspect = async (html) => {
  const { inspection } = await captureFrame(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) =>
      page.locator(".example-content").evaluate((preview, content) => {
        preview.innerHTML = content
      }, html),
    tokens,
    inspect: inspectExample,
  })
  return inspection
}

test("counts a hidden part once, and not the slots inside it", async () => {
  const { closedSlots, closedPopups, kinds } = await inspect(
    `<div data-slot="content" hidden><div data-slot="item">One</div></div>`
  )
  assert.deepEqual(
    { closedSlots, closedPopups, kinds },
    {
      closedSlots: ["content"],
      closedPopups: [],
      kinds: { "hidden part": 1 },
    }
  )
})

test("tells a closed popup from another hidden part", async () => {
  const outFolder = await mkdtemp(path.join(tmpdir(), "paper-census-"))
  try {
    const results = await Array.fromAsync(
      captureExamples(browser, ["dialog/basic", "drawer/basic", "tabs/basic"], {
        outFolder,
        inspect: inspectExample,
      })
    )
    assert.deepEqual(
      results.map(({ name, inspection }) => ({
        name,
        closedSlots: inspection.closedSlots,
        closedPopups: inspection.closedPopups,
        popups: inspection.kinds["closed popup"],
        parts: inspection.kinds["hidden part"],
      })),
      [
        {
          name: "dialog/basic",
          closedSlots: ["dialog-backdrop", "dialog-content"],
          closedPopups: ["dialog-content"],
          popups: 1,
          parts: 1,
        },
        {
          name: "drawer/basic",
          closedSlots: ["drawer-backdrop", "drawer-viewport"],
          closedPopups: ["drawer-viewport"],
          popups: 1,
          parts: 1,
        },
        {
          name: "tabs/basic",
          closedSlots: ["tabs-panel"],
          closedPopups: [],
          popups: undefined,
          parts: 1,
        },
      ]
    )
  } finally {
    await rm(outFolder, { recursive: true })
  }
})

test("lists each slot with the state attributes it carries", async () => {
  const { slots } = await inspect(
    `<div data-slot="item" data-open style="line-height: 20px">One</div><div data-slot="item" data-disabled style="line-height: 20px">Two</div>`
  )
  assert.deepEqual(slots, { item: ["data-disabled", "data-open"] })
})

test("counts a block that lays out inline children", async () => {
  const { kinds } = await inspect(
    `<div style="line-height: 20px"><span>One</span><b>Two</b></div>`
  )
  assert.deepEqual(kinds, {
    "block with element children": 1,
    "block with inline children": 1,
  })
})

test("does not count an svg's shapes as children", async () => {
  const { kinds } = await inspect(
    `<div style="display: flex"><svg width="16" height="16"><path d="M0 0h16v16z" /></svg></div>`
  )
  assert.deepEqual(kinds, {})
})

test("tells a control's value from its placeholder", async () => {
  const { kinds } = await inspect(
    `<input value="Ada"><input placeholder="Name"><input>`
  )
  assert.deepEqual(kinds, {
    "control shows a value": 1,
    "control shows a placeholder": 1,
    "control is empty": 1,
  })
})

test("counts a display: contents element that styles its own text", async () => {
  const { kinds } = await inspect(
    `<div style="display: flex; line-height: 20px"><span style="display: contents; font-weight: 700">Bold</span></div>`
  )
  assert.deepEqual(kinds, { "display: contents styles its text": 1 })
})

test("counts a list item without a marker as block flow, and not one with a marker", async () => {
  const { kinds } = await inspect(
    `<ul style="margin: 0; padding: 0; list-style: none; line-height: 20px"><li><div>One</div></li></ul><ul style="margin: 0; list-style: disc; line-height: 20px"><li><div>Two</div></li></ul>`
  )
  assert.deepEqual(kinds, { "block with element children": 3 })
})

test("reads a docs caption that holds a >", () => {
  assert.deepEqual(
    captionsIn(
      `<ComponentExample\n  name="token-input/codec"\n  caption="Each mention as <@id>."\n/>\n<ComponentExample name="button/basic" />`
    ),
    [
      ["token-input/codec", "Each mention as <@id>."],
      ["button/basic", null],
    ]
  )
})

const frameOf = (name, unsupported = []) => ({
  sidecar: {
    frame: { width: 100, height: 50 },
    layers: [
      { layer: name, kind: "frame", width: 100, height: 50 },
      { layer: `${name} > preview`, kind: "chrome", width: 50, height: 20 },
    ],
    hash: "0".repeat(64),
    settled: true,
    unsupported,
    unbound: [],
  },
  html: `<div layer-name="${name}"><div layer-name="preview"></div></div>`,
  inspection: { slots: {}, closedSlots: [], closedPopups: [], kinds: {} },
})

test("counts an offline check that failed as its own kind", () => {
  const { kinds, emitted, offlineError } = describeExample(
    frameOf("command/virtualized"),
    { emitted: [], error: "Unable to capture screenshot" }
  )
  assert.deepEqual(
    { kinds, emitted, offlineError },
    {
      kinds: { "offline check failed": 1 },
      emitted: [],
      offlineError: "Unable to capture screenshot",
    }
  )
})

const entry = (name, layers, kinds, recorded) => ({
  name,
  component: name.split("/")[0],
  docs: true,
  status: "rendered",
  layers,
  renderHash: name,
  unsupported: recorded.length,
  unbound: 0,
  kinds,
  recorded,
})

const summaryLines = (examples, pattern) =>
  summarize({ examples })
    .split("\n")
    .filter((line) => pattern.test(line))

test("gives each kind the frames that differ offline and the frames it alone fails", () => {
  const examples = [
    entry(
      "select/demo",
      10,
      { "min-height": 1, "closed popup": 1, "emitted HTML differs offline": 2 },
      ["min-height"]
    ),
    entry("select/rtl", 10, { "min-height": 1, direction: 1 }, [
      "direction",
      "min-height",
    ]),
  ]
  assert.deepEqual(
    summaryLines(examples, /^(min-height|closed popup|direction) \|/),
    [
      "min-height | 2 | 2 | 1 | 1 | 1: select",
      "closed popup | 1 | 1 | 1 | 0 | 1: select",
      "direction | 1 | 1 | 0 | 0 | 1: select",
    ]
  )
})

test("leaves a frame over the layer limit out of the element totals, and names it", () => {
  const examples = [
    entry("command/virtualized", 10006, { margin: 9999 }, ["margin"]),
    entry("command/basic", 20, { margin: 2 }, ["margin"]),
  ]
  assert.deepEqual(summaryLines(examples, /^(margin \||over \d+ layers)/), [
    "over 1000 layers command/virtualized",
    "margin | 2 | 2 | 0 | 2 | 1: command",
  ])
})
