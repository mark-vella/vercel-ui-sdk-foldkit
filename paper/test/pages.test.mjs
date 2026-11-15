import assert from "node:assert/strict"
import { test } from "node:test"
import { syncFrames } from "../components.mjs"
import { findPageId, MissingPageError } from "../pages.mjs"

const fileWithoutKitPages = () => {
  const tools = []
  const call = async (tool) => {
    tools.push(tool)
    return { pages: [{ type: "page", id: "p-1-0", name: "Page 1" }] }
  }
  return { tools, call }
}

test("finds a kit page by name", async () => {
  const paper = {
    call: async () => ({
      pages: [
        { type: "page", id: "p-1-0", name: "00 Cover" },
        { type: "page", id: "p-3-0", name: "02 Components" },
      ],
    }),
  }
  assert.equal(await findPageId(paper, "file", "02 Components"), "p-3-0")
})

test("says to sync pages when a kit page is missing", async () => {
  await assert.rejects(
    findPageId(fileWithoutKitPages(), "file", "01 Foundations"),
    new MissingPageError(
      "01 Foundations is missing. Run node paper/sync.mjs pages --file file first."
    )
  )
})

test("writes nothing to a file without the kit pages", async () => {
  const paper = fileWithoutKitPages()
  await assert.rejects(
    syncFrames(paper, "file", {
      page: "02 Components",
      source: () => "examples/components/button",
      captures: [{ html: "<div></div>", sidecar: { name: "button/basic" } }],
    }),
    MissingPageError
  )
  assert.deepEqual(paper.tools, ["get_basic_info"])
})
