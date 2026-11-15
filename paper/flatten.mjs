import { toPaperColor } from "./tokens.mjs"

const sides = ["top", "right", "bottom", "left"]
const corners = ["top-left", "top-right", "bottom-right", "bottom-left"]
const boxProperties = [
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "justify-content",
  "flex-grow",
  "flex-shrink",
  "row-gap",
  "column-gap",
  ...sides.map((side) => `padding-${side}`),
  ...sides.flatMap((side) =>
    ["width", "style", "color"].map((part) => `border-${side}-${part}`)
  ),
  ...corners.map((corner) => `border-${corner}-radius`),
  "background-color",
  "box-shadow",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "opacity",
]
const textProperties = [
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "white-space",
]
const paperDefaults = {
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "align-items": "normal",
  "justify-content": "normal",
  "flex-grow": "0",
  "flex-shrink": "1",
  "background-color": "rgba(0, 0, 0, 0)",
  "box-shadow": "none",
  opacity: "1",
  color: "rgb(0, 0, 0)",
  "font-size": "16px",
  "font-weight": "400",
  "font-style": "normal",
  "line-height": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-transform": "none",
  "text-decoration-line": "none",
  "white-space": "normal",
}
const unsupportedDefaults = {
  ...Object.fromEntries(sides.map((side) => [`margin-${side}`, "0px"])),
  position: "static",
  transform: "none",
  translate: "none",
  rotate: "none",
  scale: "none",
  visibility: "visible",
  "background-image": "none",
  "min-width": "auto",
  "min-height": "auto",
  "max-width": "none",
  "max-height": "none",
  "overflow-x": "visible",
  "overflow-y": "visible",
  direction: "ltr",
}
const inheritedProperties = ["visibility", "direction"]
const colorPattern =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g

