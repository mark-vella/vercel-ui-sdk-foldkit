import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureCompared, launchBrowser } from "../capture.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
let browser
let tokens

before(async () => {
  browser = await launchBrowser()
  ;({ tokens } = await readCodeTokens())
})
after(() => browser.close())

const capture = (html, prepare = () => {}) =>
  captureCompared(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: async (page) => {
      await page.locator(".example-content").evaluate((preview, content) => {
        preview.innerHTML = content
      }, html)
      await page.evaluate(prepare)
    },
    tokens,
  })

const styleOf = ({ html }, layer) =>
  html.match(new RegExp(`<div layer-name="${layer}" style="([^"]*)"`))?.[1]

const bindingsAt = ({ bindings }, slot) =>
  bindings
    .filter(({ layer }) => layer.endsWith(` > ${slot}`))
    .map(({ property, token }) => `${property} ${token}`)

describe("direction", () => {
  test("is emitted where it changes, and the picture matches", async () => {
    const result = await capture(
      `<div dir="rtl"><div data-slot="row" style="display: flex; gap: var(--space-2)"><div style="width: 20px; height: 10px; background-color: var(--ink)"></div><div data-slot="label" style="line-height: 20px">One.</div></div></div>`
    )
    assert.deepEqual(
      {
        root: result.html.match(
          /<div layer-name="preview"[^>]*><div ([^>]*)>/
        )[1],
        row: styleOf(result, "row"),
        label: styleOf(result, "label"),
        bindings: bindingsAt(result, "row"),
        unsupported: result.unsupported,
      },
      {
        root: `style="direction: rtl"`,
        row: "display: flex; gap: var(--space-2); min-width: 0px; min-height: 0px",
        label: "font-family: Geist, system-ui, sans-serif; line-height: 20px",
        bindings: ["gap --space-2"],
        unsupported: [],
      }
    )
  })
})

describe("fonts", () => {
  test("are emitted as Paper stores them, which synthesizes no style", async () => {
    const result = await capture(
      `<div data-slot="upright" style="line-height: 20px">Upright</div>`
    )
    assert.deepEqual(
      {
        frame: styleOf(result, "fixture/case").match(/font-synthesis: \w+/)[0],
        upright: styleOf(result, "upright"),
        unsupported: result.unsupported,
      },
      {
        frame: "font-synthesis: none",
        upright: "font-family: Geist, system-ui, sans-serif; line-height: 20px",
        unsupported: [],
      }
    )
  })

  test("record a loss where the example draws a style the font lacks", async () => {
    const result = await capture(
      `<div data-slot="slanted" style="font-style: italic; line-height: 20px">Slanted</div>`
    )
    assert.deepEqual(
      result.unsupported.map(({ layer, property }) => `${layer} ${property}`),
      ["fixture/case font synthesis", "fixture/case > preview picture"]
    )
  })
})

