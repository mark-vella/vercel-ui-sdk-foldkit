import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureFrame, launchBrowser } from "../capture.mjs"
import { checkExport, parseTree } from "../roundtrip.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const fixtures = new URL("./fixtures/", import.meta.url)
const frames = {
  "probe/leading": `<div data-slot="stack" style="display: flex; flex-direction: column"><div data-slot="trigger" style="font-size: var(--text-md); line-height: 1.4; color: var(--ink)">Section one</div><div data-slot="trigger" style="font-size: var(--text-md); line-height: 1.4; color: var(--ink)">Section two</div><div data-slot="trigger" style="font-size: var(--text-md); line-height: 1.4; color: var(--ink)">Section three</div></div><div data-slot="para" style="width: 120px; font-size: var(--text-sm); line-height: 19.5px; color: var(--ink)">Shipping takes five to seven days.</div>`,
  "probe/border": `<div data-slot="list" style="width: 240px; border-top: 1px solid var(--line-faint)"><div data-slot="item" style="padding: var(--space-2); border-bottom: 1px solid var(--line-faint); color: var(--ink); font-size: var(--text-md); line-height: var(--leading)">First</div><div data-slot="item" style="padding: var(--space-2); border-bottom: 1px solid var(--line-faint); color: var(--ink); font-size: var(--text-md); line-height: var(--leading)">Second</div></div><div data-slot="card" style="display: flex; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-control); color: var(--ink); font-size: var(--text-md); line-height: var(--leading)">Card</div>`,
}
let browser
let tokens

before(async () => {
  browser = await launchBrowser()
  ;({ tokens } = await readCodeTokens())
})
after(() => browser.close())

const readFixture = (name) => readFile(new URL(name, fixtures), "utf8")

const readExport = async (name) => {
  const base = name.replace("/", "-")
  const [jsx, summary] = await Promise.all([
    readFixture(`${base}.export.txt`),
    readFixture(`${base}.tree.txt`),
  ])
  return { jsx, summary }
}

const captureProbe = async (name) => {
  const flat = await captureFrame(browser, {
    name,
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) =>
      page.locator(".example-content").evaluate((preview, content) => {
        preview.innerHTML = content
      }, frames[name]),
    tokens,
  })
  return { name, ...flat }
}

const check = (sidecar, { jsx, summary }) =>
  checkExport(browser, { jsx, tree: parseTree(summary), sidecar, tokens })

const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `the export holds ${from}`)
  return text.replace(from, to)
}

describe("a faithful export", () => {
  test("of button/basic passes", async () => {
    const sidecar = JSON.parse(await readFixture("button-basic.json"))
    assert.deepEqual(await check(sidecar, await readExport("button/basic")), [])
  })

  test("of text with a fractional line height passes", async () => {
    const sidecar = await captureProbe("probe/leading")
    assert.deepEqual(
      await check(sidecar, await readExport("probe/leading")),
      []
    )
  })

  test("of bordered layers matches their bindings", async () => {
    const sidecar = await captureProbe("probe/border")
    assert.deepEqual(await check(sidecar, await readExport("probe/border")), [])
  })
})

describe("an export edited away from the capture", () => {
  const button = "button/basic > preview > button"
  const edits = [
    [
      "a background unbound to the same colour",
      ["backgroundColor: 'var(--surface-1)'", "backgroundColor: '#FFFFFF'"],
      [
        `${button}: background-color is bound to --surface-1 in capture, not in Paper's export`,
        `${button}: background-color has the literal rgb(255 255 255) in Paper's export, not in capture`,
      ],
    ],
    [
      "an unbound radius",
      ["borderRadius: 'var(--radius-control)'", "borderRadius: '8px'"],
      [
        `${button}: border-radius is bound to --radius-control in capture, not in Paper's export`,
      ],
    ],
    [
      "one more pixel of padding",
      ["paddingInline: '14px'", "paddingInline: '15px'"],
      [
        "button/basic is 121.719x114 in Paper's export, 119.719x114 in capture",
        "button/basic > caption is 73.719x20 in Paper's export, 71.719x20 in capture",
        "button/basic > preview is 73.719x34 in Paper's export, 71.719x34 in capture",
        `${button} is 73.719x34 in Paper's export, 71.719x34 in capture`,
      ],
    ],
    [
      "another text token",
      ["color: 'var(--ink)'", "color: 'var(--muted)'"],
      [
        `${button}: color is bound to --ink in capture, not in Paper's export`,
        `${button}: color is bound to --muted in Paper's export, not in capture`,
      ],
    ],
  ]
  for (const [label, [from, to], expected] of edits) {
    test(`fails on ${label}`, async () => {
      const sidecar = JSON.parse(await readFixture("button-basic.json"))
      const { jsx, summary } = await readExport("button/basic")
      const edited = { jsx: replaceOnce(jsx, from, to), summary }
      assert.deepEqual(await check(sidecar, edited), expected)
    })
  }

  const item = "probe/border > preview > list > item"
  const borders = [
    [
      "a border unbound to its colour",
      [
        "borderBottomColor: 'var(--line-faint)'",
        "borderBottomColor: '#E2E2E0'",
      ],
      [
        `${item}: border-bottom is bound to --line-faint in capture, not in Paper's export`,
        `${item}: border-bottom has the literal rgb(226 226 224) in Paper's export, not in capture`,
      ],
    ],
    [
      "a border removed",
      [
        "borderTopColor: 'var(--line-faint)', borderTopStyle: 'solid', borderTopWidth: '1px', ",
        "",
      ],
      [
        "probe/border is 288x208 in Paper's export, 288x209 in capture",
        "probe/border > preview is 240x132 in Paper's export, 240x133 in capture",
        "probe/border > preview > list is 240x74 in Paper's export, 240x75 in capture",
        "probe/border > preview > list: border-top is bound to --line-faint in capture, not in Paper's export",
      ],
    ],
  ]
  for (const [label, [from, to], expected] of borders) {
    test(`fails on ${label}`, async () => {
      const sidecar = await captureProbe("probe/border")
      const { jsx, summary } = await readExport("probe/border")
      const edited = { jsx: replaceOnce(jsx, from, to), summary }
      assert.deepEqual(await check(sidecar, edited), expected)
    })
  }

  test("fails on a layer Paper holds hidden", async () => {
    const sidecar = JSON.parse(await readFixture("button-basic.json"))
    const { jsx, summary } = await readExport("button/basic")
    const caption = jsx.match(/\n *<div[^\n]*>\n *button\/basic\n *<\/div>/)[0]
    const hidden = {
      jsx: replaceOnce(jsx, caption, ""),
      summary: summary.replace(/(Text "caption".*)$/m, "$1 [hidden]"),
    }
    assert.deepEqual(await check(sidecar, hidden), [
      "caption is hidden in Paper",
      "layer 2 is button/basic > preview in Paper's export, button/basic > caption in capture",
      "button/basic: gap is bound to --space-3 in capture, not in Paper's export",
      "button/basic > caption: color is bound to --muted in capture, not in Paper's export",
      "button/basic > caption: font-size is bound to --text-xs in capture, not in Paper's export",
      "button/basic > caption: line-height is bound to --leading in capture, not in Paper's export",
    ])
  })
})
