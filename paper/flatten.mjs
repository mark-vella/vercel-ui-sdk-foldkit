import {
  isHeldBackground,
  toDeclarations,
  toPaperOrder,
} from "./declarations.mjs"
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

const readFrame = ({
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
  markerSource,
  heldBackgroundSource,
  sizeConstraints: constraints,
  insets,
  harmlessSources,
  tagDefaults,
  backgroundLonghands,
  movesOrTurnsSource,
}) => {
  const harmlessValues = new Map(
    harmlessSources.map(([property, source]) => [property, new RegExp(source)])
  )
  const markerOf = new Function(`return ${markerSource}`)()
  const isHeldBackground = new Function(`return ${heldBackgroundSource}`)()
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
  const lengthBases = [9000, 8000]
  const sentinelFor = ({ type }, index, pass) => {
    if (type === "color") {
      return ["color", `rgb(1 ${pass + 1} ${index * pass})`]
    }
    if (type === "fontFamily") {
      return ["font-family", `"paper-sentinel-${pass}-${index}"`]
    }
    return ["padding-left", `${lengthBases[pass - 1] + index * pass}px`]
  }
  const [first, second] = [1, 2].map((pass) =>
    tokens.map((token, index) => {
      const [property, value] = sentinelFor(token, index, pass)
      return { name: token.name, value, serialized: serialize(property, value) }
    })
  )
  const resolver = frame.appendChild(document.createElement("div"))
  const resolvedTokens = new Map(
    tokens.map((token, index) => {
      const [property] = sentinelFor(token, index, 1)
      resolver.style.setProperty(property, `var(${token.name})`)
      return [token.name, getComputedStyle(resolver).getPropertyValue(property)]
    })
  )
  resolver.remove()
  const [firstNames, secondNames] = [first, second].map(
    (sentinels) =>
      new Map(sentinels.map(({ name, serialized }) => [serialized, name]))
  )

  const elements = []
  const unsupported = []
  const record = (layer, property, value) =>
    unsupported.push({ layer, property, value })

  const host = document.head.appendChild(document.createElement("div"))
  const shadow = host.attachShadow({ mode: "open" })
  const reference = shadow.appendChild(document.createElement("div"))
  const followsColor = (() => {
    const sample = shadow.appendChild(document.createElement("div"))
    sample.style.cssText = "all: initial; color: rgb(1, 2, 3)"
    const style = getComputedStyle(sample)
    const names = [...style].filter(
      (property) => style.getPropertyValue(property) === "rgb(1, 2, 3)"
    )
    sample.remove()
    return new Set(names)
  })()
  let context = null
  const enter = (element) => {
    if (element === context) {
      return
    }
    context = element
    const style = getComputedStyle(element)
    host.style.cssText = ""
    for (const property of style) {
      const value = style.getPropertyValue(property)
      // A computed currentcolor is a literal, which would stop following the
      // colour each reference is given.
      const isCurrentColor =
        property !== "color" &&
        followsColor.has(property) &&
        value === style.color
      host.style.setProperty(property, isCurrentColor ? "currentcolor" : value)
    }
  }
  const bindsSize = (node, property, value) => {
    const before = node.getBoundingClientRect()
    const authored = node.getAttribute("style")
    // Chromium writes CSSOM edits back to the attribute lazily, which leaves
    // style="" in an svg's outerHTML after removeAttribute.
    node.setAttribute(
      "style",
      `${authored ?? ""}; ${property}: ${value} !important`
    )
    const after = node.getBoundingClientRect()
    if (authored === null) {
      node.removeAttribute("style")
    } else {
      node.setAttribute("style", authored)
    }
    return before.width !== after.width || before.height !== after.height
  }
  const dropped = (node, references, isEmitted = () => false) => {
    const style = getComputedStyle(node)
    for (const reference of references) {
      reference.style.color = style.color
    }
    const referenceStyles = references.map((reference) =>
      getComputedStyle(reference)
    )
    const ownDefaults = tagDefaults[node.localName] ?? []
    return compared.flatMap((property) => {
      // getComputedStyle resolves an auto inset of a positioned element to
      // the length it lands at, which moves nothing.
      const value = insets.includes(property)
        ? String(node.computedStyleMap().get(property))
        : style.getPropertyValue(property)
      const isHarmless =
        isEmitted(property, style, node) ||
        ownDefaults.includes(property) ||
        (property === "vertical-align" &&
          !/^(inline|table-cell)/.test(style.display)) ||
        harmlessValues.get(property)?.test(value) ||
        referenceStyles.some(
          (reference) => reference.getPropertyValue(property) === value
        ) ||
        (constraints.includes(property) &&
          !bindsSize(
            node,
            property,
            referenceStyles[0].getPropertyValue(property)
          ))
      return isHarmless ? [] : [[property, value]]
    })
  }
  const hasContentBoxEdges = (style, property) => {
    const edges = property.endsWith("width")
      ? ["left", "right"]
      : ["top", "bottom"]
    return (
      style.boxSizing === "content-box" &&
      edges.some(
        (side) =>
          parseFloat(style.getPropertyValue(`padding-${side}`)) > 0 ||
          parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0
      )
    )
  }
  // text-decoration-line does not inherit: it paints across the text inside,
  // which never carries it.
  const movesOrTurns = new RegExp(movesOrTurnsSource)
  const scrolls = (node, property) => {
    const value = getComputedStyle(node).getPropertyValue(property)
    const overflows =
      property === "overflow-x"
        ? node.scrollWidth > node.clientWidth
        : node.scrollHeight > node.clientHeight
    return value === "scroll" || (value === "auto" && overflows)
  }
  const isEmittedBy = (hasText) => (property, style, node) => {
    if (!emitted.has(property)) {
      return false
    }
    if (
      property.startsWith("text-decoration-") ||
      property === "text-underline-offset"
    ) {
      return hasText
    }
    if (constraints.includes(property)) {
      return !hasContentBoxEdges(style, property)
    }
    if (property === "position" || insets.includes(property)) {
      return style.position !== "fixed"
    }
    if (property === "overflow-x" || property === "overflow-y") {
      return !scrolls(node, property)
    }
    if (property === "transform") {
      return movesOrTurns.test(node.computedStyleMap().get(property))
    }
    if (backgroundLonghands.includes(property)) {
      return isHeldBackground(style)
    }
    return true
  }
  const recordDropped = (node, path, hasText) => {
    for (const [property, value] of dropped(
      node,
      [reference],
      isEmittedBy(hasText)
    )) {
      record(path, property, value)
    }
    for (const pseudo of ["::before", "::after"]) {
      const { content } = getComputedStyle(node, pseudo)
      if (content !== "none" && content !== "normal") {
        record(path, pseudo, content)
      }
    }
    const style = getComputedStyle(node)
    const marker = markerOf(style)
    if (marker) {
      record(path, "::marker", marker)
    }
    const isWidgetInput =
      node.localName === "input" && widgetInputs.includes(node.type)
    const drawsItself =
      replacedElements.includes(node.localName) ||
      ((isWidgetInput || widgets.includes(node.localName)) &&
        style.appearance !== "none")
    // A fieldset lays its first legend out apart from its other children, at
    // the legend's own width.
    const isRenderedLegend =
      node.parentElement?.localName === "fieldset" &&
      node === node.parentElement.querySelector(":scope > legend")
    if (drawsItself || isRenderedLegend) {
      const element = isWidgetInput ? `input type=${node.type}` : node.localName
      record(path, "element", element)
    }
    const value = node.value || node.placeholder
    const showsValue =
      ["input", "textarea", "select"].includes(node.localName) && !isWidgetInput
    if (showsValue && value) {
      record(path, "value", value)
    }
  }
  const recordSvg = (svg, path) => {
    const copies = [svg, svg].map((root) =>
      shadow.appendChild(root.cloneNode(true))
    )
    // Paper writes flex-shrink: 0 on every svg it imports.
    copies[1].style.flexShrink = "0"
    const [live, copied] = [svg, copies[0]].map((root) => [
      root,
      ...root.querySelectorAll("*"),
    ])
    live.forEach((element, index) => {
      const at = index === 0 ? path : `${path} > ${element.localName}`
      const references = index === 0 ? copies : [copied[index]]
      for (const [property, value] of dropped(element, references)) {
        record(at, property, value)
      }
    })
    for (const copy of copies) {
      copy.remove()
    }
    if (svg.outerHTML.includes("currentColor")) {
      record(path, "color", getComputedStyle(svg).color)
    }
  }

  const paintsNothing = (style) =>
    style.backgroundColor === "rgba(0, 0, 0, 0)" &&
    style.backgroundImage === "none" &&
    style.boxShadow === "none" &&
    style.outlineStyle === "none" &&
    ["top", "right", "bottom", "left"].every(
      (side) =>
        style.getPropertyValue(`border-${side}-style`) === "none" ||
        parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0
    )
  const recordAbsolute = (node, path, children, contextElement) => {
    const { offsetParent } = node
    if (offsetParent !== contextElement) {
      record(
        path,
        "containing block",
        offsetParent?.dataset.slot ?? offsetParent?.localName ?? "viewport"
      )
    }
    if (children.length === 0 && paintsNothing(getComputedStyle(node))) {
      record(path, "empty layer", "absolute")
    }
  }

  const visit = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(/\s+/g, " ")
      return text.trim() ? [{ text }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return []
    }
    const style = getComputedStyle(node)
    const { display } = style
    if (display === "none") {
      return []
    }
    if (display === "contents") {
      return [...node.childNodes].flatMap((child) => visit(child, parent))
    }
    const contextElement = parent?.element ?? frame.parentElement
    if (node.localName === "svg") {
      const path = `${parent.path} > svg`
      enter(contextElement)
      recordSvg(node, path)
      const { width, height } = node.getBoundingClientRect()
      return [
        {
          svg: node.outerHTML,
          path,
          size: { width: round(width), height: round(height) },
        },
      ]
    }
    const name = node.dataset.paperLayer ?? node.dataset.slot ?? null
    const path = parent ? `${parent.path} > ${name ?? node.localName}` : name
    const kind =
      node === frame ? "frame" : node.dataset.paperLayer ? "chrome" : "slot"
    const entry = { element: node, parent, name, kind, path }
    const children = [...node.childNodes].flatMap((child) =>
      visit(child, entry)
    )
    if (children.length === 1 && "text" in children[0]) {
      children[0].text = children[0].text.trim()
    }
    const hasText = children.some((child) => "text" in child)
    const hasElements = children.some((child) => !("text" in child))
    if (hasText && hasElements) {
      record(path, "children", "text and elements")
    }
    const hasSupportedLayout =
      /^(block|(inline-)?(flex|grid))$/.test(display) ||
      (display === "list-item" && !markerOf(style))
    if (hasElements && !hasSupportedLayout) {
      record(path, "display", display)
    }
    enter(contextElement)
    recordDropped(node, path, hasText)
    if (style.position === "absolute") {
      recordAbsolute(node, path, children, contextElement)
    }
    Object.assign(entry, { hasText, children })
    elements.push(entry)
    return [entry]
  }
  const [tree] = visit(frame, null)

  const read = () =>
    elements.map(({ element, hasText }) => {
      const style = getComputedStyle(element)
      const properties = hasText
        ? [...boxProperties, ...textProperties]
        : boxProperties
      const computed = element.computedStyleMap()
      return Object.fromEntries(
        properties.map((property) => [
          property,
          computedProperties.includes(property)
            ? String(computed.get(property))
            : style.getPropertyValue(property),
        ])
      )
    })
  const tokenValues = (element) => {
    const style = getComputedStyle(element)
    return tokens.map(({ name }) => style.getPropertyValue(name))
  }
  const readMarked = (sentinels, inspect) => {
    for (const { name, value } of sentinels) {
      frame.style.setProperty(name, value)
    }
    const values = read()
    inspect?.()
    for (const { name } of sentinels) {
      frame.style.removeProperty(name)
    }
    return values
  }
  const readDirectTokenUses = (sentinels) => {
    const pinned = elements.map(({ element }) => ({
      element,
      authored: element.getAttribute("style"),
      fontSize: getComputedStyle(element).fontSize,
    }))
    for (const { element, fontSize } of pinned) {
      element.style.setProperty("font-size", fontSize, "important")
    }
    const values = readMarked(sentinels)
    for (const { element, authored } of pinned) {
      if (authored === null) {
        element.removeAttribute("style")
      } else {
        element.setAttribute("style", authored)
      }
    }
    return values
  }
  const recordRedeclared = () => {
    for (const { element, parent, path } of elements) {
      if (!parent) {
        continue
      }
      const [values, inherited] = [element, parent.element].map(tokenValues)
      const redeclared = tokens
        .filter((_, index) => values[index] !== inherited[index])
        .map(({ name }) => name)
      if (redeclared.length > 0) {
        record(path, "tokens", redeclared.join(" "))
      }
    }
  }

  const real = read()
  const rects = elements.map(({ element }) => element.getBoundingClientRect())
  const marked = [
    readMarked(first, recordRedeclared),
    readMarked(second),
    readDirectTokenUses(first),
  ]

  const splitParts = (value) => {
    const parts = []
    let current = ""
    let depth = 0
    let isQuoted = false
    for (const character of value) {
      if (character === '"') {
        isQuoted = !isQuoted
      }
      if (depth === 0 && !isQuoted && /[\s,]/.test(character)) {
        if (current) {
          parts.push(current)
        }
        if (character === ",") {
          parts.push(",")
        }
        current = ""
        continue
      }
      if (character === "(") {
        depth++
      }
      if (character === ")") {
        depth--
      }
      current += character
    }
    return current ? [...parts, current] : parts
  }
  const joinParts = (parts) => parts.join(" ").replaceAll(" ,", ",")

  const decide = (
    real,
    [markedFirst, markedSecond, markedWithFontSizesPinned]
  ) => {
    if (real === markedFirst && real === markedSecond) {
      return { value: real, tokens: [] }
    }
    const [realParts, firstParts, secondParts, partsWithFontSizesPinned] = [
      real,
      markedFirst,
      markedSecond,
      markedWithFontSizesPinned,
    ].map(splitParts)
    const boundAt = (index, realPart) => {
      const name = firstNames.get(firstParts[index])
      const isBound =
        name &&
        secondNames.get(secondParts[index]) === name &&
        resolvedTokens.get(name) === realPart
      return isBound ? name : null
    }
    const isAligned =
      realParts.length === firstParts.length &&
      secondParts.length === firstParts.length
    if (!isAligned) {
      const name = firstParts.length === 1 && boundAt(0, real)
      return name
        ? { value: `var(${name})`, tokens: [name] }
        : {
            value: real,
            tokens: [],
            unbound: markedWithFontSizesPinned !== real,
          }
    }
    const found = []
    let unbound = false
    const parts = realParts.map((part, index) => {
      const name = boundAt(index, part)
      if (name) {
        found.push(name)
        return `var(${name})`
      }
      const dependsOnToken =
        firstParts[index] !== part || secondParts[index] !== part
      if (dependsOnToken && partsWithFontSizesPinned[index] !== part) {
        unbound = true
      }
      return part
    })
    return { value: joinParts(parts), tokens: found, unbound }
  }

  const usedLineHeight = (element) => {
    const style = getComputedStyle(element)
    const line = frame.appendChild(document.createElement("div"))
    line.style.cssText = "position: absolute; line-height: normal"
    for (const property of [
      "font-family",
      "font-size",
      "font-style",
      "font-weight",
      "font-stretch",
    ]) {
      line.style.setProperty(property, style.getPropertyValue(property))
    }
    line.textContent = "x"
    const { height } = line.getBoundingClientRect()
    line.remove()
    return `${round(height)}px`
  }

  // Chromium floors a length to 1/64 px and prints six significant digits.
  // Paper keeps three decimals, so the length is rounded up to three.
  const usedLength = (style, property) => {
    const sixtyFourths = Math.round(
      parseFloat(style.getPropertyValue(property)) * 64
    )
    return `${Math.ceil(sixtyFourths * 15.625) / 1000}px`
  }
  // Paper moves an absolute layer to where it paints among its siblings, which
  // moves a box placed at its static position.
  const pinStaticPosition = ({ element, styles }) => {
    const style = getComputedStyle(element)
    for (const [start, end] of [
      ["left", "right"],
      ["top", "bottom"],
    ]) {
      if (styles[start].value === "auto" && styles[end].value === "auto") {
        styles[start] = { value: usedLength(style, start), tokens: [] }
      }
    }
  }

  // Paper rounds a percentage width or height to a whole pixel, and wraps text
  // anywhere, which shrinks a min-content size to one character.
  const pinUsedSize = ({ element, styles }) => {
    const style = getComputedStyle(element)
    for (const property of ["width", "height"]) {
      const { value } = styles[property]
      const used = usedLength(style, property)
      const isRounded =
        value.endsWith("%") &&
        value !== "100%" &&
        !Number.isInteger(parseFloat(used))
      if (isRounded || value === "min-content") {
        styles[property] = { value: used, tokens: [] }
      }
    }
  }

  const colorPattern = new RegExp(colorSource, "g")
  const colors = {}
  elements.forEach((entry, index) => {
    entry.styles = {}
    for (const property of Object.keys(real[index])) {
      const decided = decide(
        real[index][property],
        marked.map((values) => values[index][property])
      )
      // Paper's own normal line height differs from Chromium's at some sizes.
      if (property === "line-height" && decided.value === "normal") {
        decided.value = usedLineHeight(entry.element)
      }
      entry.styles[property] = decided
      for (const [color] of decided.value.matchAll(colorPattern)) {
        colors[color] = serialize(
          "color",
          `color-mix(in srgb, ${color}, ${color})`
        )
      }
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
  host.remove()
  return { tree, colors, unsupported }
}

const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttribute = (text) => escapeText(text).replace(/"/g, "&quot;")

const flattenFrame = async (page, tokens) => {
  const { tree, colors, unsupported } = await page.evaluate(readFrame, {
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
    markerSource: String(markerOf),
    heldBackgroundSource: String(isHeldBackground),
    sizeConstraints,
    insets: sides,
    harmlessSources: harmlessValues.map(([property, pattern]) => [
      property,
      pattern.source,
    ]),
    tagDefaults,
    backgroundLonghands,
    movesOrTurnsSource: movesOrTurns.source,
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
      layers.push({ layer: node.path, kind: "svg", ...node.size })
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

export { flattenFrame, markerOf }
