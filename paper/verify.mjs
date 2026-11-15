import { parseArgs } from "node:util"
import { connectPaper } from "./paper-client.mjs"
import {
  describeToken,
  diffTokens,
  readCodeTokens,
  readPaperTokens,
} from "./tokens.mjs"

const usage = "Usage: node paper/verify.mjs tokens --file <id>"

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
if (positionals[0] !== "tokens" || !values.file) {
  console.error(usage)
  process.exit(2)
}

const paper = await connectPaper()
try {
  process.exitCode = (await verifyTokens(paper, values.file)) ? 0 : 1
} finally {
  await paper.close()
}
