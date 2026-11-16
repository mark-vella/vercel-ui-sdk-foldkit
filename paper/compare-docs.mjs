import { spawn } from "node:child_process"
import { once } from "node:events"
import { glob, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import {
  captureExamples,
  launchBrowser,
  noMotion,
  pageOptions,
} from "./capture.mjs"
import { captionsIn } from "./census.mjs"

const usage =
  "Usage: DOCS_PORT=<port> node paper/compare-docs.mjs [component/example]..."
const repo = fileURLToPath(new URL("..", import.meta.url))
const docsApp = path.join(repo, "apps/docs")
const docsPages = "apps/docs/content/docs/web-components/components/*.mdx"
const sizeTolerance = 0.5
const startupTimeout = 180_000
const docsQuietPeriod = 1000
const docsSettleLimit = 10_000
const paintDifference =
  "The docs square every corner with border-radius: 0 !important in apps/docs/app/global.css. The capture keeps the corners the example's CSS writes, bound to the radius tokens."

const knownDifferences = new Map([
  [
    "avatar/basic",
    {
      layers: ["avatar-image#0", "avatar-fallback#0", "visually-hidden#0"],
      reason:
        "its image loads from https://github.com/shadcn.png. The capture reads the frame before the image arrives and shows the fallback, and the docs page shows the photo. Whether a capture waits for a remote image or serves it locally is not decided yet.",
    },
  ],
])

const readDocsExamples = async () => {
  const pages = new Map()
  for await (const file of glob(docsPages, { cwd: repo })) {
    const page = await readFile(path.join(repo, file), "utf8")
    for (const [name] of captionsIn(page)) {
      if (!pages.has(name)) {
        pages.set(name, path.basename(file, ".mdx"))
      }
    }
  }
  return pages
}

const isServing = (url) =>
  fetch(url).then(
    () => true,
    () => false
  )

const startDocs = async (port) => {
  const url = `http://localhost:${port}`
  if (await isServing(url)) {
    throw new Error(`Port ${port} is in use. Set DOCS_PORT to a free port.`)
  }
  const nextEnv = path.join(docsApp, "next-env.d.ts")
  const nextEnvText = await readFile(nextEnv, "utf8")
  const next = createRequire(new URL("../apps/docs/", import.meta.url)).resolve(
    "next/dist/bin/next"
  )
  const server = spawn(process.execPath, [next, "dev", "--port", port], {
    cwd: docsApp,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  })
  let errorOutput = ""
  server.stderr.on("data", (chunk) => {
    errorOutput = `${errorOutput}${chunk}`.slice(-2000)
  })
  const exited = once(server, "exit")
  let stopping = null
  // next dev rewrites next-env.d.ts, which is checked in.
  const stop = () => {
    stopping ??= (async () => {
      process.off("SIGINT", stopAndExit)
      process.off("SIGTERM", stopAndExit)
      if (server.exitCode === null) {
        process.kill(-server.pid, "SIGTERM")
        await exited
      }
      await writeFile(nextEnv, nextEnvText)
    })()
    return stopping
  }
  const stopAndExit = async (signal) => {
    await stop()
    process.exit(signal === "SIGINT" ? 130 : 143)
  }
  process.once("SIGINT", stopAndExit)
  process.once("SIGTERM", stopAndExit)
  const deadline = Date.now() + startupTimeout
  const firstPage = `${url}/docs/web-components/components/button`
  while (!(await isServing(firstPage))) {
    if (server.exitCode !== null || Date.now() > deadline) {
      await stop()
      throw new Error(
        `The docs site didn't start on port ${port}.\n${errorOutput}`
      )
    }
    await delay(500)
  }
  return { url, stop }
}

const waitUntilQuiet = async ({ selector, quietFor, limit }) => {
  const started = performance.now()
  let lastChange = started
  const observer = new MutationObserver(() => {
    lastChange = performance.now()
  })
  observer.observe(document.querySelector(selector), {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  const isQuiet = () => performance.now() - lastChange >= quietFor
  while (!isQuiet() && performance.now() - started < limit) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  observer.disconnect()
  return isQuiet()
}

const measureLayers = (selector) => {
  const root = document.querySelector(selector)
  const counts = new Map()
  const rows = []
  const add = (key, element) => {
    const { width, height } = element.getBoundingClientRect()
    rows.push({
      key,
      width: Math.round(width * 100) / 100,
      height: Math.round(height * 100) / 100,
      radius: getComputedStyle(element).borderTopLeftRadius,
    })
  }
  const kindOf = (element) =>
    element.dataset?.slot ||
    (/^(h[1-6]|p|ul|ol|li|dl|svg|img|button|input|label|table)$/.test(
      element.localName
    )
      ? element.localName
      : null)
  const walk = (parent) => {
    for (const child of parent.children) {
      const kind = kindOf(child)
      if (kind) {
        const index = counts.get(kind) ?? 0
        counts.set(kind, index + 1)
        add(`${kind}#${index}`, child)
      }
      walk(child)
    }
    if (parent.shadowRoot) {
      walk(parent.shadowRoot)
    }
  }
  add("preview", root)
  walk(root)
  return rows
}

const measureDocs = async (browser, url, examples) => {
  const byPage = Map.groupBy(examples, ([, page]) => page)
  const measured = new Map()
  for (const [docsPage, entries] of byPage) {
    const page = await browser.newPage(pageOptions)
    try {
      await page.goto(`${url}/docs/web-components/components/${docsPage}`, {
        timeout: startupTimeout,
      })
      await page.addStyleTag({ content: noMotion })
      for (const [name] of entries) {
        measured.set(name, await measureDocsExample(page, name))
      }
    } finally {
      await page.close()
    }
  }
  return measured
}

const measureDocsExample = async (page, name) => {
  const host = `[data-example="${name}"]`
  try {
    await page.locator(host).first().scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (selector) => {
        const content = document.querySelector(selector)?.firstElementChild
        return content && !content.inert && content.children.length > 0
      },
      host,
      { timeout: 30_000 }
    )
  } catch {
    return { error: "never mounted on its docs page" }
  }
  const isQuiet = await page.evaluate(waitUntilQuiet, {
    selector: host,
    quietFor: docsQuietPeriod,
    limit: docsSettleLimit,
  })
  if (!isQuiet) {
    return { error: "never stopped changing on its docs page" }
  }
  // Previews above it can grow as they mount and push it off screen, where
  // the docs' content-visibility: auto skips its layout.
  await page.locator(host).first().scrollIntoViewIfNeeded()
  await page.evaluate(waitUntilQuiet, {
    selector: host,
    quietFor: 100,
    limit: docsSettleLimit,
  })
  return { rows: await page.evaluate(measureLayers, `${host} > div`) }
}

const measureCapture = async (browser, names) => {
  const outFolder = await mkdtemp(path.join(tmpdir(), "paper-compare-docs-"))
  const measured = new Map()
  try {
    for await (const { name, inspection, error } of captureExamples(
      browser,
      names,
      {
        outFolder,
        inspect: (page) =>
          page.evaluate(measureLayers, '[data-paper-layer="preview"]'),
      }
    )) {
      measured.set(name, error ? { error } : { rows: inspection })
    }
  } finally {
    await rm(outFolder, { recursive: true })
  }
  return measured
}

const compareRows = (docs, capture, knownLayers = []) => {
  const captured = new Map(capture.map((row) => [row.key, row]))
  const differences = []
  const differ = (layer, text) => differences.push({ layer, text })
  let squared = 0
  for (const row of docs) {
    const other = captured.get(row.key)
    captured.delete(row.key)
    if (!other) {
      differ(row.key, `${row.key} is missing in the capture`)
      continue
    }
    const isSameSize =
      Math.abs(row.width - other.width) <= sizeTolerance &&
      Math.abs(row.height - other.height) <= sizeTolerance
    if (!isSameSize) {
      differ(
        row.key,
        `${row.key} is ${other.width}x${other.height} in the capture, ${row.width}x${row.height} in the docs`
      )
    }
    if (row.radius === "0px" && other.radius !== "0px") {
      squared++
    } else if (row.radius !== other.radius) {
      differ(
        row.key,
        `${row.key} has radius ${other.radius} in the capture, ${row.radius} in the docs`
      )
    }
  }
  for (const key of captured.keys()) {
    differ(key, `${key} is missing in the docs`)
  }
  const isKnown = ({ layer }) => knownLayers.includes(layer)
  const texts = (list) => list.map(({ text }) => text)
  return {
    sizes: texts(differences.filter((difference) => !isKnown(difference))),
    known: texts(differences.filter(isKnown)),
    stale: knownLayers.filter(
      (layer) => !differences.some((difference) => difference.layer === layer)
    ),
    squared,
  }
}

const report = (examples, docs, capture, listedDifferences) => {
  const lines = []
  let same = 0
  let knownLayers = 0
  let squaredLayers = 0
  let squaredExamples = 0
  let failures = 0
  const indented = (texts) => texts.map((text) => `  ${text}`)
  for (const [name] of examples) {
    const error = docs.get(name).error ?? capture.get(name).error
    if (error) {
      failures++
      lines.push(`${name}: not compared, ${error}`)
      continue
    }
    const listed = listedDifferences.get(name)
    const { sizes, known, stale, squared } = compareRows(
      docs.get(name).rows,
      capture.get(name).rows,
      listed?.layers
    )
    squaredLayers += squared
    squaredExamples += squared > 0 ? 1 : 0
    knownLayers += known.length
    if (known.length > 0) {
      lines.push(`${name}: known, ${listed.reason}`, ...indented(known))
    }
    if (stale.length > 0) {
      failures++
      lines.push(
        `${name}: listed as a known difference, but the same this run`,
        ...indented(stale)
      )
    }
    if (sizes.length > 0) {
      failures++
      lines.push(`${name}: differs`, ...indented(sizes))
    } else if (known.length === 0) {
      same++
    }
  }
  lines.push(
    "",
    `same size in every layer: ${same} of ${examples.length}`,
    `layers that differ as listed: ${knownLayers}`,
    `paint, known: ${squaredLayers} layers in ${squaredExamples} examples have rounded corners in the capture and square ones in the docs. ${paintDifference}`
  )
  return { text: lines.join("\n"), failures }
}

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true })
  const port = process.env.DOCS_PORT
  if (!port) {
    console.error(usage)
    process.exit(2)
  }
  const onDocs = await readDocsExamples()
  const missing = positionals.filter((name) => !onDocs.has(name))
  if (missing.length > 0) {
    console.error(`Not on a web components docs page: ${missing.join(", ")}`)
    process.exit(2)
  }
  const examples = [...onDocs]
    .filter(([name]) => positionals.length === 0 || positionals.includes(name))
    .toSorted(([a], [b]) => a.localeCompare(b))
  const docsSite = await startDocs(port)
  try {
    // Playwright's own handlers exit before the docs site is stopped.
    const browser = await launchBrowser({
      handleSIGINT: false,
      handleSIGTERM: false,
    })
    try {
      const docs = await measureDocs(browser, docsSite.url, examples)
      const capture = await measureCapture(
        browser,
        examples.map(([name]) => name)
      )
      const { text, failures } = report(
        examples,
        docs,
        capture,
        knownDifferences
      )
      console.log(text)
      process.exitCode = failures > 0 ? 1 : 0
    } finally {
      await browser.close()
    }
  } finally {
    await docsSite.stop()
  }
}

export { compareRows, report }
