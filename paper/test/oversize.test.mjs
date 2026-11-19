import assert from "node:assert/strict"
import { test } from "node:test"
import { oversizeRecords } from "../capture.mjs"

const layers = (count) =>
  Array.from({ length: count }, (_, index) => ({
    layer: index === 0 ? "frame" : "frame > row",
  }))

test("records a frame with more layers than Paper takes", () => {
  assert.deepEqual(oversizeRecords(layers(2501)), [
    {
      layer: "frame",
      property: "layers",
      value: "2501, above the 2500 Paper takes",
    },
  ])
})

test("records nothing for the most layers Paper takes", () => {
  assert.deepEqual(oversizeRecords(layers(2500)), [])
})
