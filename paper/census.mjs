import { createHash } from "node:crypto"
import { glob, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { captureExamples, launchBrowser, readCommit } from "./capture.mjs"
import { markerOf } from "./flatten.mjs"
import { checkEmitted } from "./roundtrip.mjs"
import { readCodeTokens } from "./tokens.mjs"

const repo = fileURLToPath(new URL("..", import.meta.url))
const censusFile = path.join(repo, "paper/out/census.json")
const docsPages = "apps/docs/content/docs/web-components/components/*.mdx"
const largeFrameLayers = 1000

const listExamples = async () => {
  const names = []
  for await (const file of glob("examples/components/*/web/*.ts", {
    cwd: repo,
  })) {
    const component = file.split(path.sep)[2]
    names.push(`${component}/${path.basename(file, ".ts")}`)
  }
  return names.toSorted()
}

const captionsIn = (page) =>
  [...page.matchAll(/<ComponentExample\b(?:[^>"]|"[^"]*")*>/g)].map(([tag]) => [
    tag.match(/\bname="([^"]*)"/)[1],
    tag.match(/\bcaption="([^"]*)"/)?.[1] ?? null,
  ])

const readDocsCaptions = async () => {
  const captions = new Map()
  for await (const file of glob(docsPages, { cwd: repo })) {
    const page = await readFile(path.join(repo, file), "utf8")
    for (const [name, caption] of captionsIn(page)) {
      captions.set(name, caption)
    }
  }
  return captions
}

const inspectPreview = (markerSource) => {
  const markerOf = new Function(`return ${markerSource}`)()
  const preview = document.querySelector('[data-paper-layer="preview"]')
  const kinds = {}
  const count = (kind) => {
    kinds[kind] = (kinds[kind] ?? 0) + 1
  }

  const isHidden = (element) => getComputedStyle(element).display === "none"
  const isInHiddenSubtree = (element) => {
    let parent = element.parentElement
    while (parent !== preview) {
      if (isHidden(parent)) {
        return true
      }
      parent = parent.parentElement
    }
    return false
  }
  const popups =
    globalThis[Symbol.for("ui-sdk.popup-elements@1")] ?? new WeakMap()
  const isPopup = (element) =>
    popups.has(element) ||
    [...element.querySelectorAll("*")].some((inner) => popups.has(inner))
  const slots = {}
  const closedSlots = new Set()
  const closedPopups = new Set()
  for (const element of preview.querySelectorAll("[data-slot]")) {
    const { slot } = element.dataset
    const states = new Set(slots[slot])
    for (const { name } of element.attributes) {
      if (name.startsWith("data-") && name !== "data-slot") {
        states.add(name)
      }
    }
    slots[slot] = [...states].toSorted()
    if (isHidden(element) && !isInHiddenSubtree(element)) {
      closedSlots.add(slot)
      if (isPopup(element)) {
        closedPopups.add(slot)
        count("closed popup")
      } else {
        count("hidden part")
      }
    }
  }

  const topLayer = document.querySelectorAll(
    ":popover-open, :modal, :fullscreen"
  )
  for (const element of topLayer) {
    count(element.matches(":modal") ? "top layer, modal" : "top layer")
  }
  const closed = preview.querySelectorAll(
    "[popover]:not(:popover-open), dialog:not([open])"
  )
  for (const element of closed) {
    count(`closed popup, ${element.localName}`)
  }
  for (const animation of document.getAnimations()) {
    if (animation.playState === "running") {
      count("running animation")
    }
  }

  const layoutOf = (element) => {
    const children = []
    const styledTexts = []
    let hasText = false
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        hasText ||= child.data.trim() !== ""
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue
      }
      const { display } = getComputedStyle(child)
      if (display === "contents") {
        const inner = layoutOf(child)
        children.push(...inner.children)
        styledTexts.push(...inner.styledTexts)
        if (inner.hasText) {
          hasText = true
          styledTexts.push(child)
        }
      } else if (display !== "none") {
        children.push(child)
      }
    }
    return { children, styledTexts, hasText }
  }
  const textStyles = ["color", "font-size", "font-weight", "font-family"]
  const frozenLengths = [
    "row-gap",
    "column-gap",
    ...["top", "right", "bottom", "left"].map((side) => `padding-${side}`),
  ]
  const sizeKind = (value) => {
    if (value instanceof CSSMathValue) {
      return "size as a CSS function"
    }
    if (value instanceof CSSUnitValue && value.unit === "percent") {
      return "size in %"
    }
    if (value instanceof CSSKeywordValue && value.value !== "auto") {
      return `size ${value.value}`
    }
    return null
  }
  const isPercentage = (value) =>
    value instanceof CSSMathValue ||
    (value instanceof CSSUnitValue && value.unit === "percent")
  const boxEdges = ["top", "right", "bottom", "left"].flatMap((side) => [
    `padding-${side}`,
    `border-${side}-width`,
  ])
  const controls = ["input", "textarea", "select"]
  const valueInputs =
    /^(text|search|email|url|tel|password|number|date.*|month|week|time)$/

  const inspect = (element) => {
    if (element.localName === "svg") {
      return
    }
    const style = getComputedStyle(element)
    const computed = element.computedStyleMap()
    const { children, styledTexts, hasText } = layoutOf(element)
    const isBlockFlow =
      style.display === "block" ||
      (style.display === "list-item" && !markerOf(style))
    if (isBlockFlow && children.length > 0) {
      count("block with element children")
      const isInline = (child) =>
        getComputedStyle(child).display.startsWith("inline")
      if (children.some(isInline)) {
        count("block with inline children")
      }
    }
    for (const contents of styledTexts) {
      const own = getComputedStyle(contents)
      if (textStyles.some((name) => own[name] !== style[name])) {
        count("display: contents styles its text")
      }
    }
    if (hasText && style.lineHeight === "normal") {
      count("line-height normal")
    }
    const sizeKinds = new Set(
      ["width", "height"].map((name) => sizeKind(computed.get(name)))
    )
    for (const kind of sizeKinds) {
      if (kind) {
        count(kind)
      }
    }
    if (frozenLengths.some((name) => isPercentage(computed.get(name)))) {
      count("% frozen to px")
    }
    const hasExplicitSize = ["width", "height"].some(
      (name) => String(computed.get(name)) !== "auto"
    )
    const hasBoxEdges = boxEdges.some(
      (name) => parseFloat(style.getPropertyValue(name)) > 0
    )
    if (style.boxSizing === "content-box" && hasExplicitSize && hasBoxEdges) {
      count("content-box size")
    }
    const isValueControl =
      controls.includes(element.localName) &&
      (element.localName !== "input" || valueInputs.test(element.type))
    if (isValueControl) {
      if (element.value) {
        count("control shows a value")
      } else if (element.placeholder) {
        count("control shows a placeholder")
      } else {
        count("control is empty")
      }
    }
    children.forEach(inspect)
  }
  layoutOf(preview).children.forEach(inspect)

  return {
    slots,
    closedSlots: [...closedSlots].toSorted(),
    closedPopups: [...closedPopups].toSorted(),
    kinds,
  }
}

