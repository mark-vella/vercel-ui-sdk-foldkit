import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { launchBrowser } from "../capture.mjs"
import { groupTokens, renderFoundations } from "../foundations.mjs"
import { readCodeTokens } from "../tokens.mjs"

const namesByGroup = (codeTokens) =>
  groupTokens(codeTokens).map(({ group, entries }) => [
    group,
    entries.map(({ name }) => name),
  ])

describe("the specimen list", () => {
  const codeTokens = {
    tokens: [
      { name: "--ink", type: "color", value: "rgb(23 23 23)" },
      { name: "--space-2", type: "spacing", value: "8px" },
      { name: "--size", type: "spacing", value: "34px" },
      { name: "--text-xs", type: "fontSize", value: "12px" },
      { name: "--mono", type: "fontFamily", value: '"Geist Mono"' },
      { name: "--leading", type: "lineHeight", value: "20px" },
      { name: "--radius-row", type: "radius", value: "7px" },
    ],
    skipped: ["--shadow-1", "--duration"],
  }

  test("puts each token in its group, in stylesheet order", () => {
    assert.deepEqual(namesByGroup(codeTokens), [
      ["color", ["--ink"]],
      ["type", ["--text-xs", "--mono", "--leading"]],
      ["spacing", ["--space-2"]],
      ["size", ["--size"]],
      ["radius", ["--radius-row"]],
      ["elevation", ["--shadow-1", "--duration"]],
    ])
  })

  test("gains a row for an added token and loses one for a removed token", () => {
    const changed = {
      tokens: [
        ...codeTokens.tokens.filter(({ name }) => name !== "--ink"),
        { name: "--space-12", type: "spacing", value: "48px" },
      ],
      skipped: ["--shadow-1"],
    }
    assert.deepEqual(namesByGroup(changed), [
      ["color", []],
      ["type", ["--text-xs", "--mono", "--leading"]],
      ["spacing", ["--space-2", "--space-12"]],
      ["size", ["--size"]],
      ["radius", ["--radius-row"]],
      ["elevation", ["--shadow-1"]],
    ])
  })
})

describe("the rendered foundations", () => {
  let browser
  let codeTokens
  let rendered

  before(async () => {
    browser = await launchBrowser()
    codeTokens = await readCodeTokens()
    rendered = await renderFoundations(browser, codeTokens)
  })
  after(() => browser.close())

  test("are one frame per group", () => {
    assert.deepEqual(
      rendered.map(({ name }) => name),
      [
        "color/tokens",
        "type/tokens",
        "spacing/tokens",
        "size/tokens",
        "radius/tokens",
        "elevation/tokens",
      ]
    )
  })

  test("bind each token on the row named after it", () => {
    const rowsWithoutTheirToken = codeTokens.tokens
      .map(({ name }) => name)
      .filter(
        (name) =>
          !rendered.some(({ flat }) =>
            flat.bindings.some(
              ({ layer, token }) =>
                token === name && layer.includes(` > ${name} > specimen`)
            )
          )
      )
    assert.deepEqual(rowsWithoutTheirToken, [])
  })

  test("drop nothing and leave nothing unbound", () => {
    assert.deepEqual(
      rendered.map(({ name, flat }) => [name, flat.unsupported, flat.unbound]),
      rendered.map(({ name }) => [name, [], []])
    )
  })
})
