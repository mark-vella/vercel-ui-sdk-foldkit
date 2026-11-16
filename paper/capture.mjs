import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { flattenFrame } from "./flatten.mjs"
import {
  comparePictures,
  innermostLayer,
  readLayerBoxes,
  resizedLayers,
} from "./pictures.mjs"
import { readCodeTokens } from "./tokens.mjs"

const usage = "Usage: node paper/capture.mjs <component/example>..."
const repo = fileURLToPath(new URL("..", import.meta.url))
const built = path.join(repo, "apps/docs/public")
const defaultOutFolder = path.join(repo, "paper/out")
const origin = "https://capture.paper"
const docsContentWidth = "32rem"
const docsRequire = createRequire(new URL("../apps/docs/", import.meta.url))
const geistFonts = path.join(
  path.dirname(docsRequire.resolve("geist/font")),
  "fonts"
)
const pageFiles = new Map([
  [
    "/fonts/geist.woff2",
    path.join(geistFonts, "geist-sans/Geist-Variable.woff2"),
  ],
  [
    "/fonts/geist-mono.woff2",
    path.join(geistFonts, "geist-mono/GeistMono-Variable.woff2"),
  ],
  ["/preflight.css", docsRequire.resolve("tailwindcss/preflight.css")],
])
const pageOptions = {
  colorScheme: "light",
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
}
const longestAwaitedTimer = 1000
const noMotion =
  "*, *::before, *::after { transition: none !important; animation: none !important; }"
const { chromium } = createRequire(new URL("../tests/", import.meta.url))(
  "@playwright/test"
)

const readJson = async (file) =>
  JSON.parse(await readFile(path.join(built, "examples", file), "utf8"))

const readBuild = async () => {
  const [manifest, styles, stylesheets] = await Promise.all([
    readJson("web/manifest.json"),
    readJson("web/styles.json"),
    readJson("styles/manifest.json"),
  ])
  const chunks = Object.values(manifest)
  const entry = (name) =>
    chunks.find((chunk) => chunk.isEntry && chunk.name === name)
  return (name) => {
    const example = entry(name)
    if (!example || !styles[name]) {
      const [component, file] = name.split("/")
      const source = `examples/components/${component}/web/${file}.ts`
      throw new Error(
        existsSync(path.join(repo, source))
          ? `${name} isn't built. Run \`EXAMPLES_ONLY=${component} node scripts/build.mjs web styles\` in examples/.`
          : `${name} is not an example. Run \`ls examples/components/*/web\` to list them.`
      )
    }
    return {
      script: `/examples/web/${example.file}`,
      mount: `/examples/web/${entry("mount").file}`,
      stylesheets: styles[name].map(
        (source) => `/examples/styles/${stylesheets[source].file}`
      ),
      sources: [example.src, ...styles[name]].map(
        (source) => `examples/${source}`
      ),
    }
  }
}

// The examples build lowers light-dark() to lightningcss's
// var(--lightningcss-light, …) form, which picks nothing without these two.
const pageHtml = (name, stylesheets) => `<!doctype html>
<html lang="en">
<head>
<style>
@layer ui-sdk, base, utilities;
@import url(/preflight.css) layer(base);
@font-face { font-family: Geist; src: url(/fonts/geist.woff2) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url(/fonts/geist-mono.woff2) format("woff2"); font-weight: 100 900; }
:root { color-scheme: light; --font-geist-mono: "Geist Mono"; --lightningcss-light: initial; --lightningcss-dark: ; }
body { display: grid; justify-content: start; font-family: Geist; }
${noMotion}
/* Chromium antialiases a scroller's content differently when it sets overscroll-behavior. */
* { overscroll-behavior: auto !important; }
@layer utilities {
  .example-content { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; width: ${docsContentWidth}; }
}
</style>
${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
</head>
<body>
<div data-example="${name}" data-paper-layer="${name}" style="display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-6); background-color: var(--paper)">
<div data-paper-layer="caption" style="color: var(--muted); font-size: var(--text-xs)">${name}</div>
<div data-paper-layer="preview" class="example-content"></div>
</div>
</body>
</html>`

const blockOtherOrigins = (page, allowed, blocked = new Set()) =>
  page.route(
    (url) => /^https?:$/.test(url.protocol) && url.origin !== allowed,
    (route) => {
      blocked.add(route.request().url())
      return route.abort("blockedbyclient")
    }
  )

