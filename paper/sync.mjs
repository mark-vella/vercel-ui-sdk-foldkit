import { parseArgs } from "node:util"
import { connectPaper } from "./paper-client.mjs"
import {
  describeToken,
  diffTokens,
  readCodeTokens,
  readPaperTokens,
} from "./tokens.mjs"

const usage = "Usage: node paper/sync.mjs tokens --file <id>"

const assertApplied = (tool, { tokens }) => {
  const failed = tokens.filter((entry) => entry.result === "error")
  if (failed.length > 0) {
    const messages = failed.map((entry) => `${entry.name}: ${entry.message}`)
    throw new Error(`${tool} failed for ${messages.join(", ")}`)
  }
}

const namesOf = (tokens) => tokens.map((token) => token.name)

const printNames = (label, names) => {
  const list = names.length > 0 ? ` (${names.join(", ")})` : ""
  console.log(`${label} ${names.length}${list}`)
}

const syncTokens = async (paper, fileId) => {
  const { tokens: expected, skipped } = await readCodeTokens()
  const diff = diffTokens(expected, await readPaperTokens(paper, fileId))
  const retyped = diff.changed.filter(
    ({ type, current }) => type !== current.type
  )
  if (retyped.length > 0) {
    for (const { name, type, current } of retyped) {
      console.error(`${name} is ${current.type} in Paper, ${type} in code.`)
    }
    throw new Error("Paper cannot change a token's type without deleting it.")
  }
  if (diff.missing.length > 0) {
    assertApplied(
      "create_tokens",
      await paper.call("create_tokens", { fileId, tokens: diff.missing })
    )
  }
  if (diff.changed.length > 0) {
    const tokens = diff.changed.map(({ name, value }) => ({ name, value }))
    assertApplied(
      "set_tokens",
      await paper.call("set_tokens", { fileId, tokens })
    )
  }
  printNames("created", namesOf(diff.missing))
  for (const { name, current, ...token } of diff.changed) {
    console.log(
      `  ${name}: ${describeToken(current)} -> ${describeToken(token)}`
    )
  }
  printNames("updated", namesOf(diff.changed))
  printNames("unchanged", namesOf(diff.unchanged))
  printNames("extra", namesOf(diff.extra))
  printNames("skipped", skipped)
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { file: { type: "string" } },
})
if (positionals[0] !== "tokens" || !values.file) {
  console.error(usage)
  process.exit(2)
}

const paper = await connectPaper()
try {
  await syncTokens(paper, values.file)
} finally {
  await paper.close()
}
