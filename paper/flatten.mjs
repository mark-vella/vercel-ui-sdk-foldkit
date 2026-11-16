import {
  isHeldBackground,
  rewrittenGradientSpaces,
  toDeclarations,
  toPaperOrder,
} from "./declarations.mjs"
import { createBindings } from "./flatten/bindings.mjs"
import { createCalcBinder } from "./flatten/calc.mjs"
import { createControlText, createPseudoReader } from "./flatten/children.mjs"
import { createComparison } from "./flatten/compare.mjs"
import { createLayout } from "./flatten/layout.mjs"
import { createRecords } from "./flatten/records.mjs"
import { createSvgReader } from "./flatten/svg.mjs"
import { readTree } from "./flatten/tree.mjs"
import { createUsedValues } from "./flatten/used-values.mjs"
import {
  backgroundLonghands,
  boxProperties,
  computedProperties,
  emittedProperties,
  harmlessValues,
  ignoredProperties,
  logicalPattern,
  movesOrTurns,
  replacedElements,
  sides,
  sizeConstraints,
  tagDefaults,
  textProperties,
  widgetInputs,
  widgets,
} from "./properties.mjs"
import { toPaperColor } from "./tokens.mjs"

const colorPattern =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g
const markerOf = ({ display, listStyleImage, listStyleType }) => {
  if (!display.includes("list-item")) {
    return null
  }
  if (listStyleImage !== "none") {
    return listStyleImage
  }
  return listStyleType === "none" ? null : listStyleType
}

const readFrame = (
  helpers,
  {
    tokens,
    boxProperties,
    computedProperties,
    textProperties,
    emittedProperties,
    ignoredProperties,
    logicalSource,
    replacedElements,
    widgets,
    widgetInputs,
    colorSource,
    sizeConstraints,
    insets,
    harmlessSources,
    tagDefaults,
    backgroundLonghands,
    movesOrTurnsSource,
  }
) => {
  const frame = document.querySelector("[data-example]")
  const probe = document.head.appendChild(document.createElement("div"))
  const longhands = (property) => {
    probe.style.cssText = ""
    probe.style.setProperty(property, "initial")
    return [...probe.style]
  }
  const emitted = new Set(
    emittedProperties.flatMap((property) => [property, ...longhands(property)])
  )
  const ignored = new Set(ignoredProperties.flatMap(longhands))
  const logical = new RegExp(logicalSource)
  const listed = new Set(getComputedStyle(frame))
  const compared = [...listed].filter((property) => {
    if (
      property.startsWith("--") ||
      logical.test(property) ||
      ignored.has(property)
    ) {
      return false
    }
    // Chromium lists background-position but none of its longhands.
    const parts = longhands(property)
    const isLonghand = parts.length === 1 && parts[0] === property
    return isLonghand || !parts.some((part) => listed.has(part))
  })
  const round = (length) => Math.round(length * 1000) / 1000
  const serialize = (property, value) => {
    probe.style.setProperty(property, value)
    return getComputedStyle(probe).getPropertyValue(property)
  }
  const bindings = helpers.createBindings({
    frame,
    tokens,
    serialize,
    boxProperties,
    textProperties,
    computedProperties,
  })

  const unsupported = []
  const record = (layer, property, value) =>
    unsupported.push({ layer, property, value })
  const comparison = helpers.createComparison({
    compared,
    insets,
    harmlessSources,
    tagDefaults,
    sizeConstraints,
  })
  const svgs = helpers.createSvgReader({ comparison, record, round })
  const layout = helpers.createLayout({ comparison })
  const {
    recordDropped,
    recordAbsolute,
    recordDisplay,
    recordInlineBoxes,
    recordTextGrid,
    paintsNothing,
  } = helpers.createRecords({
    record,
    isAtRest: layout.isAtRest,
    emitted,
    insets,
    movesOrTurnsSource,
    backgroundLonghands,
    isHeldBackground: helpers.isHeldBackground,
    rewrittenGradientSpaces: helpers.rewrittenGradientSpaces,
    markerOf: helpers.markerOf,
    replacedElements,
    widgets,
    widgetInputs,
    comparison,
    keepLayer: svgs.keepLayer,
  })
  const readControl = helpers.createControlText({ frame, record, widgetInputs })
  const readPseudos = helpers.createPseudoReader({ record, paintsNothing })
  const { tree, elements } = helpers.readTree({
    frame,
    record,
    markerOf: helpers.markerOf,
    enter: comparison.enter,
    readSvg: svgs.read,
    readControl,
    readPseudos,
    recordDropped,
    recordAbsolute,
    recordDisplay,
    recordInlineBoxes,
    recordTextGrid,
  })

  const real = bindings.read(elements)
  const rects = elements.map(layout.rectOf)
  const marked = bindings.readMarked(elements, record)
  svgs.bind(bindings)

  const { usedLineHeight, pinStaticPosition, pinUsedSize } =
    helpers.createUsedValues({ frame, round })
  const calc = helpers.createCalcBinder({ frame, tokens, computedProperties })
  const colorPattern = new RegExp(colorSource, "g")
  const colors = {}
  elements.forEach((entry, index) => {
    entry.styles = {}
    for (const property of Object.keys(real[index])) {
      const decided = calc.bind(
        entry.element,
        property,
        bindings.decide(
          real[index][property],
          marked.map((values) => values[index][property])
        )
      )
      // Paper's own normal line height differs from Chromium's at some sizes.
      // Chromium floors a unitless line height to 1/64 px, and rounds a length.
      if (property === "line-height" && decided.tokens.length === 0) {
        decided.value =
          usedLineHeight(entry.element, decided.value) ?? decided.value
      }
      entry.styles[property] = decided
      for (const [color] of decided.value.matchAll(colorPattern)) {
        colors[color] = serialize(
          "color",
          `color-mix(in srgb, ${color}, ${color})`
        )
      }
    }
    for (const [property, value] of Object.entries(entry.layout ?? {})) {
      entry.styles[property] = { value, tokens: [] }
    }
    const parent = entry.parent?.element ?? frame.parentElement
    layout.dropInheritedDirection(entry, parent)
    layout.pinScroll(entry)
    const isZIndexIgnored =
      entry.styles.position.value === "static" &&
      !/flex|grid/.test(getComputedStyle(parent).display)
    if (isZIndexIgnored) {
      entry.styles["z-index"] = { value: "auto", tokens: [] }
    }
    if (entry.styles.position.value === "absolute") {
      pinStaticPosition(entry)
    }
    pinUsedSize(entry)
    const { width, height } = rects[index]
    entry.size = { width: round(width), height: round(height) }
    delete entry.element
    delete entry.parent
  })
  probe.remove()
  comparison.remove()
  return { tree, colors, unsupported }
}

