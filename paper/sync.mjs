import { parseArgs } from "node:util"
import { listCaptureNames, syncComponents } from "./components.mjs"
import { syncFoundations } from "./foundations.mjs"
import { PrerequisiteError, syncPages } from "./pages.mjs"
import { connectPaper } from "./paper-client.mjs"
import {
  describeToken,
  diffTokens,
  readCodeTokens,
  readPaperTokens,
} from "./tokens.mjs"

const usage = `Usage: node paper/sync.mjs <tokens|pages> --file <id>
       node paper/sync.mjs components <component/example>... --file <id>
       node paper/sync.mjs components --all --file <id>
       scripts/test-slot.sh node paper/sync.mjs foundations --file <id>`

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
  options: { file: { type: "string" }, all: { type: "boolean" } },
})
const commands = new Map([
  ["tokens", syncTokens],
  ["pages", syncPages],
  ["components", syncComponents],
  ["foundations", syncFoundations],
])
const [commandName, ...named] = positionals
const command = commands.get(commandName)
const lacksNames =
  commandName === "components" && named.length === 0 && !values.all
if (!command || lacksNames || !values.file) {
  console.error(usage)
  process.exit(2)
}

const names = values.all ? await listCaptureNames() : named
const paper = await connectPaper()
try {
  await command(paper, values.file, names)
} catch (error) {
  if (!(error instanceof PrerequisiteError)) {
    throw error
  }
  console.error(error.message)
  process.exitCode = 1
} finally {
  await paper.close()
}
