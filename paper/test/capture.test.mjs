import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import {
  captureExamples,
  captureFrame,
  launchBrowser,
  saveCapture,
} from "../capture.mjs"
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

const layer = ({ layers }, path) => layers.find((entry) => entry.layer === path)

const unsupportedAt = ({ unsupported }, path) =>
  unsupported
    .filter(({ layer }) => layer === path)
    .map(({ property }) => property)
    .toSorted()

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
        width: layer(result, layerPath("code")).width,
        height: layer(result, layerPath("code")).height,
      },
      { width: 60, height: 20 }
    )
  })
})

describe("settling", () => {
  test("waits until the example stops changing before reading it", async () => {
    const result = await captureFrame(browser, {
      name: "fixture/case",
      root: repo,
      stylesheets: ["/examples/styles/tokens.css"],
      mount: (page) =>
        page.locator(".example-content").evaluate((preview) => {
          const grow = (remaining) => {
            if (remaining > 0) {
              preview.append(document.createElement("div"))
              requestAnimationFrame(() => grow(remaining - 1))
            }
          }
          grow(6)
        }),
      tokens,
    })
    assert.deepEqual(
      {
        isSettled: result.isSettled,
        height: layer(result, "fixture/case > preview").height,
      },
      { isSettled: true, height: 6 * 12 - 12 }
    )
  })

  test("waits out a change a resize observer makes in the last frame it checks", async () => {
    const result = await captureFrame(browser, {
      name: "fixture/case",
      root: repo,
      stylesheets: ["/examples/styles/tokens.css"],
      mount: (page) =>
        page.locator(".example-content").evaluate(async (preview) => {
          await document.fonts.ready
          const grow = (remaining) => {
            if (remaining > 0) {
              preview.append(document.createElement("div"))
              requestAnimationFrame(() => grow(remaining - 1))
            }
          }
          const observer = new ResizeObserver(() => {
            observer.disconnect()
            grow(6)
          })
          await new Promise((resolve) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => observer.observe(preview))
              )
              setTimeout(resolve)
            })
          })
        }),
      tokens,
    })
    assert.deepEqual(
      {
        isSettled: result.isSettled,
        height: layer(result, "fixture/case > preview").height,
      },
      { isSettled: true, height: 6 * 12 - 12 }
    )
  })

  test("records in the sidecar a capture that never settled", async () => {
    const outFolder = await mkdtemp(path.join(tmpdir(), "paper-capture-"))
    try {
      const flat = await captureFrame(browser, {
        name: "fixture/case",
        root: repo,
        stylesheets: ["/examples/styles/tokens.css"],
        mount: (page) =>
          page.locator(".example-content").evaluate((preview) => {
            const tick = (count) => {
              preview.dataset.tick = String(count)
              requestAnimationFrame(() => tick(count + 1))
            }
            tick(0)
          }),
        tokens,
      })
      await saveCapture(
        path.join(outFolder, "fixture/case"),
        {
          name: "fixture/case",
          commit: { commit: "0".repeat(40), dirty: false },
          sources: [],
        },
        flat
      )
      const saved = await readFile(
        path.join(outFolder, "fixture/case.json"),
        "utf8"
      )
      assert.equal(JSON.parse(saved).settled, false)
    } finally {
      await rm(outFolder, { recursive: true })
    }
  })
})

