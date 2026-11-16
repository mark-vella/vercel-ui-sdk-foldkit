import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureCompared, launchBrowser } from "../capture.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const svgLayer = "fixture/case > preview > x > svg"
const icon = (attributes, shapes = `<path d="M4 4L20 20"/>`) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" ${attributes}>${shapes}</svg>`
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

const emittedSvg = ({ html }) => html.match(/<svg.*<\/svg>/)[0]
const svgBindings = ({ bindings }) =>
  bindings
    .filter(({ layer }) => layer === svgLayer)
    .map(({ property, token }) => `${property} ${token}`)
    .toSorted()

describe("an svg styled by CSS", () => {
  test("carries its CSS size and its colour token in markup Paper keeps", async () => {
    const result = await capture(
      `<style>[data-slot="x"] svg { width: 16px; height: 16px }</style><div data-slot="x" style="display: flex; color: var(--danger)">${icon(`fill="none" stroke="currentColor"`)}</div>`
    )
    assert.deepEqual(result.unsupported, [])
    assert.equal(
      emittedSvg(result),
      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" style="height: 16px; width: 16px;"><path d="M4 4L20 20"></path></svg>`
    )
    assert.deepEqual(svgBindings(result), ["stroke --danger"])
  })

  test("binds a size the CSS took from a token", async () => {
    const result = await capture(
      `<style>[data-slot="x"] svg { width: var(--size-icon); height: var(--size-icon) }</style><div data-slot="x" style="display: flex">${icon(`fill="none" stroke="black"`)}</div>`
    )
    assert.deepEqual(result.unsupported, [])
    assert.deepEqual(svgBindings(result), [
      "height --size-icon",
      "width --size-icon",
    ])
  })

  test("resolves currentcolor in any letter case", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex; color: rgb(0, 128, 0)">${icon(`fill="currentcolor"`, `<path d="M4 4h16v16z"/>`)}</div>`
    )
    assert.deepEqual(result.unsupported, [])
    assert.match(emittedSvg(result), / fill="rgb\(0, 128, 0\)"/)
  })

  test("keeps the box styles an icon takes from CSS", async () => {
    const result = await capture(
      `<style>[data-slot="x"] svg { order: -1; rotate: -90deg; opacity: 0.7; margin-top: 2px }</style><div data-slot="x" style="display: flex"><span style="width: 8px; height: 8px; background-color: red"></span>${icon(`fill="none" stroke="black"`)}</div>`
    )
    assert.deepEqual(result.unsupported, [])
    assert.match(
      emittedSvg(result),
      / style="margin-top: 2px; opacity: 0\.7; order: -1; rotate: -90deg;"/
    )
  })

  test("records a colour mixed from tokens as bound to none", async () => {
    const result = await capture(
      `<div data-slot="x" style="display: flex; color: color-mix(in oklab, var(--ink) 55%, var(--paper))">${icon(`fill="none" stroke="currentColor"`)}</div>`
    )
    assert.deepEqual(
      { unbound: result.unbound, unsupported: result.unsupported },
      {
        unbound: [
          {
            layer: svgLayer,
            property: "color",
            value: "oklab(0.562541 0.0000256278 0.0000112928)",
          },
        ],
        unsupported: [],
      }
    )
  })

  test("keeps an absolute icon above its static sibling, as it paints", async () => {
    const result = await capture(
      `<div data-slot="x" style="position: relative; display: flex">${icon(`fill="none" stroke="black" style="position: absolute; top: 0; left: 0"`)}<div data-slot="label" style="line-height: 20px">Label</div></div>`
    )
    assert.deepEqual(result.unsupported, [])
    assert.match(result.html, /<div layer-name="label"[^>]*>Label<\/div><svg /)
  })

  test("writes a CSS stroke width as an attribute the shapes inherit", async () => {
    const result = await capture(
      `<style>[data-slot="x"] svg { stroke-width: 2.5 }</style><div data-slot="x" style="display: flex">${icon(`fill="none" stroke="black" stroke-width="2"`)}</div>`
    )
    assert.deepEqual(result.unsupported, [])
    assert.match(emittedSvg(result), / stroke-width="2\.5px"/)
  })

  test("still records a CSS fill on a shape, and the picture it changes", async () => {
    const result = await capture(
      `<style>[data-slot="x"] path { fill: var(--danger) }</style><div data-slot="x" style="display: flex">${icon("", `<path d="M4 4h16v16z"/>`)}</div>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: `${svgLayer} > path`,
        property: "fill",
        value: "rgb(214, 0, 32)",
      },
      {
        layer: "fixture/case > preview > x",
        property: "picture",
        value: "16x16 at 28,58",
      },
    ])
  })

  test("records an svg that sits in a block's line box", async () => {
    const result = await capture(
      `<div data-slot="x" style="width: 40px">${icon(`fill="red" style="display: inline; vertical-align: baseline"`, `<rect width="24" height="24"/>`)}</div>`
    )
    assert.deepEqual(result.unsupported, [
      { layer: svgLayer, property: "display", value: "inline in a block" },
    ])
  })

  test("records an svg made a block in a block, which Paper leaves inline", async () => {
    const result = await capture(
      `<div data-slot="x" style="width: 40px">${icon(`fill="red"`, `<rect width="24" height="24"/>`)}</div>`
    )
    assert.deepEqual(result.unsupported, [
      { layer: svgLayer, property: "display", value: "block" },
    ])
  })
})

describe("an absolute layer that paints nothing", () => {
  const box = `<div data-slot="box" style="position: relative; width: 40px; height: 40px"><div data-slot="x" style="position: absolute; inset: 0"></div></div>`
  const layerAt = ({ layers }, path) =>
    layers.find(({ layer }) => layer === `fixture/case > preview > ${path}`)

  test("keeps its layer in Paper with an empty svg inside", async () => {
    const result = await capture(box)
    assert.deepEqual(result.unsupported, [])
    assert.match(
      result.html,
      /<div layer-name="x" style="[^"]*"><svg width="0" height="0" viewBox="0 0 1 1" style="position: absolute"><\/svg><\/div>/
    )
    assert.deepEqual(layerAt(result, "box > x > svg"), {
      layer: "fixture/case > preview > box > x > svg",
      kind: "svg",
      width: 0,
      height: 0,
    })
  })

  test("is recorded at no opacity, which Paper deletes even with an svg", async () => {
    const result = await capture(
      box.replace("inset: 0", "inset: 0; opacity: 0")
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: "fixture/case > preview > box > x",
        property: "empty layer",
        value: "opacity 0",
      },
    ])
    assert.doesNotMatch(result.html, /<svg/)
  })
})
