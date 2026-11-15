import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureFrame, launchBrowser } from "../capture.mjs"
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

const fill = (html) => (page) =>
  page.locator(".example-content").evaluate((preview, content) => {
    preview.innerHTML = content
  }, html)

const capture = (html) =>
  captureFrame(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: fill(html),
    tokens,
  })

const elementTag = ({ html }, slot) =>
  html.match(new RegExp(`<div layer-name="${slot}"[^>]*>`))?.[0]

const layer = ({ layers }, slot) => layers.find(({ name }) => name === slot)

const unsupportedAt = ({ unsupported }, path) =>
  unsupported
    .filter(({ layer }) => layer === path)
    .map(({ property }) => property)

describe("the capture page", () => {
  test("runs examples that need a secure context", async () => {
    let id
    await captureFrame(browser, {
      name: "fixture/case",
      root: repo,
      stylesheets: ["/examples/styles/tokens.css"],
      mount: async (page) => {
        id = await page.evaluate(() => crypto.randomUUID())
      },
      tokens,
    })
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/)
  })

  test("renders var(--mono) text in Geist Mono", async () => {
    const result = await capture(
      `<div data-slot="code" style="font-family: var(--mono); font-size: 10px; line-height: 20px">0000000000</div>`
    )
    assert.deepEqual(
      {
        width: layer(result, "code").width,
        height: layer(result, "code").height,
      },
      { width: 60, height: 20 }
    )
  })
})

describe("measured sizes", () => {
  test("describe the layout before the capture adds anything", async () => {
    const result = await capture(
      `<div data-slot="row" style="display: flex; flex-wrap: wrap; gap: 8px"><div style="width: 100px; height: 20px; flex-shrink: 0"></div><div style="width: 100px; height: 20px; flex-shrink: 0"></div></div>`
    )
    const { width, height } = layer(result, "row")
    assert.deepEqual({ width, height }, { width: 208, height: 20 })
  })

  test("count the text nodes stacked in a column", async () => {
    const result = await capture(
      `<div data-slot="stack" style="display: flex; flex-direction: column"><div>One</div><div>Two</div></div>`
    )
    const { textRows, textColumns } = layer(result, "stack")
    assert.deepEqual({ textRows, textColumns }, { textRows: 2, textColumns: 1 })
    assert.equal(layer(result, "fixture/case").textRows, 3)
  })

  test("count the text nodes side by side in a row", async () => {
    const result = await capture(
      `<div data-slot="row" style="display: flex; gap: 8px"><div>One</div><div>Two</div></div>`
    )
    const { textRows, textColumns } = layer(result, "row")
    assert.deepEqual({ textRows, textColumns }, { textRows: 1, textColumns: 2 })
  })
})

describe("measured text counts", () => {
  test("include the text that sets a stretched layer's width", async () => {
    const result = await capture(
      `<div data-slot="column" style="display: flex; flex-direction: column"><div data-slot="title">T</div><div style="display: flex; gap: 8px"><div>One</div><div>Two</div></div></div>`
    )
    const { textRows, textColumns } = layer(result, "title")
    assert.deepEqual({ textRows, textColumns }, { textRows: 1, textColumns: 2 })
  })
})

describe("token binding", () => {
  test("leaves a token inside calc() unbound instead of binding another", async () => {
    const result = await capture(
      `<div data-slot="pad" style="padding-left: calc(var(--space-2) + 2px)"></div>`
    )
    assert.equal(
      elementTag(result, "pad"),
      `<div layer-name="pad" style="padding: 0px 0px 0px 10px">`
    )
    assert.deepEqual(
      result.bindings.filter(({ layer }) => layer === layerPath("pad")),
      []
    )
    assert.deepEqual(result.unbound, [
      {
        layer: layerPath("pad"),
        property: "padding",
        value: "0px 0px 0px 10px",
      },
    ])
  })

  test("keeps the real length of a calc() part in a composite value", async () => {
    const result = await capture(
      `<div data-slot="ring" style="box-shadow: 0 0 0 calc(var(--space-1) / 2) var(--ink)"></div>`
    )
    assert.equal(
      elementTag(result, "ring"),
      `<div layer-name="ring" style="box-shadow: var(--ink) 0px 0px 0px 2px">`
    )
    assert.deepEqual(
      result.bindings.filter(({ layer }) => layer === layerPath("ring")),
      [{ layer: layerPath("ring"), property: "box-shadow", token: "--ink" }]
    )
    assert.equal(result.unbound.length, 1)
  })

  test("keeps the real colour of a color-mix() part in a composite value", async () => {
    const result = await capture(
      `<div data-slot="ring" style="box-shadow: 0 0 0 1px var(--line), inset 0 0 0 2px color-mix(in oklab, var(--ink) 10%, transparent)"></div>`
    )
    assert.equal(
      elementTag(result, "ring"),
      `<div layer-name="ring" style="box-shadow: var(--line) 0px 0px 0px 1px, rgb(23 23 23 / 10%) 0px 0px 0px 2px inset">`
    )
    assert.deepEqual(result.unbound, [
      {
        layer: layerPath("ring"),
        property: "box-shadow",
        value:
          "var(--line) 0px 0px 0px 1px, rgb(23 23 23 / 10%) 0px 0px 0px 2px inset",
      },
    ])
  })

  test("records a calc() use on every side once", async () => {
    const result = await capture(
      `<div data-slot="pad" style="padding: calc(var(--space-1) * 3)"></div>`
    )
    assert.equal(
      elementTag(result, "pad"),
      `<div layer-name="pad" style="padding: 12px">`
    )
    assert.deepEqual(result.unbound, [
      { layer: layerPath("pad"), property: "padding", value: "12px" },
    ])
  })

  test("does not record a literal that depends on the font size as unbound", async () => {
    const result = await capture(
      `<div data-slot="text" style="font-size: var(--text-md); line-height: 1.5; padding: 0.5em">Text</div>`
    )
    assert.equal(
      elementTag(result, "text"),
      `<div layer-name="text" style="padding: 7px; font-family: Geist; font-size: var(--text-md); line-height: 21px">`
    )
    assert.deepEqual(result.unbound, [])
  })

  test("records the colours the CSS authored as literals", async () => {
    const result = await capture(
      `<div data-slot="swatch" style="background-color: #fff; color: var(--ink)">Text</div>`
    )
    assert.deepEqual(
      result.literals.filter(({ layer }) => layer === layerPath("swatch")),
      [
        {
          layer: layerPath("swatch"),
          property: "background-color",
          value: "rgb(255 255 255)",
        },
      ]
    )
  })
})

