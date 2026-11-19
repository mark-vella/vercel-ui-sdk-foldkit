import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const stylesheet = fileURLToPath(
  new URL("../examples/styles/tokens.css", import.meta.url)
)
const { chromium } = createRequire(new URL("../tests/", import.meta.url))(
  "@playwright/test"
)

const typesByPrefix = [
  ["--radius-", "radius"],
  ["--space-", "spacing"],
  ["--size", "spacing"],
  ["--text-", "fontSize"],
  ["--leading", "lineHeight"],
  ["--mono", "fontFamily"],
]
const fixedValues = { "--mono": '"Geist Mono"' }

const readDeclarations = async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ colorScheme: "light" })
    await page.setContent("<div data-example><div></div></div>")
    await page.addStyleTag({ path: stylesheet })
    return await page.evaluate(() => {
      const host = document.querySelector("[data-example]")
      const probe = host.firstElementChild
      const declarations = new Map()
      const collect = (rules) => {
        for (const rule of rules) {
          for (const name of rule.style ?? []) {
            if (name.startsWith("--") && !declarations.has(name)) {
              declarations.set(name, rule.style.getPropertyValue(name).trim())
            }
          }
          collect(rule.cssRules ?? [])
        }
      }
      collect(document.styleSheets[0].cssRules)
      return [...declarations].map(([name, authored]) => {
        const computed = getComputedStyle(host).getPropertyValue(name).trim()
        const isColor = CSS.supports("color", computed)
        probe.style.color = `color-mix(in srgb, var(${name}), var(${name}))`
        const srgb = isColor ? getComputedStyle(probe).color : null
        return { name, authored, computed, srgb }
      })
    })
  } finally {
    await browser.close()
  }
}

// Paper stores colours as rgb() with an alpha percentage and rounds oklab()
// lossily, so every colour is written in the form Paper reads back. Mixing in
// oklab can land just outside sRGB, hence the clamp.
const toPaperColor = (srgb) => {
  const [red, green, blue, alpha = 1] = srgb
    .slice("color(srgb".length, -1)
    .split(/[\s/]+/)
    .filter(Boolean)
    .map(Number)
  const channels = [red, green, blue]
    .map((channel) => Math.round(Math.min(Math.max(channel, 0), 1) * 255))
    .join(" ")
  return alpha === 1
    ? `rgb(${channels})`
    : `rgb(${channels} / ${Math.round(alpha * 100)}%)`
}

const toToken = ({ name, authored, computed, srgb }) => {
  const isAlias = /^var\(--[\w-]+\)$/.test(authored)
  const prefixType = typesByPrefix.find(([prefix]) => name.startsWith(prefix))
  if (prefixType) {
    const value = fixedValues[name] ?? (isAlias ? authored : computed)
    return { name, type: prefixType[1], value }
  }
  if (srgb) {
    return {
      name,
      type: "color",
      value: isAlias ? authored : toPaperColor(srgb),
    }
  }
  return null
}

const readCodeTokens = async () => {
  const tokens = []
  const skipped = []
  for (const declaration of await readDeclarations()) {
    const token = toToken(declaration)
    if (token) {
      tokens.push(token)
    } else {
      skipped.push(declaration.name)
    }
  }
  return { tokens, skipped }
}

const readPaperTokens = async (paper, fileId) => {
  const { tokens } = await paper.call("get_tokens", { fileId })
  return tokens
}

const diffTokens = (expected, actual) => {
  const actualByName = new Map(actual.map((token) => [token.name, token]))
  const expectedNames = new Set(expected.map((token) => token.name))
  const missing = []
  const changed = []
  const unchanged = []
  for (const token of expected) {
    const current = actualByName.get(token.name)
    if (!current) {
      missing.push(token)
    } else if (current.type !== token.type || current.value !== token.value) {
      changed.push({ ...token, current })
    } else {
      unchanged.push(token)
    }
  }
  const extra = actual.filter((token) => !expectedNames.has(token.name))
  return { missing, changed, unchanged, extra }
}

const describeToken = ({ type, value }) => `${type} ${value}`

export {
  describeToken,
  diffTokens,
  readCodeTokens,
  readPaperTokens,
  toPaperColor,
}