const readFrame = ({
  tokens,
  boxProperties,
  textProperties,
  unsupportedDefaults,
  inheritedProperties,
  colorSource,
}) => {
  const frame = document.querySelector("[data-example]")
  const probe = document.head.appendChild(document.createElement("div"))
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
  const withoutFontSizes = first.filter(
    (_, index) => tokens[index].type !== "fontSize"
  )
  const [firstNames, secondNames] = [first, second].map(
    (sentinels) =>
      new Map(sentinels.map(({ name, serialized }) => [serialized, name]))
  )

  const elements = []
  const unsupported = []
  const record = (layer, property, value) =>
    unsupported.push({ layer, property, value })
  const recordSvg = (svg, path) => {
    const style = getComputedStyle(svg)
    for (const property of ["width", "height"]) {
      const value = style.getPropertyValue(property)
      if (value !== `${svg.getAttribute(property)}px`) {
        record(path, property, value)
      }
    }
    if (svg.outerHTML.includes("currentColor")) {
      record(path, "color", style.color)
    }
  }
  const recordDropped = (node, path, parent) => {
    const style = getComputedStyle(node)
    const defaults =
      node.localName === "svg"
        ? {
            ...unsupportedDefaults,
            "overflow-x": "hidden",
            "overflow-y": "hidden",
          }
        : unsupportedDefaults
    for (const [property, initial] of Object.entries(defaults)) {
      const value = style.getPropertyValue(property)
      const reference =
        parent && inheritedProperties.includes(property)
          ? getComputedStyle(parent.element).getPropertyValue(property)
          : initial
      if (value !== reference) {
        record(path, property, value)
      }
    }
    for (const pseudo of ["::before", "::after"]) {
      const { content } = getComputedStyle(node, pseudo)
      if (content !== "none" && content !== "normal") {
        record(path, pseudo, content)
      }
    }
    const value = node.value || node.placeholder
    if (["input", "textarea", "select"].includes(node.localName) && value) {
      record(path, "value", value)
    }
  }
  const visit = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(/\s+/g, " ")
      if (!text.trim()) {
        return []
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      const { top, bottom, left, right } = range.getBoundingClientRect()
      return [{ text, rect: { top, bottom, left, right } }]
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return []
    }
    const { display } = getComputedStyle(node)
    if (display === "none") {
      return []
    }
    if (display === "contents") {
      return [...node.childNodes].flatMap((child) => visit(child, parent))
    }
    const name = node.dataset.paperLayer ?? node.dataset.slot ?? null
    const path = parent ? `${parent.path} > ${name ?? node.localName}` : name
    recordDropped(node, path, parent)
    if (node.localName === "svg") {
      recordSvg(node, path)
      return [{ svg: node.outerHTML }]
    }
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
    if (hasElements && !/^(inline-)?flex$/.test(display)) {
      record(path, "display", display)
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
      return {
        ...Object.fromEntries(
          properties.map((property) => [
            property,
            style.getPropertyValue(property),
          ])
        ),
        width: String(computed.get("width")),
        height: String(computed.get("height")),
      }
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
    readMarked(withoutFontSizes),
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
    [markedFirst, markedSecond, markedWithoutFontSizes]
  ) => {
    if (real === "auto") {
      return null
    }
    if (real === markedFirst && real === markedSecond) {
      return { value: real, tokens: [] }
    }
    const [realParts, firstParts, secondParts, partsWithoutFontSizes] = [
      real,
      markedFirst,
      markedSecond,
      markedWithoutFontSizes,
    ].map(splitParts)
    const boundAt = (index) => {
      const name = firstNames.get(firstParts[index])
      return name && secondNames.get(secondParts[index]) === name ? name : null
    }
    const isAligned =
      realParts.length === firstParts.length &&
      secondParts.length === firstParts.length
    if (!isAligned) {
      const name = firstParts.length === 1 && boundAt(0)
      return name
        ? { value: `var(${name})`, tokens: [name] }
        : { value: real, tokens: [], unbound: markedWithoutFontSizes !== real }
    }
    const found = []
    let unbound = false
    const parts = realParts.map((part, index) => {
      const name = boundAt(index)
      if (name) {
        found.push(name)
        return `var(${name})`
      }
      const dependsOnToken =
        firstParts[index] !== part || secondParts[index] !== part
      if (dependsOnToken && partsWithoutFontSizes[index] !== part) {
        unbound = true
      }
      return part
    })
    return { value: joinParts(parts), tokens: found, unbound }
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
      if (!decided) {
        continue
      }
      entry.styles[property] = decided
      for (const [color] of decided.value.matchAll(colorPattern)) {
        colors[color] = serialize(
          "color",
          `color-mix(in srgb, ${color}, ${color})`
        )
      }
    }
    const { width, height, top, bottom, left, right } = rects[index]
    entry.size = {
      width: Math.round(width * 1000) / 1000,
      height: Math.round(height * 1000) / 1000,
    }
    entry.box = { top, bottom, left, right }
    delete entry.element
    delete entry.parent
  })
  probe.remove()
  return { tree, colors, unsupported }
}

const countDisjoint = (intervals) => {
  let count = 0
  let end = -Infinity
  for (const [start, stop] of intervals.toSorted((a, b) => a[1] - b[1])) {
    if (start >= end) {
      count++
      end = stop
    }
  }
  return count
}

const textRects = (node) => {
  if ("text" in node) {
    return [node.rect]
  }
  return "svg" in node ? [] : node.children.flatMap(textRects)
}

const countTextWithin = (rects, box, [start, end]) =>
  countDisjoint(
    rects
      .filter((rect) => rect[start] >= box[start] - 0.5)
      .filter((rect) => rect[end] <= box[end] + 0.5)
      .map((rect) => [rect[start], rect[end]])
  )

const compressSides = (values) => {
  const [top, right, bottom, left] = values
  if (values.every((value) => value === top)) {
    return [top]
  }
  if (top === bottom && right === left) {
    return [top, right]
  }
  return values
}