describe("measured sizes", () => {
  test("describe the layout before the capture adds anything", async () => {
    const result = await capture(
      `<div data-slot="row" style="display: flex; flex-wrap: wrap; gap: 8px"><div style="width: 100px; height: 20px; flex-shrink: 0"></div><div style="width: 100px; height: 20px; flex-shrink: 0"></div></div>`
    )
    const { width, height } = layer(result, layerPath("row"))
    assert.deepEqual({ width, height }, { width: 208, height: 20 })
  })

  test("include an svg as a layer of its own", async () => {
    const result = await capture(
      `<style>[data-slot="x"] svg { width: 16px; height: 16px }</style><div data-slot="x" style="display: flex"><svg width="24" height="24" viewBox="0 0 24 24"></svg></div>`
    )
    assert.deepEqual(layer(result, `${layerPath("x")} > svg`), {
      layer: `${layerPath("x")} > svg`,
      kind: "svg",
      width: 16,
      height: 16,
    })
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

  test("binds a token inside max() only on the side where it is the value used", async () => {
    const result = await capture(
      `<div data-slot="pad" style="padding-left: max(var(--space-2), 10px); padding-right: max(var(--space-3), 10px)"></div>`
    )
    assert.equal(
      elementTag(result, "pad"),
      `<div layer-name="pad" style="padding: 0px var(--space-3) 0px 10px">`
    )
    assert.deepEqual(result.unbound, [
      {
        layer: layerPath("pad"),
        property: "padding",
        value: "0px var(--space-3) 0px 10px",
      },
    ])
  })

  test("records a font-size token used in another property as unbound", async () => {
    const result = await capture(
      `<div data-slot="pad" style="padding: calc(var(--text-xs) * 2)"></div>`
    )
    assert.deepEqual(result.unbound, [
      { layer: layerPath("pad"), property: "padding", value: "24px" },
    ])
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
      `<div layer-name="label" style="display: flex; font-family: Geist; line-height: 21px">`
    )
    assert.deepEqual(
      result.bindings.filter(({ layer }) => layer === layerPath("label")),
      []
    )
  })
})

describe("line-height: normal", () => {
  test("is emitted as the length Chromium lays the text out with", async () => {
    const result = await capture(
      `<div data-slot="x" style="line-height: normal">Text</div>`
    )
    assert.equal(
      elementTag(result, "x"),
      `<div layer-name="x" style="font-family: Geist; line-height: 21px">`
    )
  })
})

describe("what the flattener does not emit", () => {
  const cases = [
    [
      "position: fixed",
      `style="display: flex; position: fixed; top: 5px"`,
      ["position", "top"],
    ],
    [
      "a transform that scales",
      `style="display: flex; transform: rotate(45deg) scale(2)"`,
      ["transform"],
    ],
    ["scale", `style="display: flex; scale: 2"`, ["scale"]],
    [
      "a lone gradient that does not repeat",
      `style="display: flex; background-image: linear-gradient(red, blue); background-repeat: no-repeat"`,
      ["background-image", "background-repeat"],
    ],
    [
      "a scroll container",
      `style="display: flex; overflow: scroll"`,
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
      "color",
      "height",
      "width",
    ])
  })

  const paints = [
    [
      "an image",
      `<img data-slot="x" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="20">`,
      ["element"],
    ],
    [
      "a clip path",
      `<div data-slot="x" style="width: 20px; height: 20px; clip-path: inset(0 50% 0 0)"></div>`,
      ["clip-path"],
    ],
    [
      "a background image from a url",
      `<div data-slot="x" style="width: 20px; height: 20px; background-image: url(&quot;data:image/gif;base64,R0lGODlhAQABAAAAACw=&quot;)"></div>`,
      ["background-image"],
    ],
  ]
  for (const [label, html, expected] of paints) {
    test(`records ${label}`, async () => {
      const result = await capture(html)
      assert.deepEqual(unsupportedAt(result, layerPath("x")), expected)
    })
  }

  test("records a CSS stroke on an svg path", async () => {
    const result = await capture(
      `<style>[data-slot="x"] path { stroke: var(--danger) }</style><div data-slot="x" style="display: flex"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none" stroke="black"/></svg></div>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: `${layerPath("x")} > svg > path`,
        property: "stroke",
        value: "rgb(214, 0, 32)",
      },
    ])
  })

  test("records vertical-align on an inline box", async () => {
    const result = await capture(
      `<div data-slot="line"><span data-slot="x" style="display: inline-block; vertical-align: middle">Icon</span></div>`
    )
    assert.deepEqual(unsupportedAt(result, layerPath("line > x")), [
      "display",
      "vertical-align",
    ])
  })

  test("records content-box sizing only where border-box would change the box", async () => {
    const result = await capture(
      `<div data-slot="wide" style="width: 40px; height: 10px; padding-right: 8px"></div><div data-slot="tall" style="display: flex; min-height: 40px; padding: 4px"><div style="width: 8px; height: 8px"></div></div><div data-slot="plain" style="width: 40px; height: 10px"></div><div data-slot="padded" style="padding: 4px"><div style="width: 8px; height: 8px"></div></div>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: layerPath("wide"),
        property: "box-sizing",
        value: "content-box",
      },
      {
        layer: layerPath("tall"),
        property: "box-sizing",
        value: "content-box",
      },
    ])
  })

  test("records an inline child of a block only where a block would lay it out differently", async () => {
    const result = await capture(
      `<div data-slot="line" style="width: 200px"><span data-slot="time" style="line-height: 20px">Time</span></div><div data-slot="fits" style="line-height: 20px"><span data-slot="button" style="display: inline-flex">Go</span></div>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: layerPath("line > time"),
        property: "display",
        value: "inline in a block",
      },
    ])
  })

  test("records a fieldset's legend, which lays itself out", async () => {
    const result = await capture(
      `<fieldset style="display: flex; margin: 0; padding: 0; border: 0"><legend data-slot="x" style="padding: 0">Title</legend></fieldset>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: layerPath("fieldset > x"),
        property: "element",
        value: "legend",
      },
    ])
  })

  test("records nothing for a list that draws no markers", async () => {
    const result = await capture(
      `<ul data-slot="list" style="margin: 0; padding: 0; list-style: none"><li data-slot="item"><div>One</div><div>Two</div></li></ul>`
    )
    assert.deepEqual(result.unsupported, [])
  })

  for (const [label, listStyle, marker] of [
    ["a list item's marker", "", "disc"],
    [
      "a list item's image marker",
      "list-style: linear-gradient(red, blue)",
      "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))",
    ],
  ]) {
    test(`records ${label}`, async () => {
      const result = await capture(
        `<ul style="margin: 0; ${listStyle}"><li data-slot="item"><div>One</div></li></ul>`
      )
      assert.deepEqual(
        result.unsupported.filter(({ property }) => property === "::marker"),
        [{ layer: layerPath("ul > item"), property: "::marker", value: marker }]
      )
    })
  }

  test("records nothing for a min-width that does not bind", async () => {
    const result = await capture(
      `<div style="display: flex"><div data-slot="x" style="min-width: 0">Text</div></div>`
    )
    assert.deepEqual(result.unsupported, [])
  })

  test("records nothing for an input's default overflow", async () => {
    const result = await capture(`<input data-slot="x">`)
    assert.deepEqual(result.unsupported, [])
  })

  test("records nothing for a plain flex element", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex; padding: var(--space-2); background-color: var(--paper)">Text</div>`
    )
    assert.deepEqual(result.unsupported, [])
  })
})

describe("a batch of examples", () => {
  test("captures the others after one fails, and reports the failure", async () => {
    const outFolder = await mkdtemp(path.join(tmpdir(), "paper-capture-"))
    try {
      const results = await Array.fromAsync(
        captureExamples(browser, ["nope/missing", "button/basic"], {
          outFolder,
        })
      )
      assert.deepEqual(
        results.map(({ name, error }) => ({ name, error })),
        [
          {
            name: "nope/missing",
            error:
              "nope/missing is not an example. Run `ls examples/components/*/web` to list them.",
          },
          { name: "button/basic", error: undefined },
        ]
      )
      const saved = await readFile(
        path.join(outFolder, "button/basic.json"),
        "utf8"
      )
      assert.equal(JSON.parse(saved).name, "button/basic")
    } finally {
      await rm(outFolder, { recursive: true })
    }
  })
})
