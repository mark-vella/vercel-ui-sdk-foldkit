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
const tagOf = ({ html }, slot) =>
  html.match(new RegExp(`<div layer-name="${slot}"[^>]*>[^<]*`))?.[0]

describe("a pseudo-element's calc() length", () => {
  test("binds to the pseudo-element's own tokens, not its host's", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::before { content: ""; display: block; height: 4px; width: calc(var(--space-1) * 2 + 3px) }</style><div data-slot="x" style="width: calc(var(--space-3) - 1px); background: var(--ink)"></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.deepEqual(
      result.bindings.filter(({ layer }) => layer.endsWith("::before")),
      [
        {
          layer: `${layerPath("x")} > ::before`,
          property: "width",
          token: "--space-1",
        },
      ]
    )
    assert.match(
      result.html,
      /<div style="[^"]*width: calc\(var\(--space-1\) \* 2 \+ 3px\)[^"]*"><\/div><\/div>/
    )
  })
})

describe("a placeholder's line height", () => {
  const field = `height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font: 400 13px / 20px Geist`

  const textarea = `width: 200px; height: 80px; padding: 8px; resize: none; ${field.replace("height: 34px; padding: 0 12px; ", "")}`

  test("is measured with the placeholder's own font size", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::placeholder { font-size: 19px }</style><textarea data-slot="x" placeholder="Notes" style="${textarea.replace("/ 20px", "/ normal")}"></textarea>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      tagOf(result, "x"),
      /; font-size: 19px; line-height: 25px; .*>Notes$/
    )
  })

  test("keeps the placeholder's own length inside a unitless control", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::placeholder { line-height: 24px }</style><textarea data-slot="x" placeholder="Notes" style="${textarea.replace("/ 20px", "/ 1.4")}"></textarea>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(tagOf(result, "x"), /; line-height: 24px\b.*>Notes$/)
  })
})

describe("a pseudo-element that paints", () => {
  test("is emitted as a child, with its tokens", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::after { content: ""; position: absolute; bottom: 5px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: currentColor }</style><div data-slot="x" style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; color: var(--ink); font: 13px / 20px Geist">12</div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      result.html,
      />12<div style="[^"]*width: 4px; height: 4px; [^"]*position: absolute; bottom: 5px; left: 50%; margin: 0px 0px 0px -2px; border-radius: 50%; background-color: var\(--ink\)"><\/div><\/div>/
    )
    assert.deepEqual(result.unbound, [])
  })

  test("that holds only a no-break space keeps it as its text", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::after { content: "\\a0"; font-size: var(--text-sm) }</style><div data-slot="x" style="display: flex; flex-direction: column; width: 200px; font: 14px / var(--leading) Geist"><span data-slot="y">Label</span></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      result.html,
      />Label<\/div><div style="[^"]*">\u00a0<\/div><\/div>/
    )
  })

  test("that holds text is emitted with its text and its colour token", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::before { content: "Write a message…"; position: absolute; color: var(--muted) }</style><div data-slot="x" style="position: relative; width: 200px; height: 20px; font: 13px / 20px Geist"></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      result.html,
      /<div style="[^"]*position: absolute; [^"]*color: var\(--muted\);[^"]*">Write a message…<\/div>/
    )
  })

  test("keeps a fractional length as Chromium lays it out", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::before { content: ""; position: absolute; inset: 0 auto 0 0; width: calc(33.3333% + var(--space-1)); background: var(--ink) }</style><div data-slot="x" style="position: relative; width: 101px; height: 8px"></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(result.html, /<div style="[^"]*width: 37\.657px;/)
    assert.deepEqual(
      result.unbound.map(({ property, value }) => `${property} ${value}`),
      ["width 37.657px"]
    )
  })

  test("records what it paints and Paper is not given, on its own layer", async () => {
    const result = await capture(
      `<style>[data-slot="x"]::before { content: ""; position: absolute; inset: 0; background: var(--ink); mask-image: linear-gradient(black, transparent) }</style><div data-slot="x" style="position: relative; width: 24px; height: 24px"></div>`
    )
    assert.deepEqual(recorded(result), [
      `${layerPath("x")} > ::before mask-image`,
      "picture",
    ])
  })
})

