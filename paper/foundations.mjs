import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  captureFrame,
  launchBrowser,
  readCommit,
  saveCapture,
} from "./capture.mjs"
import { escapeText, syncFrames, verifyFrames } from "./components.mjs"
import { readCodeTokens, toPaperColor } from "./tokens.mjs"

const repo = fileURLToPath(new URL("..", import.meta.url))
const stylesheet = "examples/styles/tokens.css"
const foundations = {
  label: "foundations",
  page: "01 Foundations",
  outFolder: fileURLToPath(new URL("./out/foundations/", import.meta.url)),
  source: () => stylesheet,
}
const groups = ["color", "type", "spacing", "size", "radius", "elevation"]
const laneWidth = "176px"
const valueWidths = { elevation: "288px" }
const sample = "The quick brown fox jumps over the lazy dog"
const ring = (color) => `box-shadow: inset 0 0 0 1px var(${color})`
const boxSpecimen = (style) =>
  `<div data-paper-layer="specimen" style="${style}"></div>`
const textSpecimen = (style, content) =>
  `<div data-paper-layer="specimen" style="${style}">${content}</div>`
const kinds = {
  color: {
    group: "color",
    specimen: (name) =>
      boxSpecimen(
        `width: 32px; height: 32px; border-radius: var(--radius-row); background-color: var(${name}); ${ring("--line-faint")}`
      ),
  },
  fontSize: {
    group: "type",
    specimen: (name) => textSpecimen(`font-size: var(${name})`, sample),
  },
  fontFamily: {
    group: "type",
    specimen: (name) => textSpecimen(`font-family: var(${name})`, sample),
  },
  lineHeight: {
    group: "type",
    specimen: (name) =>
      textSpecimen(
        `width: 240px; font-size: var(--text-md); line-height: var(${name})`,
        sample
      ),
  },
  space: {
    group: "spacing",
    specimen: (name) =>
      boxSpecimen(
        `width: var(${name}); height: 16px; background-color: var(--line)`
      ),
  },
  size: {
    group: "size",
    specimen: (name) =>
      boxSpecimen(
        `width: var(${name}); height: var(${name}); background-color: var(--tint); ${ring("--line")}`
      ),
  },
  radius: {
    group: "radius",
    specimen: (name) =>
      boxSpecimen(
        `width: 48px; height: 48px; border-radius: var(${name}); background-color: var(--tint); ${ring("--line")}`
      ),
  },
  shadow: {
    group: "elevation",
    specimen: (name) =>
      `<div style="display: flex; padding: var(--space-8)">${boxSpecimen(
        `width: 96px; height: 64px; border-radius: var(--radius-surface); background-color: var(--surface-1); box-shadow: var(${name})`
      )}</div>`,
  },
  valueOnly: { group: "elevation", specimen: () => "" },
}

const kindOf = ({ name, type }) => {
  if (type === "spacing") {
    return name.startsWith("--size") ? "size" : "space"
  }
  if (type) {
    return type
  }
  return name.startsWith("--shadow-") ? "shadow" : "valueOnly"
}

const groupTokens = ({ tokens, skipped }) => {
  const entries = [...tokens, ...skipped.map((name) => ({ name }))].map(
    (token) => {
      const kind = kindOf(token)
      if (!kinds[kind]) {
        throw new Error(`${token.name} is a ${kind}, which has no specimen.`)
      }
      return { ...token, kind }
    }
  )
  return groups.map((group) => ({
    group,
    entries: entries.filter(({ kind }) => kinds[kind].group === group),
  }))
}

const readComputedValues = (names) => {
  const host = document.querySelector("[data-example]")
  const probe = host.appendChild(document.createElement("div"))
  const values = names.map((name) => {
    probe.style.boxShadow = `var(${name})`
    const shadow = getComputedStyle(probe).boxShadow
    const layers = shadow === "none" ? [] : shadow.split(/,(?![^(]*\))/)
    return {
      name,
      text: getComputedStyle(host).getPropertyValue(name).trim(),
      layers: layers.map((layer) => {
        const [, color, geometry] = layer.trim().match(/^(\S+\([^)]*\)) (.*)$/)
        probe.style.color = `color-mix(in srgb, ${color}, ${color})`
        return { srgb: getComputedStyle(probe).color, geometry }
      }),
    }
  })
  probe.remove()
  return values
}

const valueLines = (entry, computed) => {
  if (entry.value) {
    return [entry.value]
  }
  const { text, layers } = computed.find(({ name }) => name === entry.name)
  return entry.kind === "shadow"
    ? layers.map(({ srgb, geometry }) => `${toPaperColor(srgb)} ${geometry}`)
    : [text]
}

const sheetHtml = ({ group, entries }, computed) => {
  const lane = (width) => `width: ${width}; flex-shrink: 0`
  const rows = entries.map((entry) => {
    const lines = valueLines(entry, computed)
      .map((line) => `<div>${escapeText(line)}</div>`)
      .join("")
    return `<div data-paper-layer="${entry.name}" style="display: flex; align-items: center; gap: var(--space-6); padding: var(--space-3) 0; border-bottom: 1px solid var(--line-faint)"><div data-paper-layer="name" style="${lane(laneWidth)}; font-family: var(--mono)">${entry.name}</div><div data-paper-layer="value" style="${lane(valueWidths[group] ?? laneWidth)}; display: flex; flex-direction: column; font-family: var(--mono); color: var(--muted)">${lines}</div>${kinds[entry.kind].specimen(entry.name)}</div>`
  })
  return `<div data-paper-layer="sheet" style="display: flex; flex-direction: column; color: var(--ink); font-size: var(--text-xs); line-height: var(--leading)">${rows.join("")}</div>`
}

const renderFoundations = async (browser, codeTokens) => {
  const rendered = []
  for (const sheet of groupTokens(codeTokens)) {
    const computedNames = sheet.entries
      .filter(({ value }) => !value)
      .map(({ name }) => name)
    const mount = async (page) => {
      const computed = await page.evaluate(readComputedValues, computedNames)
      await page.locator(".example-content").evaluate(
        (preview, html) => {
          preview.innerHTML = html
        },
        sheetHtml(sheet, computed)
      )
    }
    const name = `${sheet.group}/tokens`
    const flat = await captureFrame(browser, {
      name,
      root: repo,
      stylesheets: [`/${stylesheet}`],
      mount,
      tokens: codeTokens.tokens,
    })
    rendered.push({ name, flat })
  }
  return rendered
}

const captureFoundations = async (browser, codeTokens) => {
  const commit = readCommit()
  const captures = []
  for (const { name, flat } of await renderFoundations(browser, codeTokens)) {
    const sidecar = await saveCapture(
      path.join(foundations.outFolder, name),
      { name, commit, sources: [stylesheet] },
      flat
    )
    captures.push({ html: flat.html, sidecar })
  }
  return captures
}

const syncFoundations = async (paper, fileId) => {
  const browser = await launchBrowser()
  let captures
  try {
    captures = await captureFoundations(browser, await readCodeTokens())
  } finally {
    await browser.close()
  }
  await syncFrames(paper, fileId, { ...foundations, captures })
}

const verifyFoundations = async (paper, fileId) => {
  const codeTokens = await readCodeTokens()
  const browser = await launchBrowser()
  try {
    return await verifyFrames(paper, fileId, {
      ...foundations,
      captures: await captureFoundations(browser, codeTokens),
      browser,
      tokens: codeTokens.tokens,
    })
  } finally {
    await browser.close()
  }
}

export { groupTokens, renderFoundations, syncFoundations, verifyFoundations }
