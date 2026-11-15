import assert from "node:assert/strict"
import { test } from "node:test"
import { parseTree } from "../roundtrip.mjs"

test("reads a layer name that holds quotes, as Paper prints it", () => {
  const tree = parseTree(`Frame "value" (64-0) ?×?
  Text ""Geist Mono"" (65-0) ?×? ""Geist Mono""`)
  assert.deepEqual(
    tree.children.map(({ type, name, id }) => ({ type, name, id })),
    [{ type: "Text", name: '"Geist Mono"', id: "65-0" }]
  )
})
