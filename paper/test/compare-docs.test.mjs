import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { compareRows, report } from "../compare-docs.mjs"

const row = (key, width, height, radius = "0px") => ({
  key,
  width,
  height,
  radius,
})

test("counts layers within half a pixel as the same size", () => {
  assert.deepEqual(
    compareRows([row("button#0", 72, 28)], [row("button#0", 72.5, 27.6)]),
    { sizes: [], known: [], stale: [], squared: 0 }
  )
})

test("names a layer that differs in size", () => {
  assert.deepEqual(
    compareRows([row("input#0", 201, 28)], [row("input#0", 201, 18)]),
    {
      sizes: ["input#0 is 201x18 in the capture, 201x28 in the docs"],
      known: [],
      stale: [],
      squared: 0,
    }
  )
})

test("counts a corner the docs square as the known paint difference", () => {
  assert.deepEqual(
    compareRows([row("button#0", 72, 28)], [row("button#0", 72, 28, "6px")]),
    { sizes: [], known: [], stale: [], squared: 1 }
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
      known: [],
      stale: [],
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
      known: [],
      stale: [],
      squared: 0,
    }
  )
})

describe("a known difference", () => {
  const examples = [["avatar/basic", "avatar"]]
  const known = new Map([
    ["avatar/basic", { layers: ["image#0"], reason: "the image is remote." }],
  ])
  const run = (docsRows, captureRows) => {
    const { text, failures } = report(
      examples,
      new Map([["avatar/basic", { rows: docsRows }]]),
      new Map([["avatar/basic", { rows: captureRows }]]),
      known
    )
    return { lines: text.split("\n").slice(0, -4), failures }
  }

  test("passes when its layers are the only ones that differ", () => {
    assert.deepEqual(
      run(
        [row("image#0", 34, 34), row("label#0", 40, 20)],
        [row("image#0", 1, 1), row("label#0", 40, 20)]
      ),
      {
        lines: [
          "avatar/basic: known, the image is remote.",
          "  image#0 is 1x1 in the capture, 34x34 in the docs",
        ],
        failures: 0,
      }
    )
  })

  test("fails when another layer of its example differs", () => {
    assert.deepEqual(
      run(
        [row("image#0", 34, 34), row("label#0", 40, 20)],
        [row("image#0", 1, 1), row("label#0", 40, 18)]
      ),
      {
        lines: [
          "avatar/basic: known, the image is remote.",
          "  image#0 is 1x1 in the capture, 34x34 in the docs",
          "avatar/basic: differs",
          "  label#0 is 40x18 in the capture, 40x20 in the docs",
        ],
        failures: 1,
      }
    )
  })

  test("fails and names its layers when they no longer differ", () => {
    assert.deepEqual(run([row("image#0", 34, 34)], [row("image#0", 34, 34)]), {
      lines: [
        "avatar/basic: listed as a known difference, but the same this run",
        "  image#0",
      ],
      failures: 1,
    })
  })
})
