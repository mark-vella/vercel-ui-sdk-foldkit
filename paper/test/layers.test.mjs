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

const recorded = ({ unsupported }) =>
  unsupported.map(
    ({ layer, property }) => `${layer.split(" > ").at(-1)} ${property}`
  )

describe("a fixed box", () => {
  test("that paints nothing is placed where it lands in its parent, and its insets are unbound, since its parent moves with the frame's tokens", async () => {
    const result = await capture(
      `<div data-slot="host" style="display: flex"><div style="width: 40px; height: 20px; background-color: var(--ink)"></div><div data-slot="region" style="position: fixed; right: 0; bottom: 0; width: 100px; height: 0; margin: var(--space-4)"><div data-slot="list"></div></div></div>`
    )
    assert.deepEqual(
      {
        host: styleOf(result, "host"),
        region: styleOf(result, "region"),
        regionChildren: result.html.match(
          /<div layer-name="region"[^>]*>(.*?)<\/div><\/div>/
        )?.[1],
        bindings: result.bindings
          .filter(({ layer }) => layer.endsWith(" > region"))
          .map(({ property, token }) => `${property} ${token}`),
        unsupported: result.unsupported,
        unbound: result.unbound,
      },
      {
        host: "display: flex; position: relative",
        region:
          "flex-shrink: 1; width: 100px; height: 0px; min-width: 0px; min-height: 0px; position: absolute; top: 730px; left: 1140px",
        regionChildren:
          '<div layer-name="list" style="min-width: 0px; min-height: 0px"></div><svg width="0" height="0" viewBox="0 0 1 1" style="position: absolute"></svg>',
        bindings: [],
        unsupported: [],
        unbound: [
          {
            layer: "fixture/case > preview > host > region",
            property: "top",
            value: "730px",
          },
          {
            layer: "fixture/case > preview > host > region",
            property: "left",
            value: "1140px",
          },
        ],
      }
    )
  })

  test("loses the token of an inset it is placed by", async () => {
    const result = await capture(
      `<div data-slot="region" style="position: fixed; bottom: var(--space-2); left: 0; width: 100px; height: 0"></div>`
    )
    assert.deepEqual(result.unbound, [
      {
        layer: "fixture/case > preview > region",
        property: "top",
        value: "738px",
      },
    ])
  })

  test("with no area that holds a painting child is recorded, since Chromium composites it", async () => {
    const result = await capture(
      `<div data-slot="region" style="position: fixed; top: 40px; left: 40px; width: 100px; height: 0"><div data-slot="toast" style="width: 100px; height: 28px; border-radius: 8px; background-color: var(--ink)"></div></div>`
    )
    assert.deepEqual(recorded(result).slice(0, 1), ["region position"])
  })

  test("that paints is recorded, since Chromium composites it", async () => {
    const result = await capture(
      `<div data-slot="tip" style="position: fixed; top: 4px; left: 4px; width: 20px; height: 20px; background-color: var(--ink)"></div>`
    )
    assert.deepEqual(recorded(result).slice(0, 1), ["tip position"])
  })
})