const serve = (page, { html, root }) =>
  page.route(`${origin}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: html })
    }
    if (pageFiles.has(pathname)) {
      return route.fulfill({ path: pageFiles.get(pathname) })
    }
    return route.fulfill({ path: path.join(root, pathname) })
  })

const mountExample = (page, { script, mount }) =>
  page.evaluate(
    async ({ script, mount }) => {
      const [module, framework] = await Promise.all([
        import(script),
        import(mount),
      ])
      framework.mount(module, document.querySelector(".example-content"))
    },
    { script, mount }
  )

const trackTimers = (longest) => {
  const timeouts = new Set()
  const intervalRuns = new Map()
  const { setTimeout, setInterval, clearTimeout, clearInterval } = window
  const isAwaited = (callback, delay) =>
    typeof callback === "function" && !(delay > longest)
  window.setTimeout = (callback, delay, ...args) => {
    if (!isAwaited(callback, delay)) {
      return setTimeout(callback, delay, ...args)
    }
    const id = setTimeout(() => {
      timeouts.delete(id)
      callback(...args)
    }, delay)
    timeouts.add(id)
    return id
  }
  window.setInterval = (callback, delay, ...args) => {
    if (!isAwaited(callback, delay)) {
      return setInterval(callback, delay, ...args)
    }
    const id = setInterval(() => {
      intervalRuns.set(id, intervalRuns.get(id) + 1)
      callback(...args)
    }, delay)
    intervalRuns.set(id, 0)
    return id
  }
  const clear = (cancel) => (id) => {
    timeouts.delete(id)
    intervalRuns.delete(id)
    cancel(id)
  }
  window.clearTimeout = clear(clearTimeout)
  window.clearInterval = clear(clearInterval)
  window.paperTimers = { timeouts, intervalRuns }
}

const waitUntilSettled = async () => {
  await document.fonts.ready
  const twoRenderedFrames = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve))
      )
    )
  const { timeouts, intervalRuns } = window.paperTimers
  let hasChanged = true
  let runsAtChange = new Map(intervalRuns)
  const observer = new MutationObserver(() => {
    hasChanged = true
    runsAtChange = new Map(intervalRuns)
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  const isWorking = () =>
    timeouts.size > 0 ||
    [...intervalRuns].some(([id, runs]) => runs <= (runsAtChange.get(id) ?? 0))
  for (
    let attempt = 0;
    (hasChanged || isWorking()) && attempt < 60;
    attempt++
  ) {
    hasChanged = false
    await twoRenderedFrames()
  }
  observer.disconnect()
  return !hasChanged && !isWorking()
}

const launchBrowser = (options) =>
  chromium.launch({ ...options, args: ["--font-render-hinting=none"] })

const captureFrame = async (
  browser,
  { name, root, stylesheets, mount, tokens, inspect }
) => {
  const page = await browser.newPage(pageOptions)
  const blocked = new Set()
  try {
    await blockOtherOrigins(page, origin, blocked)
    await serve(page, { html: pageHtml(name, stylesheets), root })
    await page.addInitScript(trackTimers, longestAwaitedTimer)
    await page.goto(`${origin}/`)
    await mount(page)
    const isSettled = await page.evaluate(waitUntilSettled)
    const inspection = await inspect?.(page)
    const flat = await flattenFrame(page, tokens)
    const named = new Set(
      flat.unsupported
        .filter(({ property }) => property === "blocked request")
        .map(({ value }) => value)
    )
    const unnamed = [...blocked].filter((url) => !named.has(url)).toSorted()
    flat.unsupported.push(
      ...unnamed.map((value) => ({
        layer: flat.layers[0].layer,
        property: "blocked request",
        value,
      }))
    )
    const png = await page.locator("[data-example]").screenshot()
    return { ...flat, png, inspection, isSettled }
  } finally {
    await page.close()
  }
}

const mountEmitted = (html) => {
  const template = document.createElement("template")
  template.innerHTML = html
  for (const element of template.content.querySelectorAll("[layer-name]")) {
    element.dataset.paperLayer = element.getAttribute("layer-name")
  }
  for (const element of template.content.querySelectorAll("div")) {
    element.style.boxSizing = "border-box"
  }
  for (const svg of template.content.querySelectorAll("svg")) {
    svg.style.flexShrink = "0"
  }
  const root = template.content.firstElementChild
  root.dataset.example = ""
  document.querySelector("[data-example]").replaceWith(root)
}

const renderEmitted = (browser, { name, html, tokens, inspect }) =>
  captureFrame(browser, {
    name,
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) => page.evaluate(mountEmitted, html),
    tokens,
    inspect,
  })

const captureCompared = async (browser, options) => {
  const flat = await captureFrame(browser, options)
  const emitted = await renderEmitted(browser, {
    name: options.name,
    html: flat.html,
    tokens: options.tokens,
    inspect: (page) => page.evaluate(readLayerBoxes),
  })
  flat.unsupported.push(...resizedLayers(flat.layers, emitted.layers))
  const region = await comparePictures(browser, {
    expected: flat.png,
    actual: emitted.png,
    frameWidth: flat.frame.width,
  })
  if (region) {
    const { left, top, width, height } = region
    flat.unsupported.push({
      layer: innermostLayer(region, emitted.inspection),
      property: "picture",
      value: `${width}x${height} at ${left},${top}`,
    })
  }
  return { ...flat, emitted }
}

const readCommit = () => {
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
  return {
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
  }
}

const saveCapture = async (base, { name, commit, sources }, flat) => {
  await mkdir(path.dirname(base), { recursive: true })
  const sidecar = {
    name,
    ...commit,
    sources,
    hash: createHash("sha256").update(flat.html).digest("hex"),
    settled: flat.isSettled,
    frame: flat.frame,
    layers: flat.layers,
    bindings: flat.bindings,
    unbound: flat.unbound,
    literals: flat.literals,
    unsupported: flat.unsupported,
  }
  await writeFile(`${base}.png`, flat.png)
  await writeFile(`${base}.html`, `${flat.html}\n`)
  await writeFile(`${base}.json`, `${JSON.stringify(sidecar, null, 2)}\n`)
  return sidecar
}

const captureExample = async (
  browser,
  { name, example, tokens, commit, outFolder, inspect }
) => {
  const { inspection, emitted, ...flat } = await captureCompared(browser, {
    name,
    root: built,
    stylesheets: example.stylesheets,
    mount: (page) => mountExample(page, example),
    tokens,
    inspect,
  })
  const sidecar = await saveCapture(
    path.join(outFolder, name),
    { name, commit, sources: example.sources },
    flat
  )
  return { name, sidecar, html: flat.html, inspection, emitted }
}

const captureExamples = async function* (
  browser,
  names,
  { outFolder = defaultOutFolder, inspect } = {}
) {
  const resolveExample = await readBuild()
  const { tokens } = await readCodeTokens()
  const commit = readCommit()
  for (const name of names) {
    let result
    try {
      result = await captureExample(browser, {
        name,
        example: resolveExample(name),
        tokens,
        commit,
        outFolder,
        inspect,
      })
    } catch (error) {
      result = { name, error: error.message.split("\n")[0] }
    }
    yield result
  }
}

if (import.meta.main) {
  const { positionals: names } = parseArgs({ allowPositionals: true })
  if (names.length === 0) {
    console.error(usage)
    process.exit(2)
  }

  const browser = await launchBrowser()
  try {
    for await (const { name, sidecar, error } of captureExamples(
      browser,
      names
    )) {
      if (error) {
        console.error(`${name}: failed, ${error}`)
        process.exitCode = 1
        continue
      }
      const { width, height } = sidecar.frame
      const unsettled = sidecar.settled ? "" : ", still changing at capture"
      console.log(
        `${name}: ${width}x${height}, ${sidecar.layers.length} layers, ${sidecar.bindings.length} bindings, ${sidecar.unbound.length} unbound, ${sidecar.unsupported.length} unsupported, ${sidecar.hash.slice(0, 12)}${unsettled}`
      )
    }
  } finally {
    await browser.close()
  }
}

export {
  blockOtherOrigins,
  captureCompared,
  captureExamples,
  captureFrame,
  launchBrowser,
  noMotion,
  pageOptions,
  readCommit,
  renderEmitted,
  saveCapture,
}