const toDeclarations = ({ styles, hasText, children }) => {
  const declarations = []
  const add = (property, parts, value) => {
    declarations.push({
      property,
      value: value ?? parts.map((part) => part.value).join(" "),
      tokens: [...new Set(parts.flatMap((part) => part.tokens))],
      isUnbound: parts.some((part) => part.unbound),
    })
  }
  const isDefault = (property) =>
    styles[property].tokens.length === 0 &&
    styles[property].value === paperDefaults[property]
  const keep = (property) => styles[property] && !isDefault(property)

  if (/^(inline-)?flex$/.test(styles.display.value)) {
    add("display", [], "flex")
    for (const property of [
      "flex-direction",
      "flex-wrap",
      "align-items",
      "justify-content",
    ]) {
      if (keep(property)) {
        const part = styles[property]
        add(property, [part], part.value.replace(/^safe /, ""))
      }
    }
    const [row, column] = [styles["row-gap"], styles["column-gap"]]
    const isSpacing = children.length > 1
    if (isSpacing && row.value === column.value && row.value !== "normal") {
      add("gap", [row])
    } else if (isSpacing) {
      for (const property of ["row-gap", "column-gap"]) {
        if (styles[property].value !== "normal") {
          add(property, [styles[property]])
        }
      }
    }
  }
  for (const property of ["flex-grow", "flex-shrink", "width", "height"]) {
    if (keep(property)) {
      add(property, [styles[property]])
    }
  }

  const padding = sides.map((side) => styles[`padding-${side}`])
  if (padding.some((part) => part.value !== "0px")) {
    const values = compressSides(padding.map((part) => part.value))
    add("padding", padding, values.join(" "))
  }
  const borders = sides.map((side) =>
    ["width", "style", "color"].map((part) => styles[`border-${side}-${part}`])
  )
  const drawn = borders.filter(
    ([width, style]) => style.value !== "none" && width.value !== "0px"
  )
  const borderValues = borders.map((parts) =>
    parts.map((part) => part.value).join(" ")
  )
  if (drawn.length === 4 && new Set(borderValues).size === 1) {
    add("border", borders[0])
  } else {
    sides.forEach((side, index) => {
      if (drawn.includes(borders[index])) {
        add(`border-${side}`, borders[index])
      }
    })
  }
  const radius = corners.map((corner) => styles[`border-${corner}-radius`])
  if (radius.some((part) => part.value !== "0px")) {
    const values = compressSides(radius.map((part) => part.value))
    add("border-radius", radius, values.join(" "))
  }
  for (const property of ["background-color", "box-shadow", "opacity"]) {
    if (keep(property)) {
      add(property, [styles[property]])
    }
  }
  if (styles["outline-style"].value !== "none") {
    add(
      "outline",
      ["width", "style", "color"].map((part) => styles[`outline-${part}`])
    )
    if (styles["outline-offset"].value !== "0px") {
      add("outline-offset", [styles["outline-offset"]])
    }
  }
  if (hasText) {
    for (const property of textProperties) {
      if (keep(property)) {
        add(property, [styles[property]])
      }
    }
  }
  return declarations
}

const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttribute = (text) => escapeText(text).replace(/"/g, "&quot;")

const flattenFrame = async (page, tokens) => {
  const { tree, colors, unsupported } = await page.evaluate(readFrame, {
    tokens,
    boxProperties,
    textProperties,
    unsupportedDefaults,
    inheritedProperties,
    colorSource: colorPattern.source,
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
      return node.svg
    }
    if (node.name) {
      layers.push({
        name: node.name,
        kind: node.kind,
        ...node.size,
        textRows: countTextWithin(text, node.box, ["top", "bottom"]),
        textColumns: countTextWithin(text, node.box, ["left", "right"]),
      })
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
    return `<div${attributes}>${node.children.map(render).join("")}</div>`
  }

  const text = textRects(tree)
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

export { flattenFrame }