const inspectExample = (page) => page.evaluate(inspectPreview, String(markerOf))

const kindOf = ({ layer, property, value }) => {
  if (/ > svg( >|$)/.test(layer)) {
    return property === "color" && layer.endsWith("> svg")
      ? "svg currentColor"
      : "svg styled by CSS"
  }
  if (property.startsWith("margin-")) {
    return "margin"
  }
  if (["top", "right", "bottom", "left"].includes(property)) {
    return "inset"
  }
  if (["transform", "rotate", "scale", "translate"].includes(property)) {
    return "transform"
  }
  if (["filter", "backdrop-filter"].includes(property)) {
    return "filter"
  }
  if (/^(-webkit-)?mask/.test(property)) {
    return "mask"
  }
  if (["clip-path", "clip"].includes(property)) {
    return "clip"
  }
  if (property.startsWith("overflow-") && property !== "overflow-wrap") {
    return /auto|scroll/.test(value) ? "scroll container" : "overflow clip"
  }
  if (property.startsWith("grid-") || property === "justify-items") {
    return "grid properties"
  }
  if (property.startsWith("background-") && value.includes(",")) {
    return "multi-layer background"
  }
  const named = {
    display: `display ${value}`,
    position: `position ${value}`,
    element: `element ${value}`,
    value: "control value",
    children: "mixed text and elements",
    tokens: "redeclared tokens",
  }
  return named[property] ?? property
}

const countRecorded = (entries, kindFor) => {
  const tallies = new Map()
  for (const entry of entries) {
    const key = JSON.stringify([kindFor(entry), entry.layer, entry.property])
    tallies.set(key, (tallies.get(key) ?? 0) + 1)
  }
  const perLayer = new Map()
  for (const [key, tally] of tallies) {
    const [kind, layer] = JSON.parse(key)
    const layerKey = JSON.stringify([kind, layer])
    perLayer.set(layerKey, Math.max(perLayer.get(layerKey) ?? 0, tally))
  }
  const kinds = {}
  for (const [key, tally] of perLayer) {
    const [kind] = JSON.parse(key)
    kinds[kind] = (kinds[kind] ?? 0) + tally
  }
  return kinds
}

