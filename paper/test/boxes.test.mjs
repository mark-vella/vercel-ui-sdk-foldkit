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

const styleOf = ({ html }, layer) =>
  html.match(new RegExp(`<div layer-name="${layer}" style="([^"]*)"`))?.[1]

const bindingsAt = ({ bindings }, slot) =>
  bindings
    .filter(({ layer }) => layer.endsWith(` > ${slot}`))
    .map(({ property, token }) => `${property} ${token}`)

describe("an element its own tag sizes", () => {
  test("takes the size the tag gave it, and the picture matches", async () => {
    const result = await capture(
      `<div style="display: flex; flex-direction: column; align-items: flex-start"><div data-slot="row" style="display: flex; gap: var(--space-2)"><input data-slot="input" value="Ten" style="flex: 1; min-width: 0; padding: 0; border: 0; font: inherit; line-height: 20px"><div style="width: 28px; height: 28px; background-color: var(--ink)"></div></div></div>`
    )
    assert.deepEqual(
      {
        input: styleOf(result, "input"),
        bindings: bindingsAt(result, "row"),
        unsupported: result.unsupported,
      },
      {
        input:
          "display: flex; align-items: center; flex-grow: 1; flex-shrink: 1; flex-basis: 0%; width: 218px; min-width: 0px; overflow: clip; font-family: Geist, system-ui, sans-serif; line-height: 20px",
        bindings: ["gap --space-2"],
        unsupported: [],
      }
    )
  })

  test("fits its content where the tag shrinks it", async () => {
    const result = await capture(
      `<div style="width: 200px"><button data-slot="trigger" style="display: inline-flex; align-items: center; height: 28px; padding: 0 var(--space-2); border: 0">Go</button></div>`
    )
    assert.deepEqual(
      {
        trigger: styleOf(result, "trigger"),
        bindings: bindingsAt(result, "trigger"),
        unsupported: result.unsupported,
      },
      {
        trigger:
          "display: flex; align-items: center; flex-shrink: 1; width: fit-content; height: 28px; min-width: 0px; min-height: 0px; padding: 0px var(--space-2); font-family: Geist, system-ui, sans-serif; line-height: 24px; text-align: center",
        bindings: ["padding --space-2"],
        unsupported: [],
      }
    )
  })
})