describe("an absolute box placed against an ancestor other than its parent", () => {
  test("is placed against its parent at its own size, and the picture matches", async () => {
    const result = await capture(
      `<div style="position: relative; display: flex; width: 200px; padding: var(--space-2)"><div data-slot="inner" style="display: flex; width: 10px"><div data-slot="tag" style="position: absolute; top: 0; left: 0; line-height: 20px; background-color: var(--tint)">Two words</div></div></div>`
    )
    assert.deepEqual(
      {
        inner: styleOf(result, "inner"),
        tag: styleOf(result, "tag"),
        unsupported: result.unsupported,
      },
      {
        inner: "display: flex; flex-shrink: 1; width: 10px; position: relative",
        tag: "flex-shrink: 1; width: 78.704px; height: 20px; min-width: 0px; min-height: 0px; position: absolute; top: calc(var(--space-2) * -1); left: calc(var(--space-2) * -1); background-color: var(--tint); font-family: Geist, system-ui, sans-serif; line-height: 20px",
        unsupported: [],
      }
    )
  })

  test("anchored on the far side is bound to its margin token with a negative factor, at any value of the token", async () => {
    const placed = async (space) => {
      const result = await capture(
        `<style>[data-example][data-example] { --space-4: ${space} }</style><div style="position: relative; width: 200px; height: 100px"><div style="display: flex"><div data-slot="tag" style="position: absolute; right: 0; bottom: 0; width: 40px; height: 20px; margin-right: var(--space-4); margin-bottom: var(--space-2); background-color: var(--tint)"></div></div></div>`
      )
      return {
        tag: styleOf(result, "tag"),
        bindings: result.bindings
          .filter(({ layer }) => layer.endsWith(" > tag"))
          .map(({ property, token }) => `${property} ${token}`),
        unbound: result.unbound,
        unsupported: result.unsupported,
      }
    }
    const expected = {
      tag: "flex-shrink: 1; width: 40px; height: 20px; min-width: 0px; min-height: 0px; position: absolute; top: calc(var(--space-2) * -1 + 80px); left: calc(var(--space-4) * -1 + 160px); background-color: var(--tint)",
      bindings: ["top --space-2", "left --space-4", "background-color --tint"],
      unbound: [],
    }
    assert.deepEqual(await placed("16px"), { ...expected, unsupported: [] })
    const { unsupported, ...at26 } = await placed("26px")
    assert.deepEqual(at26, expected)
  })

  test("is placed before its own translate, and the picture matches", async () => {
    const result = await capture(
      `<div style="position: relative; width: 200px; height: 100px"><div style="display: flex"><div data-slot="tag" style="position: absolute; top: 0; left: 50%; translate: -50% 0; width: 60px; height: 20px; background-color: var(--ink)"></div></div></div>`
    )
    assert.deepEqual(
      { tag: styleOf(result, "tag"), unsupported: result.unsupported },
      {
        tag: "flex-shrink: 1; width: 60px; height: 20px; min-width: 0px; min-height: 0px; position: absolute; top: 0px; left: 100px; background-color: var(--ink); translate: -50%",
        unsupported: [],
      }
    )
  })

  test("makes a static parent relative without waking its insets, and the picture matches", async () => {
    const result = await capture(
      `<div style="position: relative; width: 200px; height: 100px"><div data-slot="inner" style="display: flex; width: 100px; height: 50px; top: 30px; left: 10px; background-color: var(--tint)"><div data-slot="tag" style="position: absolute; top: 0; right: 0; width: 20px; height: 20px; background-color: var(--ink)"></div></div></div>`
    )
    assert.deepEqual(
      { inner: styleOf(result, "inner"), unsupported: result.unsupported },
      {
        inner:
          "display: flex; flex-shrink: 1; width: 100px; height: 50px; min-width: 0px; min-height: 0px; position: relative; background-color: var(--tint)",
        unsupported: [],
      }
    )
  })
})

describe("clip-path: inset(50%)", () => {
  test("is emitted without the overflow it hides, and the picture matches", async () => {
    const result = await capture(
      `<div style="position: relative; height: 20px"><span data-slot="hidden" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap">Previous</span></div>`
    )
    assert.deepEqual(
      { hidden: styleOf(result, "hidden"), unsupported: result.unsupported },
      {
        hidden:
          "flex-shrink: 1; width: 1px; height: 1px; min-width: 0px; min-height: 0px; position: absolute; top: 0px; left: 0px; font-family: Geist, system-ui, sans-serif; line-height: 24px; white-space: nowrap; clip-path: inset(50%)",
        unsupported: [],
      }
    )
  })
})