const previewHash = (html) => {
  const start = html.indexOf('<div layer-name="preview"')
  return createHash("sha256")
    .update(html.slice(start, -"</div>".length))
    .digest("hex")
}

const sortKeys = (record) =>
  Object.fromEntries(
    Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b))
  )

const describeExample = ({ sidecar, html, inspection }, offline) => {
  const preview = sidecar.layers.find(({ layer }) =>
    layer.endsWith(" > preview")
  )
  const recorded = {
    ...countRecorded(sidecar.unsupported, kindOf),
    ...countRecorded(sidecar.unbound, () => "unbound token"),
  }
  const kinds = { ...recorded, ...inspection.kinds }
  const svgs = sidecar.layers.filter(({ kind }) => kind === "svg").length
  if (svgs > 0) {
    kinds.svg = svgs
  }
  if (preview.width === 0 || preview.height === 0) {
    kinds["empty preview"] = 1
  }
  if (!sidecar.settled) {
    kinds["still changing at capture"] = 1
  }
  if (offline.error) {
    kinds["offline check failed"] = 1
  }
  if (offline.emitted.length > 0) {
    kinds["emitted HTML differs offline"] = offline.emitted.length
  }
  return {
    status: "rendered",
    frame: sidecar.frame,
    layers: sidecar.layers.length,
    renderHash: previewHash(html),
    hash: sidecar.hash,
    slots: sortKeys(inspection.slots),
    closedSlots: inspection.closedSlots,
    closedPopups: inspection.closedPopups,
    kinds: sortKeys(kinds),
    recorded: Object.keys(recorded).toSorted(),
    unsupported: sidecar.unsupported.length,
    unbound: sidecar.unbound.length,
    emitted: offline.emitted,
    offlineError: offline.error ?? null,
  }
}

const runCensus = async (names) => {
  const captions = await readDocsCaptions()
  const { tokens } = await readCodeTokens()
  const entries = []
  const browser = await launchBrowser()
  try {
    const results = captureExamples(browser, names, {
      inspect: inspectExample,
    })
    for await (const result of results) {
      const component = result.name.split("/")[0]
      const entry = {
        name: result.name,
        component,
        docs: captions.has(result.name),
        caption: captions.get(result.name) ?? null,
      }
      if (result.error) {
        entries.push({ ...entry, status: "failed", error: result.error })
        console.error(`${result.name}: failed, ${result.error}`)
        continue
      }
      const offline = await checkEmitted(browser, { ...result, tokens }).then(
        (emitted) => ({ emitted }),
        (error) => ({ emitted: [], error: error.message.split("\n")[0] })
      )
      entries.push({ ...entry, ...describeExample(result, offline) })
      process.stderr.write(`\r${entries.length}/${names.length}`)
    }
  } finally {
    await browser.close()
  }
  process.stderr.write("\n")
  return { ...readCommit(), examples: entries }
}

const deferredFindings = [
  ["U3: a list that draws no marker", /^(list-style-type|display list-item)$/],
  ["U3: line-height: normal, now emitted in px", /^line-height normal$/],
  ["U4: an svg sized or coloured by CSS", /^svg (styled by CSS|currentColor)$/],
  ["U4: direction: rtl", /^direction$/],
  ["U4: input values", /^control value$/],
  ["U4: mixed text and element children", /^mixed text and elements$/],
  ["U4: built-in control drawing", /^element (input|select|progress|meter)/],
  ["U4: a content-box sized element", /^(content-box size|box-sizing)$/],
  [
    "U4: colour or weight on a display: contents element with text",
    /^display: contents styles its text$/,
  ],
  ["U4: position: relative recorded", /^position relative$/],
  [
    "U4: inline children under the block exception",
    /^(block with inline children|display \S+ in a block)$/,
  ],
  ["U4: a background with several layers", /^multi-layer background$/],
]

const tallyKinds = (rendered, matches) => {
  const tally = {
    examples: 0,
    elements: 0,
    differsOffline: 0,
    onlyRecorded: 0,
    components: new Set(),
  }
  for (const { component, kinds, recorded, layers } of rendered) {
    const found = Object.entries(kinds).filter(([kind]) => matches(kind))
    if (found.length === 0) {
      continue
    }
    tally.examples++
    if (layers <= largeFrameLayers) {
      tally.elements += found.reduce((sum, [, elements]) => sum + elements, 0)
    }
    if (kinds["emitted HTML differs offline"]) {
      tally.differsOffline++
    }
    if (recorded.length > 0 && recorded.every(matches)) {
      tally.onlyRecorded++
    }
    tally.components.add(component)
  }
  return tally
}

