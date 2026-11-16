import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureFrame, launchBrowser } from "../capture.mjs"
import { inspectPreview } from "../census.mjs"
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
    inspect: (page) => page.evaluate(inspectPreview),
  })
  return inspection
}

test("counts a closed slot once, and not the slots inside it", async () => {
  const { closedSlots, kinds } = await inspect(
    `<div data-slot="content" hidden><div data-slot="item">One</div></div>`
  )
  assert.deepEqual(
    { closedSlots, kinds },
    {
      closedSlots: ["content"],
      kinds: { "closed slot": 1 },
    }
  )
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