const pageFunctions = {
  markerOf,
  isHeldBackground,
  rewrittenGradientSpaces,
  createBindings,
  createCalcBinder,
  createComparison,
  createControlText,
  createPseudoReader,
  createLayout,
  createRecords,
  createSvgReader,
  readTree,
  createUsedValues,
  readFrame,
}

const runInPage = ({ sources, input }) => {
  const helpers = Object.fromEntries(
    Object.entries(sources).map(([name, source]) => [
      name,
      new Function(`"use strict"; return ${source}`)(),
    ])
  )
  return helpers.readFrame(helpers, input)
}

const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttribute = (text) => escapeText(text).replace(/"/g, "&quot;")

const flattenFrame = async (page, tokens) => {
  const input = {
    tokens,
    boxProperties,
    computedProperties,
    textProperties,
    emittedProperties,
    ignoredProperties,
    logicalSource: logicalPattern.source,
    replacedElements,
    widgets,
    widgetInputs,
    colorSource: colorPattern.source,
    sizeConstraints,
    insets: sides,
    harmlessSources: harmlessValues.map(([property, pattern]) => [
      property,
      pattern.source,
    ]),
    tagDefaults,
    backgroundLonghands,
    movesOrTurnsSource: movesOrTurns.source,
  }
  const { tree, colors, unsupported } = await page.evaluate(runInPage, {
    sources: Object.fromEntries(
      Object.entries(pageFunctions).map(([name, fn]) => [name, String(fn)])
    ),
    input,
  })
  const layers = []
  const bindings = []
  const unbound = []
  const literals = []
  const toPaperValue = (value) =>
    value.replace(colorPattern, (color) => toPaperColor(colors[color]))

  const render = (node) => {
    if ("text" in node) {
      return escapeText(node.text)
    }
    if ("svg" in node) {
      const layer = node.path
      layers.push({ layer, kind: "svg", ...node.size })
      bindings.push(...node.tokens.map((bound) => ({ layer, ...bound })))
      unbound.push(...node.unbound.map((entry) => ({ layer, ...entry })))
      return node.svg
    }
    if (node.name) {
      layers.push({ layer: node.path, kind: node.kind, ...node.size })
    }
    const declarations = toDeclarations(node).map((declaration) => ({
      ...declaration,
      value: toPaperValue(declaration.value),
      colors: new Set(
        declaration.value
          .match(colorPattern)
          ?.map((color) => toPaperColor(colors[color]))
      ),
    }))
    for (const { property, value, tokens, isUnbound, colors } of declarations) {
      const layer = node.path
      bindings.push(...tokens.map((token) => ({ layer, property, token })))
      if (isUnbound) {
        unbound.push({ layer, property, value })
      }
      literals.push(...[...colors].map((value) => ({ layer, property, value })))
    }
    const style = declarations
      .map(({ property, value }) => `${property}: ${value}`)
      .join("; ")
    const attributes = [
      node.name && ` layer-name="${escapeAttribute(node.name)}"`,
      style && ` style="${escapeAttribute(style)}"`,
    ].join("")
    return `<div${attributes}>${toPaperOrder(node.children).map(render).join("")}</div>`
  }

  const html = render(tree)
  const [frame] = layers
  return {
    html,
    frame: { width: frame.width, height: frame.height },
    layers,
    bindings,
    unbound,
    literals,
    unsupported,
  }
}

export { flattenFrame, markerOf, pageFunctions, runInPage }