describe("a content-box size", () => {
  test("is emitted as the border box Paper draws, and keeps its token", async () => {
    const result = await capture(
      `<div style="display: flex; gap: 4px"><div data-slot="literal" style="box-sizing: content-box; width: 2ch; height: 22px; padding: 0 2px; border: 1px solid var(--line)">10</div><div data-slot="token" style="box-sizing: content-box; width: var(--size); min-height: 20px; padding: 4px; background-color: var(--ink)"></div></div>`
    )
    assert.deepEqual(
      {
        literal: styleOf(result, "literal"),
        token: styleOf(result, "token"),
        bindings: bindingsAt(result, "token"),
        unsupported: result.unsupported,
      },
      {
        literal:
          "flex-shrink: 1; width: 27.216px; height: 24px; padding: 0px 2px; border: 1px solid var(--line); font-family: Geist, system-ui, sans-serif; line-height: 24px",
        token:
          "flex-shrink: 1; width: calc(var(--size) + 8px); min-height: 28px; padding: 4px; background-color: var(--ink)",
        bindings: ["width --size", "background-color --ink"],
        unsupported: [],
      }
    )
  })

  test("is recorded where it is a percentage", async () => {
    const result = await capture(
      `<div style="width: 200px"><div data-slot="wide" style="box-sizing: content-box; width: 50%; height: 10px; padding-right: 8px; background-color: var(--ink)"></div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(({ property, value }) => `${property} ${value}`),
      [
        "box-sizing content-box",
        "size 100x10 in the emitted HTML, 108x10 in the example",
        "picture 8x10 at 124,54",
      ]
    )
  })

  test("is recorded where a padding or border is a token", async () => {
    const result = await capture(
      `<div style="display: flex; gap: 4px"><div data-slot="padded" style="box-sizing: content-box; width: 36px; height: 20px; padding: var(--space-1); background-color: var(--ink)"></div><div data-slot="bordered" style="box-sizing: content-box; width: var(--size); height: 20px; padding: var(--space-1); border: var(--space-1) solid var(--line)"></div></div>`
    )
    assert.deepEqual(
      {
        padded: styleOf(result, "padded"),
        bordered: styleOf(result, "bordered"),
        unsupported: result.unsupported.map(
          ({ layer, property, value }) =>
            `${layer.split(" > ").at(-1)} ${property} ${value}`
        ),
      },
      {
        padded:
          "flex-shrink: 1; width: 44px; height: 28px; padding: var(--space-1); background-color: var(--ink)",
        bordered:
          "flex-shrink: 1; width: calc(var(--size) + 16px); height: 36px; padding: var(--space-1); border: var(--space-1) solid var(--line)",
        unsupported: [
          "padded box-sizing content-box",
          "bordered box-sizing content-box",
        ],
      }
    )
  })
})

describe("contain: inline-size", () => {
  test("is emitted as a box that fills its parent and adds no width to it", async () => {
    const result = await capture(
      `<div style="display: flex; flex-direction: column; align-items: center"><div data-slot="field" style="display: flex; flex-direction: column"><div style="width: 120px; height: 20px; background-color: var(--ink)"></div><div data-slot="description" style="contain: inline-size; line-height: 20px">A description longer than the field.</div></div></div>`
    )
    assert.deepEqual(
      {
        description: styleOf(result, "description"),
        unsupported: result.unsupported,
      },
      {
        description:
          "flex-shrink: 1; width: 0px; min-width: 100%; font-family: Geist, system-ui, sans-serif; line-height: 20px",
        unsupported: [],
      }
    )
  })

  test("is recorded where a sibling in a flex row moves with it", async () => {
    const result = await capture(
      `<div data-slot="row" style="display: flex; width: 200px"><div data-slot="description" style="contain: inline-size; line-height: 20px">A description longer than the row</div><div style="width: 40px; height: 20px; background-color: var(--ink)"></div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      [
        "description contain inline-size",
        "fixture/case size 560x118 in the emitted HTML, 560x198 in the example",
        "preview size 512x40 in the emitted HTML, 512x120 in the example",
        "row size 200x40 in the emitted HTML, 200x120 in the example",
        "description size 171.766x40 in the emitted HTML, 0x120 in the example",
        "fixture/case picture 560x198 at 0,0",
      ]
    )
  })
})

describe("text Paper draws in another font", () => {
  test("is recorded where Paper's font stack falls back apart", async () => {
    const result = await capture(
      `<div dir="rtl"><div data-slot="hebrew" style="line-height: 20px">שבוע</div><div data-slot="latin" style="line-height: 20px">Week</div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      ["hebrew font fallback Geist", "hebrew picture 35x11 at 31,59"]
    )
  })

  test("is recorded where Chromium synthesizes a weight Paper does not", async () => {
    const result = await capture(
      `<div dir="rtl"><div data-slot="heading" style="font-weight: 600; line-height: 20px">الحساب</div><div data-slot="latin" style="font-weight: 600; line-height: 20px">Account</div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      [
        "fixture/case font synthesis weight in 44x16 at 44,57",
        "heading picture 44x16 at 44,57",
      ]
    )
  })
})

