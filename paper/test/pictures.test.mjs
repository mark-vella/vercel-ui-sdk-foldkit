import assert from "node:assert/strict"
import { test } from "node:test"
import { resizedLayers } from "../pictures.mjs"

test("records each layer the emitted HTML sizes apart from the example", () => {
  const example = [
    { layer: "frame", width: 40, height: 18.188 },
    { layer: "frame > hint", width: 20, height: 18.188 },
    { layer: "frame > icon", width: 16, height: 16 },
  ]
  const emitted = [
    { layer: "frame", width: 40, height: 18.188 },
    { layer: "frame > hint", width: 20, height: 18.203 },
  ]
  assert.deepEqual(resizedLayers(example, emitted), [
    {
      layer: "frame > hint",
      property: "size",
      value: "20x18.203 in the emitted HTML, 20x18.188 in the example",
    },
    {
      layer: "frame > icon",
      property: "size",
      value: "missing in the emitted HTML, 16x16 in the example",
    },
  ])
})
