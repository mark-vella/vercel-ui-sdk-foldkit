import { parseArgs } from "node:util"
import { verifyComponents } from "./components.mjs"
import { verifyFoundations } from "./foundations.mjs"
import { MissingPageError, verifyPages } from "./pages.mjs"
import { connectPaper } from "./paper-client.mjs"
import {
  describeToken,
  diffTokens,
  readCodeTokens,
  readPaperTokens,
} from "./tokens.mjs"

const usage = `Usage: node paper/verify.mjs <tokens|pages> --file <id>
       scripts/test-slot.sh node paper/verify.mjs components <component/example>... --file <id>
       scripts/test-slot.sh node paper/verify.mjs foundations --file <id>

components and foundations render each frame's export from Paper in Chromium.`

const verifyTokens = async (paper, fileId) => {
  const { tokens: expected } = await readCodeTokens()
  const diff = diffTokens(expected, await readPaperTokens(paper, fileId))
  for (const token of diff.missing) {
    console.log(`${token.name}: missing, expected ${describeToken(token)}`)
  }
  for (const { name, current, ...token } of diff.changed) {
    console.log(
      `${name}: expected ${describeToken(token)}, Paper has ${describeToken(current)}`
    )
  }
  for (const token of diff.extra) {
    console.log(`${token.name}: extra in Paper, not checked`)
  }
  const differences = diff.missing.length + diff.changed.length
  console.log(
    `tokens: ${diff.unchanged.length} match, ${differences} differ, ${diff.extra.length} extra`
  )
  return differences === 0
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { file: { type: "string" } },
})
const commands = new Map([
  ["tokens", verifyTokens],
  ["pages", verifyPages],
  ["components", verifyComponents],
  ["foundations", verifyFoundations],
])
const [commandName, ...names] = positionals
const command = commands.get(commandName)
const lacksNames = commandName === "components" && names.length === 0
if (!command || lacksNames || !values.file) {
  console.error(usage)
  process.exit(2)
}

const paper = await connectPaper()
try {
  process.exitCode = (await command(paper, values.file, names)) ? 0 : 1
} catch (error) {
  if (!(error instanceof MissingPageError)) {
    throw error
  }
  console.error(error.message)
  process.exitCode = 1
} finally {
  await paper.close()
}
