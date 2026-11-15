import assert from "node:assert/strict"
import { test } from "node:test"
import { verifyFrame } from "../components.mjs"

test("reports two frames with one name and how to fix it", async () => {
  const paper = {
    call: async (tool) => {
      assert.equal(tool, "get_children")
      return {
        children: [
          { id: "1", name: "button/basic" },
          { id: "2", name: "button/basic" },
        ],
      }
    },
  }
  const context = {
    artboards: [{ id: "0", name: "button" }],
    sidecar: { name: "button/basic" },
  }
  assert.deepEqual(await verifyFrame(paper, "file", context), [
    "2 frames are named button/basic. Sync never deletes, so remove the copies in Paper.",
  ])
})
