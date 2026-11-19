import assert from "node:assert/strict"
import { test } from "node:test"
import { compareRows } from "../compare-docs.mjs"

const row = (key, width, height, radius = "0px") => ({
  key,
  width,
  height,
  radius,
})

test("counts layers within half a pixel as the same size", () => {
  assert.deepEqual(
    compareRows([row("button#0", 72, 28)], [row("button#0", 72.5, 27.6)]),
    { sizes: [], squared: 0 }
  )
})

test("names a layer that differs in size", () => {
  assert.deepEqual(
    compareRows([row("input#0", 201, 28)], [row("input#0", 201, 18)]),
    {
      sizes: ["input#0 is 201x18 in the capture, 201x28 in the docs"],
      squared: 0,
    }
  )
})

test("counts a corner the docs square as the known paint difference", () => {
  assert.deepEqual(
    compareRows([row("button#0", 72, 28)], [row("button#0", 72, 28, "6px")]),
    { sizes: [], squared: 1 }
  )
})

test("names a radius that differs in any other way", () => {
  assert.deepEqual(
    compareRows(
      [row("thumb#0", 16, 16, "9999px")],
      [row("thumb#0", 16, 16, "8px")]
    ),
    {
      sizes: ["thumb#0 has radius 8px in the capture, 9999px in the docs"],
      squared: 0,
    }
  )
})

test("names a layer that only one side has", () => {
  assert.deepEqual(
    compareRows([row("row#0", 10, 10)], [row("row#1", 10, 10)]),
    {
      sizes: [
        "row#0 is missing in the capture",
        "row#1 is missing in the docs",
      ],
      squared: 0,
    }
  )
})