describe("a lone inline box in a block", () => {
  test("becomes a block whose margins hold its line, and keeps its line height token", async () => {
    const result = await capture(
      `<div style="font: 14px / var(--leading) Geist; color: var(--ink)"><span data-slot="x" style="font-size: var(--text-xs); color: var(--muted)">Today, 2:32 PM</span></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      tagOf(result, "x"),
      /^<div layer-name="x" style="min-width: 0px; min-height: 0px; width: fit-content; margin: 1px 0px 0px 0px; color: var\(--muted\);[^"]* font-size: var\(--text-xs\); line-height: var\(--leading\)">Today, 2:32 PM$/
    )
    assert.deepEqual(result.unbound, [])
  })

  test("with a normal line height takes its content area as its line height", async () => {
    const result = await capture(
      `<div style="font: 14px / normal Geist; color: var(--ink)"><span data-slot="x" style="font-size: var(--text-xs)">Today, 2:32 PM</span></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      tagOf(result, "x"),
      /^<div layer-name="x" style="[^"]*margin: 2px 0px 0px 0px;[^"]* line-height: 16px">Today, 2:32 PM$/
    )
  })

  test("that sizes itself keeps its size after a block sibling", async () => {
    const result = await capture(
      `<div style="font: 14px / 20px Geist"><div style="height: 10px; margin-bottom: 8px; background: var(--line)"></div><span data-slot="x" style="display: inline-flex; width: 38px; height: 34px; background: var(--ink)"></span></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      tagOf(result, "x"),
      /^<div layer-name="x" style="display: flex; flex-shrink: 1; width: 38px; height: 34px; min-width: 0px; min-height: 0px; margin: 8px 0px 5px 0px; background-color: var\(--ink\)">$/
    )
  })

  test("beside an svg stays recorded", async () => {
    for (const position of ["static", "absolute"]) {
      const result = await capture(
        `<div style="width: 300px; font: 14px / 24px Geist"><svg width="16" height="16" style="position: ${position}"><rect width="16" height="16" fill="currentColor"></rect></svg><span data-slot="x" style="font-size: 12px">Label</span></div>`
      )
      assert.ok(
        recorded(result).includes(`${layerPath("div > x")} display`),
        position
      )
    }
  })
})

describe("content that is not rendered", () => {
  test("under content-visibility: hidden is emitted as a box that Paper keeps", async () => {
    const result = await capture(
      `<div data-slot="x" hidden="until-found" style="padding: 4px; border: 1px solid var(--line)"><p data-slot="y">Shipping details</p></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.equal(
      result.html.match(/<div layer-name="x".*?<\/div>/)[0],
      `<div layer-name="x" style="padding: 4px; border: 1px solid var(--line)"><svg width="0" height="0" viewBox="0 0 1 1" style="position: absolute"></svg></div>`
    )
    assert.ok(!result.html.includes("Shipping details"))
  })
})

describe("a control's value", () => {
  test("with a no-break space is emitted as its text", async () => {
    const result = await capture(
      `<input data-slot="x" value="1.234,50\u00a0€" style="width: 200px; height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; font: 400 var(--text-md) / var(--leading) Geist; font-variant-numeric: tabular-nums; text-align: center; color: var(--ink)">`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(tagOf(result, "x"), />1\.234,50\u00a0€$/)
  })
})

describe("text beside an absolute box", () => {
  test("is not mixed with it, since the box is out of the line", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: table-cell; position: relative; width: 32px; height: 32px; font: 13px / 20px Geist">12<span style="position: absolute; bottom: 5px; left: 50%; width: 4px; height: 4px; background: var(--ink)"></span></div>`
    )
    assert.deepEqual(recorded(result), [])
    assert.match(
      result.html,
      /<div layer-name="x" style="[^"]*">12<div style="[^"]*width: 4px; height: 4px; [^"]*position: absolute; bottom: 5px; left: 50%;[^"]*background-color: var\(--ink\)"><\/div><\/div>/
    )
  })
})