describe("a fieldset's legend", () => {
  test("fits its text and sits outside the gap, and the picture matches", async () => {
    const result = await capture(
      `<fieldset data-slot="set" style="display: flex; flex-direction: column; gap: var(--space-4); width: 200px; margin: 0; padding: 0; border: 0"><legend data-slot="legend" style="margin-bottom: var(--space-1); padding: 0; line-height: 20px">Title</legend><div style="height: 20px; background-color: var(--ink)"></div></fieldset>`
    )
    assert.deepEqual(
      {
        legend: styleOf(result, "legend"),
        bindings: bindingsAt(result, "legend"),
        unsupported: result.unsupported,
      },
      {
        legend:
          "flex-shrink: 1; width: fit-content; margin: 0px 0px calc(var(--space-1) - var(--space-4)) 0px; font-family: Geist, system-ui, sans-serif; line-height: 20px",
        bindings: ["margin --space-1", "margin --space-4"],
        unsupported: [],
      }
    )
  })

  test("keeps its record where the fit does not lay it out the same", async () => {
    const result = await capture(
      `<fieldset data-slot="set" style="display: flex; gap: var(--space-4); width: 200px; margin: 0; padding: 0; border: 0"><legend data-slot="legend" style="padding: 0; line-height: 20px">Title</legend><div style="width: 20px; height: 20px; background-color: var(--ink)"></div></fieldset>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      [
        "legend element legend",
        "set element fieldset height",
        "fixture/case size 560x98 in the emitted HTML, 560x118 in the example",
        "preview size 512x20 in the emitted HTML, 512x40 in the example",
        "set size 200x20 in the emitted HTML, 200x40 in the example",
        "fixture/case picture 560x118 at 0,0",
      ]
    )
  })
})

describe("an underline with no offset", () => {
  test("is placed from the font, as Paper places it, and recorded where that moves it", async () => {
    const result = await capture(
      `<div data-slot="plain" style="text-decoration: underline; line-height: 20px">Plain</div><div data-slot="offset" style="text-decoration: underline; text-underline-offset: 3px; line-height: 20px">Offset</div>`
    )
    assert.deepEqual(
      {
        plain: styleOf(result, "plain"),
        offset: styleOf(result, "offset"),
        unsupported: result.unsupported,
      },
      {
        plain:
          "font-family: Geist, system-ui, sans-serif; line-height: 20px; text-decoration-line: underline; text-decoration-thickness: auto; text-underline-position: from-font",
        offset:
          "font-family: Geist, system-ui, sans-serif; line-height: 20px; text-decoration-line: underline; text-decoration-thickness: auto; text-underline-offset: 3px",
        unsupported: [
          {
            layer: "fixture/case",
            property: "text-underline-position",
            value: "auto in 37x2 at 24,70",
          },
          {
            layer: "fixture/case > preview > plain",
            property: "picture",
            value: "37x2 at 24,70",
          },
        ],
      }
    )
  })
})

describe("a grid that holds only text", () => {
  test("is recorded where it aligns its content", async () => {
    const result = await capture(
      `<div data-slot="grid" style="display: grid; align-content: center; height: 40px; line-height: 20px">Centered</div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      ["grid display grid with only text"]
    )
  })
})

describe("a value that changes nothing Paper draws", () => {
  test("scale is recorded only on a box that is seen", async () => {
    const result = await capture(
      `<div style="display: flex; gap: 4px"><div data-slot="dot" style="width: 6px; height: 6px; background-color: var(--ink); opacity: 0; scale: 0.5"></div><div data-slot="shown" style="width: 6px; height: 6px; background-color: var(--ink); scale: 0.5"></div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      [
        "shown scale 0.5",
        "shown size 6x6 in the emitted HTML, 3x3 in the example",
        "shown picture 6x6 at 34,54",
      ]
    )
  })

  test("a locale that moves no text is not recorded", async () => {
    const result = await capture(
      `<div data-slot="german" lang="de" style="line-height: 20px">Fälligkeitsdatum</div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      []
    )
  })

  test("a locale that hyphenates the text is recorded", async () => {
    const result = await capture(
      `<div style="width: 80px"><div data-slot="german" lang="de" style="hyphens: auto; line-height: 20px">Fälligkeitsdatum</div></div>`
    )
    assert.deepEqual(
      result.unsupported.map(
        ({ layer, property, value }) =>
          `${layer.split(" > ").at(-1)} ${property} ${value}`
      ),
      [
        "german hyphens auto",
        'german -webkit-locale "de"',
        "fixture/case size 560x98 in the emitted HTML, 560x138 in the example",
        "preview size 512x20 in the emitted HTML, 512x60 in the example",
        "german size 80x20 in the emitted HTML, 80x60 in the example",
        "fixture/case picture 560x138 at 0,0",
      ]
    )
  })
})
