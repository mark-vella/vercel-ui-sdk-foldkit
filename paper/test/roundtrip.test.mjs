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
  "probe/paint": `<div data-slot="track" style="display: flex; width: 160px; height: 40px; background-color: var(--tint)"><div data-slot="holder" style="width: 50px; height: 30px; position: relative; background-color: var(--line)"><div data-slot="high" style="position: absolute; top: 0px; left: 30px; width: 40px; height: 20px; background-color: var(--danger)"></div></div><div data-slot="next" style="width: 50px; height: 30px; position: relative; top: 4px; background-color: var(--ink)"></div><div data-slot="faded" style="width: 20px; height: 20px; opacity: 0.4; background-color: var(--danger)"></div><div data-slot="offset" style="width: 20px; height: 20px; translate: 10px 5px; background-color: var(--ink)"></div></div>`,
  "probe/turn": `<div data-slot="track" style="display: flex; width: 120px; height: 60px; background-color: var(--tint)"><div data-slot="bar" style="width: 40px; height: 10px; background-color: var(--ink); transform: rotate(90deg) translateX(20px)"></div></div>`,
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

const readButton = async () => {
  const [sidecar, html] = await Promise.all([
    readFixture("button-basic.json"),
    readFixture("button-basic.emitted.txt"),
  ])
  return { ...JSON.parse(sidecar), html: html.trim() }
}

const check = (sidecar, { jsx, summary }) =>
  checkExport(browser, {
    jsx,
    tree: parseTree(summary),
    sidecar,
    html: sidecar.html,
    tokens,
  })

const replaceOnce = (text, from, to) => {
  assert.ok(text.includes(from), `the export holds ${from}`)
  return text.replace(from, to)
}

describe("a faithful export", () => {
  test("of button/basic passes", async () => {
    const sidecar = await readButton()
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

describe("a capture that recorded a drop", () => {
  test("fails a faithful export, naming the layer and the drop", async () => {
    const sidecar = await readButton()
    sidecar.unsupported = [
      {
        layer: "button/basic > preview > button",
        property: "direction",
        value: "rtl",
      },
    ]
    assert.deepEqual(await check(sidecar, await readExport("button/basic")), [
      "button/basic > preview > button: direction rtl is not imported",
    ])
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
        `${button} looks different in Paper's export, in the 42x11 region at 39,68 of the frame`,
      ],
    ],
  ]
  for (const [label, [from, to], expected] of edits) {
    test(`fails on ${label}`, async () => {
      const sidecar = await readButton()
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
    const sidecar = await readButton()
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

describe("an export that draws differently at the same sizes", () => {
  test("passes when it draws the same", async () => {
    const sidecar = await captureProbe("probe/paint")
    assert.deepEqual(await check(sidecar, await readExport("probe/paint")), [])
  })

  const track = "probe/paint > preview > track"
  const edits = [
    [
      "a layer lifted over a later one",
      [
        "left: '30px', position: 'absolute'",
        "left: '30px', position: 'absolute', zIndex: '1'",
      ],
      `${track} > holder > high looks different in Paper's export, in the 20x16 region at 74,56 of the frame`,
    ],
    [
      "another opacity",
      ["opacity: '0.4'", "opacity: '0.7'"],
      `${track} > faded looks different in Paper's export, in the 20x20 region at 124,52 of the frame`,
    ],
    [
      "a translate dropped",
      ["translate: '10px 5px', ", ""],
      `${track} looks different in Paper's export, in the 30x25 region at 144,52 of the frame`,
    ],
  ]
  for (const [label, [from, to], expected] of edits) {
    test(`fails on ${label}, naming where`, async () => {
      const sidecar = await captureProbe("probe/paint")
      const { jsx, summary } = await readExport("probe/paint")
      const edited = { jsx: replaceOnce(jsx, from, to), summary }
      assert.deepEqual(await check(sidecar, edited), [expected])
    })
  }

  test("fails on the translate Paper drops after a rotate", async () => {
    const sidecar = await captureProbe("probe/turn")
    assert.deepEqual(await check(sidecar, await readExport("probe/turn")), [
      "probe/turn looks different in Paper's export, in the 10x60 region at 39,37 of the frame",
    ])
  })
})
