import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { flattenFrame } from "./flatten.mjs"
import { readCodeTokens } from "./tokens.mjs"

const usage = "Usage: node paper/capture.mjs <component/example>..."
const repo = fileURLToPath(new URL("..", import.meta.url))
const built = path.join(repo, "apps/docs/public")
const outFolder = path.join(repo, "paper/out")
const origin = "https://capture.paper"
const geistFonts = path.join(
  path.dirname(
    createRequire(new URL("../apps/docs/", import.meta.url)).resolve(
      "geist/font"
    )
  ),
  "fonts"
)
const fonts = new Map([
  ["/fonts/geist.woff2", "geist-sans/Geist-Variable.woff2"],
  ["/fonts/geist-mono.woff2", "geist-mono/GeistMono-Variable.woff2"],
])
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
      const [component] = name.split("/")
      throw new Error(
        `${name} isn't built. Run \`EXAMPLES_ONLY=${component} node scripts/build.mjs web styles\` in examples/.`
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
@font-face { font-family: Geist; src: url(/fonts/geist.woff2) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url(/fonts/geist-mono.woff2) format("woff2"); font-weight: 100 900; }
:root { color-scheme: light; --font-geist-mono: "Geist Mono"; --lightningcss-light: initial; --lightningcss-dark: ; }
body { display: flex; align-items: flex-start; margin: 0; font-family: Geist; }
*, *::before, *::after { transition: none !important; animation: none !important; }
@layer utilities {
  .example-content { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
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

const serve = (page, { html, root }) =>
  page.route(`${origin}/**`, (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: html })
    }
    if (fonts.has(pathname)) {
      return route.fulfill({ path: path.join(geistFonts, fonts.get(pathname)) })
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

const launchBrowser = () =>
  chromium.launch({ args: ["--font-render-hinting=none"] })

const captureFrame = async (
  browser,
  { name, root, stylesheets, mount, tokens }
) => {
  const page = await browser.newPage({
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  })
  try {
    await serve(page, { html: pageHtml(name, stylesheets), root })
    await page.goto(`${origin}/`)
    await mount(page)
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    })
    const flat = await flattenFrame(page, tokens)
    const png = await page.locator("[data-example]").screenshot()
    return { ...flat, png }
  } finally {
    await page.close()
  }
}

const readCommit = () => {
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
  return {
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain").length > 0,
  }
}

const captureExample = async (browser, { name, example, tokens, commit }) => {
  const flat = await captureFrame(browser, {
    name,
    root: built,
    stylesheets: example.stylesheets,
    mount: (page) => mountExample(page, example),
    tokens,
  })
  const base = path.join(outFolder, name)
  await mkdir(path.dirname(base), { recursive: true })
  const sidecar = {
    name,
    ...commit,
    sources: example.sources,
    hash: createHash("sha256").update(flat.html).digest("hex"),
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

if (import.meta.main) {
  const { positionals: names } = parseArgs({ allowPositionals: true })
  if (names.length === 0) {
    console.error(usage)
    process.exit(2)
  }

  const resolveExample = await readBuild()
  const examples = names.map((name) => ({
    name,
    example: resolveExample(name),
  }))
  const { tokens } = await readCodeTokens()
  const commit = readCommit()
  const browser = await launchBrowser()
  try {
    for (const { name, example } of examples) {
      const sidecar = await captureExample(browser, {
        name,
        example,
        tokens,
        commit,
      })
      const { width, height } = sidecar.frame
      console.log(
        `${name}: ${width}x${height}, ${sidecar.layers.length} layers, ${sidecar.bindings.length} bindings, ${sidecar.unbound.length} unbound, ${sidecar.unsupported.length} unsupported, ${sidecar.hash.slice(0, 12)}`
      )
    }
  } finally {
    await browser.close()
  }
}

export { captureFrame, launchBrowser }
