import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureCompared, launchBrowser } from "../capture.mjs"
import { flattenFrame } from "../flatten.mjs"
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

const recordsOf = ({ unsupported }) =>
  unsupported.map(({ property, value }) => `${property} ${value}`)

const cell = (text) =>
  `<td data-slot="cell" style="width: 30px; height: 24px; padding: 0; vertical-align: top">${text}</td>`
const table = (style, row = cell("1") + cell("2")) =>
  `<table data-slot="table" style="${style}"><thead data-slot="head"><tr data-slot="row">${row}</tr></thead><tbody><tr>${row}</tr></tbody></table>`

describe("a table", () => {
  test("is emitted as flex boxes with its spacing as gaps, and the picture matches", async () => {
    const result = await capture(
      table(
        "border-collapse: separate; border-spacing: 4px 2px; background-color: var(--tint)"
      )
    )
    assert.deepEqual(
      {
        table: styleOf(result, "table"),
        head: styleOf(result, "head"),
        row: styleOf(result, "row"),
        cell: styleOf(result, "cell"),
        unsupported: result.unsupported,
      },
      {
        table:
          "display: flex; flex-direction: column; row-gap: 2px; flex-shrink: 1; width: fit-content; padding: 2px 4px; background-color: var(--tint)",
        head: "display: flex; flex-direction: column",
        row: "display: flex; column-gap: 4px",
        cell: "flex-shrink: 1; width: 30px; height: 24px; font-family: Geist, system-ui, sans-serif; line-height: 24px",
        unsupported: [],
      }
    )
  })

  test("gives its cells the widths it laid them out at when it squeezes them", async () => {
    const result = await capture(
      `<div style="width: 50px">${table("border-collapse: separate; border-spacing: 0")}</div>`
    )
    assert.deepEqual(
      {
        cells: [
          ...result.html.matchAll(
            /layer-name="cell" style="[^"]*?width: ([^;]*)/g
          ),
        ].map(([, width]) => width),
        unsupported: result.unsupported,
      },
      {
        cells: ["24.563px", "25.438px", "24.563px", "25.438px"],
        unsupported: [],
      }
    )
  })

  test("stays recorded where its spacing comes from a token", async () => {
    const result = await capture(
      table("border-collapse: separate; border-spacing: var(--space-1)")
    )
    assert.deepEqual(
      recordsOf(result).filter((record) => !/^(size|picture) /.test(record)),
      [
        "vertical-align top",
        "vertical-align top",
        "display table-row",
        "display table-header-group",
        "vertical-align top",
        "vertical-align top",
        "display table-row",
        "display table-row-group",
        "display table",
        "-webkit-border-horizontal-spacing 4px",
        "-webkit-border-vertical-spacing 4px",
      ]
    )
  })

  test("stays recorded where it inherits its spacing from a token", async () => {
    const result = await capture(
      `<div style="border-spacing: var(--space-1)">${table("border-collapse: separate; border-spacing: inherit")}</div>`
    )
    assert.deepEqual(
      recordsOf(result).filter((record) => /^(display|-webkit)/.test(record)),
      [
        "display table-row",
        "display table-header-group",
        "display table-row",
        "display table-row-group",
        "display table",
        "-webkit-border-horizontal-spacing 4px",
        "-webkit-border-vertical-spacing 4px",
      ]
    )
  })

  test("stays recorded where a cell it squeezes takes its width from a token", async () => {
    const sized = `<td data-slot="cell" style="width: var(--size); height: 24px; padding: 0; vertical-align: top">1</td>`
    const result = await capture(
      `<div style="width: 50px">${table("border-collapse: separate; border-spacing: 0", sized + sized)}</div>`
    )
    assert.deepEqual(
      {
        cells: [
          ...result.html.matchAll(
            /layer-name="cell" style="[^"]*?width: ([^;]*)/g
          ),
        ].map(([, width]) => width),
        records: recordsOf(result).filter((record) => /^display/.test(record)),
      },
      {
        cells: ["var(--size)", "var(--size)", "var(--size)", "var(--size)"],
        records: [
          "display table-row",
          "display table-header-group",
          "display table-row",
          "display table-row-group",
          "display table",
        ],
      }
    )
  })

  test("stays recorded where a cell's width is a token through an ancestor's alias", async () => {
    const sized = `<td data-slot="cell" style="width: var(--w); height: 24px; padding: 0; vertical-align: top">1</td>`
    const result = await capture(
      `<div style="width: 50px; --w: var(--size)">${table("border-collapse: separate; border-spacing: 0", sized + sized)}</div>`
    )
    assert.deepEqual(
      {
        cells: [
          ...result.html.matchAll(
            /layer-name="cell" style="[^"]*?width: ([^;]*)/g
          ),
        ].map(([, width]) => width),
        records: recordsOf(result).filter((record) => /^display/.test(record)),
      },
      {
        cells: ["var(--size)", "var(--size)", "var(--size)", "var(--size)"],
        records: [
          "display table-row",
          "display table-header-group",
          "display table-row",
          "display table-row-group",
          "display table",
        ],
      }
    )
  })

  test("keeps a cell's absolute ::after where it paints, and the picture matches", async () => {
    const day = (text, today = "") =>
      `<td data-slot="day" ${today} style="position: relative; width: 34px; height: 34px; padding: 0; vertical-align: top; text-align: center">${text}</td>`
    const result = await capture(
      `<style>[data-today]::after { content: ""; position: absolute; bottom: 5px; left: 50%; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background-color: var(--ink) }</style>${table("border-collapse: separate; border-spacing: 0 2px", day("11") + day("12", "data-today"))}`
    )
    assert.deepEqual(
      {
        dot: result.html.match(/>12<div style="([^"]*)"/)?.[1],
        unsupported: result.unsupported,
      },
      {
        dot: "flex-shrink: 1; width: 4px; height: 4px; min-width: 0px; min-height: 0px; position: absolute; bottom: 5px; left: 50%; margin: 0px 0px 0px -2px; border-radius: 50%; background-color: var(--ink)",
        unsupported: [],
      }
    )
  })

  test("stays recorded where its flex form would move a text", async () => {
    const middle = `<td data-slot="cell" style="width: 30px; height: 40px; padding: 0; vertical-align: middle">1</td>`
    const result = await capture(
      table("border-collapse: separate; border-spacing: 0", middle + middle)
    )
    assert.deepEqual(
      recordsOf(result).filter((record) => /^display/.test(record)),
      [
        "display table-row",
        "display table-header-group",
        "display table-row",
        "display table-row-group",
        "display table",
      ]
    )
  })

  test("stays recorded where it collapses its borders", async () => {
    const result = await capture(
      `<table style="border-collapse: collapse; border-spacing: 0"><tr><td style="height: 24px; padding: 0; vertical-align: top; border-bottom: 1px solid var(--ink)">1</td></tr></table>`
    )
    assert.deepEqual(
      recordsOf(result).filter((record) => /^(display|border)/.test(record)),
      [
        "display table-row",
        "display table-row-group",
        "display table",
        "border-collapse collapse",
      ]
    )
  })

  test("is left as the example drew it once it is read, kept or not", async () => {
    const page = await browser.newPage()
    const middle = `<td style="width: 30px; height: 40px; padding: 0; vertical-align: middle">1</td>`
    const read = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("table, table *")].map(
          (element) =>
            `${element.localName} ${getComputedStyle(element).display} [${element.getAttribute("style") ?? ""}]`
        )
      )
    try {
      await page.setContent(
        `<div data-example data-paper-layer="fixture/case"><div style="width: 50px">${table("border-collapse: separate; border-spacing: 2px")}</div>${table("border-collapse: separate; border-spacing: 0", middle)}</div>`
      )
      const drawn = await read()
      const { html } = await flattenFrame(page, tokens)
      assert.deepEqual(
        {
          forms: [...html.matchAll(/layer-name="table" style="([^;"]*)/g)].map(
            ([, first]) => first
          ),
          left: await read(),
        },
        { forms: ["display: flex", "min-width: 0px"], left: drawn }
      )
    } finally {
      await page.close()
    }
  })
})
