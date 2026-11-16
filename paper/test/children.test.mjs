import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureCompared, launchBrowser } from "../capture.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const layerPath = (slot) => `fixture/case > preview > ${slot}`
let browser
let tokens

before(async () => {
  browser = await launchBrowser()
  ;({ tokens } = await readCodeTokens())
})
after(() => browser.close())

const capture = (html) =>
  captureCompared(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) =>
      page.locator(".example-content").evaluate((preview, content) => {
        preview.innerHTML = content
      }, html),
    tokens,
  })

const recorded = ({ unsupported }) =>
  unsupported
    .map(({ layer, property }) =>
      property === "picture" ? property : `${layer} ${property}`
    )
    .toSorted()

describe("a pseudo-element", () => {
  const handle = (rule) =>
    `<style>[data-slot="x"]::before { content: ""; position: absolute; inset: 0 -5px; ${rule} }</style><div data-slot="x" style="position: relative; width: 1px; height: 40px; background: var(--line)"></div>`

  test("that paints nothing and takes no space records nothing", async () => {
    const result = await capture(handle(""))
    assert.deepEqual(recorded(result), [])
    assert.match(result.html, /<div layer-name="x" [^>]*><\/div>/)
  })

  test("that paints nothing and takes space is emitted as an empty child, with its tokens", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::after { content: ""; height: var(--space-3) }</style><div data-slot="x" style="display: flex; flex-direction: column; gap: 8px"><div style="height: 10px; background: var(--ink)"></div></div><div style="height: 10px; background: var(--ink)"></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      result.html,
      /<\/div><div style="flex-shrink: 1; width: 0px; height: var\(--space-3\)"><\/div><\/div>/
    )
  })

  const recordedCases = [
    [
      "paints",
      `content: ""; position: absolute; inset: 0; background: var(--ink)`,
    ],
    ["holds text", `content: "Step "; display: block`],
    ["shows a counter", `content: counter(item); display: block`],
    [
      "sits in a line of text",
      `content: ""; display: inline-block; width: 4px`,
    ],
  ]
  for (const [label, rule] of recordedCases) {
    test(`that ${label} is recorded`, async () => {
      const result = await capture(
        `<style>[data-slot="x"]::before { ${rule} }</style><div data-slot="x" style="position: relative">one</div>`
      )
      assert.ok(recorded(result).includes(`${layerPath("x")} ::before`))
    })
  }
})

describe("text beside elements", () => {
  test("in a flex or grid parent records nothing, since each run is its own item", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex; gap: var(--space-2); color: var(--ink)"><div style="width: 16px; height: 16px; background: var(--line)"></div> Accept terms <div style="width: 8px; height: 8px; background: var(--ink)"></div> and conditions </div><div data-slot="y" style="display: grid; grid-template-columns: 20px auto">A<div style="height: 10px; background: var(--ink)"></div></div>`
    )
    assert.deepEqual(recorded(result), [])
  })

  test("between blocks in a block parent records nothing, since each run is its own block", async () => {
    const result = await capture(
      `<div data-slot="x">Save <div style="height: 10px; background: var(--ink)"></div> now</div>`
    )
    assert.deepEqual(recorded(result), [])
  })

  test("in a line with an inline box is recorded", async () => {
    const result = await capture(
      `<div data-slot="x">Save <span style="display: inline-block; width: 10px; height: 10px; background: var(--ink)"></span> now</div>`
    )
    assert.ok(recorded(result).includes(`${layerPath("x")} children`))
  })

  test("that keeps its spaces is recorded", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex; white-space: pre">  Save<div style="width: 8px; height: 8px"></div></div>`
    )
    assert.deepEqual(recorded(result), [
      `${layerPath("x")} children`,
      `${layerPath("x")} size`,
      "picture",
    ])
  })
})

describe("a control's value", () => {
  const field = `height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font: 400 var(--text-md) / 20px Geist`
  const tagOf = ({ html }, slot) =>
    html.match(new RegExp(`<div layer-name="${slot}"[^>]*>[^<]*`))?.[0]

  test("is emitted as the input's text, centred as the input draws it", async () => {
    const result = await capture(
      `<input data-slot="x" value="hollisgrant.com" style="width: 200px; ${field}">`
    )
    assert.deepEqual(recorded(result), [])
    assert.equal(
      tagOf(result, "x"),
      `<div layer-name="x" style="display: flex; align-items: center; flex-shrink: 1; width: 200px; height: 34px; padding: 0px 12px; border: 1px solid var(--line); border-radius: 8px; overflow: clip; color: var(--ink); font-family: Geist, system-ui, sans-serif; font-size: var(--text-md); line-height: 20px">hollisgrant.com`
    )
  })

  test("is emitted as the placeholder, with the placeholder's colour token", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::placeholder { color: var(--muted) }</style><input data-slot="x" placeholder="example.com" style="width: 200px; text-align: center; ${field}">`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      tagOf(result, "x"),
      /justify-content: center;.* color: var\(--muted\);.*>example\.com$/
    )
  })

  test("is emitted with the placeholder's normal line height in pixels", async () => {
    const result = await capture(
      `<input data-slot="x" placeholder="Name" style="width: 200px; ${field}">`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(tagOf(result, "x"), /; line-height: 18px; .*>Name$/)
  })

  test("is emitted as a textarea's text, from its top", async () => {
    const result = await capture(
      `<textarea data-slot="x" style="width: 200px; height: 80px; padding: 8px; resize: none; ${field.replace("height: 34px; padding: 0 12px; ", "")}">Ships on Monday</textarea>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(tagOf(result, "x"), />Ships on Monday$/)
  })

  test("leaves a textarea's resize grabber recorded, with the picture it draws", async () => {
    const result = await capture(
      `<textarea data-slot="x" style="width: 200px; height: 80px; padding: 8px; ${field.replace("height: 34px; padding: 0 12px; ", "")}">Ships on Monday</textarea>`
    )
    assert.deepEqual(recorded(result), [
      "fixture/case > preview > x resize",
      "picture",
    ])
  })

  const recordedCases = [
    [
      "that does not fit",
      `<input data-slot="x" value="a value far too long to fit in this narrow input" style="width: 80px; ${field}">`,
    ],
    [
      "that is masked",
      `<input data-slot="x" type="password" value="secret" style="width: 200px; ${field}">`,
    ],
    [
      "of a select",
      `<select data-slot="x" style="appearance: none; width: 200px; ${field}"><option>Monday</option></select>`,
    ],
  ]
  for (const [label, html] of recordedCases) {
    test(`${label} is recorded`, async () => {
      const result = await capture(html)
      assert.ok(recorded(result).includes(`${layerPath("x")} value`))
    })
  }
})