const formatTally = (
  label,
  { examples, elements, differsOffline, onlyRecorded, components }
) =>
  `${label} | ${examples} | ${elements} | ${differsOffline} | ${onlyRecorded} | ${components.size}: ${[...components].join(", ")}`

const effectColumns = "differs offline | only recorded loss"
const notes = [
  "notes",
  `- elements leave out frames over ${largeFrameLayers} layers, named above.`,
  "- elements is a lower bound where sibling layers share a path and record different longhands of one kind.",
  "- differs offline: the frame has the kind, and its emitted HTML rendered offline differs in a size, a binding or a colour. A lost control value, text or layer position can't show there.",
  "- only recorded loss: every loss the sidecar records in the frame is under this row. A kind the census detects itself is never a recorded loss.",
  "- display <value> counts containers with element children. A table cell or grid that holds only text is not counted. display <value> in a block counts inline children that lay out apart as blocks.",
  "- closed popup: a hidden slot that is or holds a ui-sdk popup's content. hidden part: any other hidden slot, such as a panel, an indicator or a backdrop.",
  "- a deferred finding's entries add up the elements of each kind it matches, so an svg under both svg kinds counts twice.",
  "- every frame with svg styled by CSS also has svg currentColor. Each reads 0 in only recorded loss, and the deferred svg row counts them together.",
  "- picture: the emitted HTML's picture differs from the example's. It is recorded once a frame, on the innermost layer that holds every changed pixel.",
  "",
  "not counted",
  "- em, rem and vw sizes, which compute to px; only % and CSS functions are counted",
]

const summarize = ({ examples }) => {
  const rendered = examples.filter(({ status }) => status === "rendered")
  const failed = examples.filter(({ status }) => status === "failed")
  const distinct = (list) => new Set(list.map(({ renderHash }) => renderHash))
  const docs = rendered.filter(({ docs }) => docs)
  const lines = [
    `examples ${examples.length}, docs ${examples.filter(({ docs }) => docs).length}`,
    `rendered ${rendered.length}, failed ${failed.length}`,
    ...failed.map(({ name, error }) => `  ${name}: ${error}`),
    `distinct renders ${distinct(rendered).size}, among docs examples ${distinct(docs).size}`,
    `nothing recorded as dropped ${rendered.filter(({ unsupported, unbound }) => unsupported + unbound === 0).length}`,
    `largest by layers ${rendered
      .toSorted((a, b) => b.layers - a.layers)
      .slice(0, 5)
      .map(({ name, layers }) => `${name} ${layers}`)
      .join(", ")}`,
    `over ${largeFrameLayers} layers ${
      rendered
        .filter(({ layers }) => layers > largeFrameLayers)
        .map(({ name }) => name)
        .join(", ") || "none"
    }`,
    "",
    `kind | examples | elements | ${effectColumns} | components`,
  ]
  const kinds = new Set(rendered.flatMap(({ kinds }) => Object.keys(kinds)))
  const ranked = [...kinds]
    .map((kind) => [kind, tallyKinds(rendered, (name) => name === kind)])
    .toSorted(([a, x], [b, y]) => y.examples - x.examples || a.localeCompare(b))
  lines.push(...ranked.map(([kind, tally]) => formatTally(kind, tally)))
  lines.push(
    "",
    `deferred finding | examples | entries | ${effectColumns} | components`
  )
  for (const [label, pattern] of deferredFindings) {
    lines.push(
      formatTally(
        label,
        tallyKinds(rendered, (kind) => pattern.test(kind))
      )
    )
  }
  lines.push("", ...notes)
  return lines.join("\n")
}

if (import.meta.main) {
  const { positionals } = parseArgs({ allowPositionals: true })
  const isFull = positionals.length === 0
  const census = await runCensus(isFull ? await listExamples() : positionals)
  const json = `${JSON.stringify(census, null, 2)}\n`
  if (isFull) {
    await writeFile(censusFile, json)
  } else {
    console.log(json)
  }
  console.log(summarize(census))
  if (census.examples.some(({ status }) => status === "failed")) {
    process.exitCode = 1
  }
}

export { captionsIn, describeExample, inspectExample, summarize }
