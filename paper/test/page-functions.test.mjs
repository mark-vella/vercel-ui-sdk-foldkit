import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { Linter } from "eslint"
import { pageFunctions, runInPage } from "../flatten.mjs"

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
      rules: { "no-undef": "error" },
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
})
