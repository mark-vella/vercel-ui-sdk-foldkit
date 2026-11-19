import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Linter } from "eslint"
import { pageFunctions, runInPage } from "../flatten.mjs"
import { toPaperLength } from "../flatten/used-values.mjs"

const browserApis = ["customElements", "document", "getComputedStyle", "Node"]

const freeNames = (fn) =>
  new Linter()
    .verify(`(${fn})`, {
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "script",
        globals: Object.fromEntries(
          browserApis.map((name) => [name, "readonly"])
        ),
      },
      rules: {
        "no-undef": ["error", { typeof: true }],
        "no-restricted-globals": ["error", "escape", "unescape"],
      },
    })
    .map(({ message }) => message)

describe("the functions the flattener runs in the page", () => {
  test("name nothing outside themselves but the browser APIs they use", () => {
    for (const [name, fn] of Object.entries({ ...pageFunctions, runInPage })) {
      assert.deepEqual(freeNames(fn), [], name)
    }
  })

  test("would be caught leaving a name that matches a browser global", () => {
    const visit = (node, parentEntry) => parent?.element ?? node
    assert.deepEqual(freeNames(visit), ["'parent' is not defined."])
  })

  test("would be caught reading a legacy global or testing a name's type", () => {
    const encode = (text) => escape(text)
    const decode = (text) => unescape(text)
    const isNested = () => typeof parent === "object"
    assert.deepEqual([encode, decode, isNested].flatMap(freeNames), [
      "Unexpected use of 'escape'.",
      "Unexpected use of 'unescape'.",
      "'parent' is not defined.",
    ])
  })

  test("run in strict mode, so a stray assignment throws", () => {
    const readFrame = () => {
      strayName = 1
    }
    assert.throws(
      () => runInPage({ sources: { readFrame: String(readFrame) }, input: {} }),
      { name: "ReferenceError", message: "strayName is not defined" }
    )
    assert.equal("strayName" in globalThis, false)
  })

  test("round a length up from Chromium's 1/64 px to Paper's three decimals", () => {
    assert.deepEqual([18.2, 31.671875, 24].map(toPaperLength), [
      "18.204px",
      "31.672px",
      "24px",
    ])
  })
})