describe("a scroller", () => {
  test("away from its start is a clip whose children move by its offset, and the picture matches", async () => {
    const result = await capture(
      `<div data-slot="viewport" style="display: flex; width: 100px; overflow-x: auto; scroll-snap-type: x mandatory"><div data-slot="first" style="flex: 0 0 100px; height: 40px; scroll-snap-align: start; background-color: var(--ink)"></div><div data-slot="second" style="flex: 0 0 100px; height: 40px; scroll-snap-align: start; scroll-snap-stop: always; background-color: var(--tint); interactivity: inert"></div></div>`,
      () => {
        document.querySelector('[data-slot="viewport"]').scrollLeft = 100
      }
    )
    assert.deepEqual(
      {
        viewport: styleOf(result, "viewport"),
        second: styleOf(result, "second"),
        unsupported: result.unsupported,
      },
      {
        viewport:
          "display: flex; flex-shrink: 1; width: 100px; min-width: 0px; min-height: 0px; overflow: clip",
        second:
          "flex-shrink: 0; flex-basis: 100px; height: 40px; position: relative; top: 0px; left: -100px; background-color: var(--tint)",
        unsupported: [],
      }
    )
  })

  test("at rest draws its rounded content as the clip Paper stores", async () => {
    const result = await capture(
      `<div style="display: flex; width: 100px; overflow-x: auto; border-radius: 10px"><div style="flex: 0 0 100px; height: 60px; border-radius: 10px; background-color: var(--tint); box-shadow: var(--line-faint) 0px 0px 0px 1px inset"></div><div style="flex: 0 0 100px; height: 60px"></div></div>`
    )
    assert.deepEqual(result.unsupported, [])
  })

  test("scrolled away from its start with a sticky child is recorded", async () => {
    const result = await capture(
      `<div data-slot="viewport" style="width: 100px; height: 100px; overflow-y: auto"><div style="position: sticky; top: 0; height: 20px; background-color: var(--tint)"></div><div style="height: 300px"></div></div>`,
      () => {
        document.querySelector('[data-slot="viewport"]').scrollTop = 50
      }
    )
    assert.deepEqual(recorded(result).slice(0, 1), ["viewport overflow-y"])
  })

  test("with rounded corners and a background is recorded, since Chromium draws it unlike a clip", async () => {
    const result = await capture(
      `<div data-slot="list" style="width: 200px; height: 100px; overflow: auto; border-radius: 10px; background-color: var(--tint)"><div style="height: 300px; background-color: var(--ink)"></div></div>`
    )
    assert.deepEqual(recorded(result).slice(0, 1), ["list overflow-y"])
  })
})

describe("a layer below zero", () => {
  test("is recorded where its parent forms no stacking context, since Paper paints it over the parent", async () => {
    const result = await capture(
      `<div data-slot="host" style="position: relative; width: 40px; height: 20px; background-color: var(--tint)"><div data-slot="ink" style="position: absolute; inset: -4px; z-index: -1; background-color: var(--ink)"></div></div><div data-slot="isolated" style="position: relative; isolation: isolate; width: 40px; height: 20px; background-color: var(--tint)"><div data-slot="shade" style="position: absolute; inset: -4px; z-index: -1; background-color: var(--ink)"></div></div>`
    )
    assert.deepEqual(
      recorded(result).filter((record) => record.endsWith("z-index")),
      ["ink z-index"]
    )
  })

  test("is recorded as a pseudo-element under a host that forms no stacking context", async () => {
    const result = await capture(
      `<style>[data-slot="host"]::before { content: ""; position: absolute; inset: -4px; z-index: -1; background-color: var(--ink) }</style><div data-slot="host" style="position: relative; width: 40px; height: 20px; background-color: var(--tint)"></div>`
    )
    assert.deepEqual(
      result.unsupported
        .filter(({ property }) => property === "z-index")
        .map(({ layer, value }) => `${layer.split(" > ").at(-1)} ${value}`),
      ["::before -1"]
    )
  })
})