describe("a token inside calc()", () => {
  test("is emitted as an expression of its tokens, and the picture matches", async () => {
    const result = await capture(
      `<div data-slot="box" style="display: flex; border-radius: calc(var(--radius-control) + 2px); padding: calc(var(--space-2) * -1 + 10px) calc(var(--size) / 2 + var(--space-1)); background-color: var(--ink)"><div style="width: 10px; height: 10px"></div></div>`
    )
    assert.deepEqual(
      {
        box: styleOf(result, "box"),
        bindings: bindingsAt(result, "box"),
        unbound: result.unbound,
        unsupported: result.unsupported,
      },
      {
        box: "display: flex; padding: calc(var(--space-2) * -1 + 10px) calc(var(--space-1) + var(--size) * 0.5); border-radius: calc(var(--radius-control) + 2px); background-color: var(--ink)",
        bindings: [
          "padding --space-2",
          "padding --space-1",
          "padding --size",
          "border-radius --radius-control",
          "background-color --ink",
        ],
        unbound: [],
        unsupported: [],
      }
    )
  })

  test("stays unbound where the value is not linear in its tokens", async () => {
    const result = await capture(
      `<div data-slot="box" style="display: flex; padding-left: max(var(--space-2), 10px)"><div style="width: 10px; height: 10px"></div></div>`
    )
    assert.deepEqual(result.unbound, [
      {
        layer: "fixture/case > preview > box",
        property: "padding",
        value: "0px 0px 0px 10px",
      },
    ])
  })

  test("stays unbound where its slopes either side of the token differ", async () => {
    const result = await capture(
      `<div data-slot="box" style="display: flex; padding-left: max(var(--space-3) + 1px, 13px)"><div style="width: 10px; height: 10px"></div></div>`
    )
    assert.deepEqual(result.unbound, [
      {
        layer: "fixture/case > preview > box",
        property: "padding",
        value: "0px 0px 0px 13px",
      },
    ])
  })

  test("stays unbound where its tokens are linear alone and not together", async () => {
    const result = await capture(
      `<div data-slot="box" style="display: flex; padding-left: max(var(--space-1) + var(--space-6), 26.8px)"><div style="width: 10px; height: 10px"></div></div>`
    )
    assert.deepEqual(result.unbound, [
      {
        layer: "fixture/case > preview > box",
        property: "padding",
        value: "0px 0px 0px 28px",
      },
    ])
  })
})

describe("a line height", () => {
  test("of a plain number is emitted as the length Chromium lays out", async () => {
    const result = await capture(
      `<div data-slot="hint" style="font-size: 13px; line-height: 1.4">Show</div>`
    )
    assert.deepEqual(
      { hint: styleOf(result, "hint"), unsupported: result.unsupported },
      {
        hint: "font-family: Geist, system-ui, sans-serif; font-size: 13px; line-height: 18.188px",
        unsupported: [],
      }
    )
  })
})

describe("a grid that holds only text", () => {
  test("is emitted as the flex container that aligns it the same", async () => {
    const result = await capture(
      `<div data-slot="dots" style="display: inline-grid; place-items: center; width: 20px; height: 28px; line-height: 20px">…</div>`
    )
    assert.deepEqual(
      { dots: styleOf(result, "dots"), unsupported: result.unsupported },
      {
        dots: "display: flex; align-items: center; justify-content: center; flex-shrink: 1; width: 20px; height: 28px; font-family: Geist, system-ui, sans-serif; line-height: 20px",
        unsupported: [],
      }
    )
  })

  test("is emitted as the block Paper falls back to, where that aligns it the same", async () => {
    const result = await capture(
      `<div data-slot="remove" style="display: inline-grid; place-items: center; width: 16px; height: 16px; font-size: 12px; line-height: 20px; text-align: center">×</div>`
    )
    assert.deepEqual(
      { remove: styleOf(result, "remove"), unsupported: result.unsupported },
      {
        remove:
          "flex-shrink: 1; width: 16px; height: 16px; font-family: Geist, system-ui, sans-serif; font-size: 12px; line-height: 20px; text-align: center",
        unsupported: [],
      }
    )
  })

  test("is recorded where no flex container aligns it the same", async () => {
    const result = await capture(
      `<div data-slot="dots" style="display: grid; grid-template-columns: 1fr 1fr; justify-items: center; width: 40px; line-height: 20px">…</div>`
    )
    assert.deepEqual(
      result.unsupported.filter(({ property }) => property === "display"),
      [
        {
          layer: "fixture/case > preview > dots",
          property: "display",
          value: "grid with only text",
        },
      ]
    )
  })
})

