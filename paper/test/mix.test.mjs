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

const capture = (style) =>
  captureCompared(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) =>
      page.locator(".example-content").evaluate((preview, content) => {
        preview.innerHTML = content
      }, `<div data-slot="box" style="width: 40px; height: 20px; ${style}"></div>`),
    tokens,
  })

const outcomeOf = ({ html, bindings, unbound, unsupported }) => ({
  style: html.match(/<div layer-name="box" style="([^"]*)"/)[1],
  bindings: bindings
    .filter(({ layer }) => layer.endsWith(" > box"))
    .map(({ property, token }) => `${property} ${token}`),
  unbound: unbound.map(({ property, value }) => `${property} ${value}`),
  unsupported,
})

describe("a token mixed with transparent", () => {
  test("is bound in the form Paper keeps, and the picture matches", async () => {
    const result = await capture(
      "background: color-mix(in oklab, var(--ink) 8%, transparent)"
    )
    assert.deepEqual(outcomeOf(result), {
      style:
        "flex-shrink: 1; width: 40px; height: 20px; background-color: color-mix(in oklab, var(--ink) 8%, transparent)",
      bindings: ["background-color --ink"],
      unbound: [],
      unsupported: [],
    })
  })

  test("is bound inside a shadow beside another shadow", async () => {
    const result = await capture(
      "box-shadow: inset 0 0 0 1px var(--line), 0 1px 2px color-mix(in oklab, var(--ink) 10%, transparent)"
    )
    assert.deepEqual(outcomeOf(result), {
      style:
        "flex-shrink: 1; width: 40px; height: 20px; box-shadow: var(--line) 0px 0px 0px 1px inset, color-mix(in oklab, var(--ink) 10%, transparent) 0px 1px 2px 0px",
      bindings: ["box-shadow --line", "box-shadow --ink"],
      unbound: [],
      unsupported: [],
    })
  })
})

describe("a colour mixed from two tokens", () => {
  test("stays unbound, since Paper drops it", async () => {
    const result = await capture(
      "background: color-mix(in oklab, var(--ink) 50%, var(--paper))"
    )
    assert.deepEqual(outcomeOf(result).unbound, [
      "background-color rgb(129 129 129)",
    ])
  })
})