describe("text-only flex elements", () => {
  test("carry no gap, which Paper drops from a Text node", async () => {
    const result = await capture(
      `<div data-slot="label" style="display: flex; gap: var(--space-2)">Email</div>`
    )
    assert.equal(
      elementTag(result, "label"),
      `<div layer-name="label" style="display: flex; font-family: Geist">`
    )
    assert.deepEqual(
      result.bindings.filter(({ layer }) => layer === layerPath("label")),
      []
    )
  })
})

describe("what the flattener does not emit", () => {
  const cases = [
    [
      "margin",
      `style="display: flex; margin: 8px"`,
      ["margin-top", "margin-right", "margin-bottom", "margin-left"],
    ],
    [
      "position",
      `style="display: flex; position: relative; top: 5px"`,
      ["position"],
    ],
    [
      "a transform",
      `style="display: flex; transform: rotate(45deg)"`,
      ["transform"],
    ],
    [
      "visibility: hidden",
      `style="display: flex; visibility: hidden"`,
      ["visibility"],
    ],
    [
      "a gradient",
      `style="display: flex; background-image: linear-gradient(red, blue)"`,
      ["background-image"],
    ],
    ["min-width", `style="display: flex; min-width: 200px"`, ["min-width"]],
    [
      "overflow clipping",
      `style="display: flex; overflow: hidden"`,
      ["overflow-x", "overflow-y"],
    ],
    ["direction", `dir="rtl" style="display: flex"`, ["direction"]],
  ]
  for (const [label, attributes, expected] of cases) {
    test(`records ${label}`, async () => {
      const result = await capture(
        `<div data-slot="x" ${attributes}><div style="width: 10px; height: 10px"></div></div>`
      )
      assert.deepEqual(unsupportedAt(result, layerPath("x")), expected)
    })
  }

  test("records direction once, where it changes", async () => {
    const result = await capture(
      `<div data-slot="x" dir="rtl" style="display: flex"><div data-slot="y">One</div></div>`
    )
    assert.deepEqual(result.unsupported, [
      { layer: layerPath("x"), property: "direction", value: "rtl" },
    ])
  })

  test("records a painting pseudo-element", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::before { content: ""; width: 4px; height: 4px; background: red }</style><div data-slot="x" style="display: flex"></div>`
    )
    assert.deepEqual(unsupportedAt(result, layerPath("x")), ["::before"])
  })

  test("records an input's value", async () => {
    const result = await capture(
      `<input data-slot="x" value="ada@example.com">`
    )
    assert.deepEqual(
      result.unsupported.find(({ property }) => property === "value"),
      { layer: layerPath("x"), property: "value", value: "ada@example.com" }
    )
  })

  test("records mixed text and element children", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex">Save <span style="display: flex">now</span></div>`
    )
    assert.deepEqual(unsupportedAt(result, layerPath("x")), ["children"])
  })

  test("records a subtree that redeclares the tokens", async () => {
    const result = await capture(
      `<div data-slot="x" data-color-scheme="dark" style="display: flex; color: var(--ink)"><div data-slot="y">Text</div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(({ layer, property }) => ({ layer, property })),
      [{ layer: layerPath("x"), property: "tokens" }]
    )
  })

  test("records an svg that CSS sizes and colours", async () => {
    const result = await capture(
      `<style>[data-slot="x"] svg { width: 16px; height: 16px }</style><div data-slot="x" style="display: flex; color: var(--danger)"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="currentColor"/></svg></div>`
    )
    assert.deepEqual(unsupportedAt(result, `${layerPath("x")} > svg`), [
      "width",
      "height",
      "color",
    ])
  })

  test("records nothing for a plain flex element", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex; padding: var(--space-2); background-color: var(--paper)">Text</div>`
    )
    assert.deepEqual(result.unsupported, [])
  })
})