describe("an inline box in a block", () => {
  test("records nothing for an unnamed wrapper whose box nothing draws", async () => {
    const result = await capture(
      `<div><span><span data-slot="trigger" style="display: inline-flex; align-items: center; height: var(--size); padding: 0 var(--space-3); background-color: var(--ink); color: var(--paper)">Open</span></span></div>`
    )
    assert.deepEqual(
      { trigger: styleOf(result, "trigger"), unsupported: result.unsupported },
      {
        trigger:
          "display: flex; align-items: center; flex-shrink: 1; height: var(--size); min-width: 0px; min-height: 0px; padding: 0px var(--space-3); background-color: var(--ink); color: var(--paper); font-family: Geist, system-ui, sans-serif; line-height: 24px",
        unsupported: [],
      }
    )
  })

  test("is emitted as a box of its own width where its line is its own", async () => {
    const result = await capture(
      `<div style="line-height: 20px"><a data-slot="link" style="line-height: 24px; text-decoration-line: underline; text-underline-offset: 3px">Link</a></div>`
    )
    assert.deepEqual(
      {
        link: styleOf(result, "link"),
        size: result.layers.find(({ layer }) => layer.endsWith("link")),
        unsupported: result.unsupported,
      },
      {
        link: "min-width: 0px; min-height: 0px; width: fit-content; font-family: Geist, system-ui, sans-serif; line-height: 24px; text-decoration-line: underline; text-decoration-thickness: auto; text-underline-offset: 3px",
        size: {
          layer: "fixture/case > preview > div > link",
          kind: "slot",
          width: 31.125,
          height: 24,
        },
        unsupported: [],
      }
    )
  })

  test("is recorded where it wraps on its parent's taller lines", async () => {
    const result = await capture(
      `<div style="line-height: 30px; width: 60px"><a data-slot="link" style="line-height: 20px">Link to the docs</a></div>`
    )
    assert.deepEqual(
      result.unsupported.filter(({ property }) => property === "display"),
      [
        {
          layer: "fixture/case > preview > div > link",
          property: "display",
          value: "inline in a block",
        },
      ]
    )
  })
})

describe("a scroll container", () => {
  const list = (style) =>
    `<div data-slot="list" style="display: flex; flex-direction: column; width: 40px; height: 20px; overflow-y: auto; ${style}"><div style="height: 40px; flex-shrink: 0; background-color: var(--ink)"></div></div>`

  test("at rest is emitted as the clip Paper stores, and the picture matches", async () => {
    const result = await capture(list(""))
    assert.deepEqual(
      { list: styleOf(result, "list"), unsupported: result.unsupported },
      {
        list: "display: flex; flex-direction: column; flex-shrink: 1; width: 40px; height: 20px; min-width: 0px; min-height: 0px; overflow: clip",
        unsupported: [],
      }
    )
  })

  test("where a script scrolled it is a clip whose content moves up, and the picture matches", async () => {
    const result = await capture(list(""), () => {
      document.querySelector('[data-slot="list"]').scrollTop = 5
    })
    assert.deepEqual(
      {
        content: result.html.match(
          /<div layer-name="list"[^>]*><div style="([^"]*)"/
        )?.[1],
        unsupported: result.unsupported,
      },
      {
        content:
          "flex-shrink: 0; height: 40px; position: relative; top: -5px; left: 0px; background-color: var(--ink)",
        unsupported: [],
      }
    )
  })

  test("records an absolute layer it holds at no opacity, which Paper deletes", async () => {
    const result = await capture(
      `<div data-slot="area" style="position: relative; width: 40px; height: 20px"><div data-slot="bar" style="position: absolute; top: 0; right: 0; bottom: 0; width: 4px; opacity: 0"><div style="height: 10px; background-color: var(--ink)"></div></div></div>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: "fixture/case > preview > area > bar",
        property: "empty layer",
        value: "opacity 0",
      },
    ])
  })

  test("is recorded where its scrollbar takes room", async () => {
    const result = await capture(list("scrollbar-gutter: stable"))
    assert.deepEqual(
      result.unsupported.map(({ property, value }) => `${property} ${value}`),
      ["overflow-y auto", "scrollbar-gutter stable", "picture 15x20 at 49,54"]
    )
  })
})
