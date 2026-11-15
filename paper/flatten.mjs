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
const colorPattern =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g

const readFrame = ({ tokens, boxProperties, textProperties, colorSource }) => {
  const frame = document.querySelector("[data-example]")
  const probe = document.body.appendChild(document.createElement("div"))
  const serialize = (property, value) => {
    probe.style.setProperty(property, value)
    return getComputedStyle(probe).getPropertyValue(property)
  }
  const sentinelFor = ({ type }, index) => {
    if (type === "color") {
      return ["color", `rgb(1 2 ${index})`]
    }
    if (type === "fontFamily") {
      return ["font-family", `"paper-sentinel-${index}"`]
    }
    return ["padding-left", `${9000 + index}px`]
  }
  const sentinels = tokens.map((token, index) => {
    const [property, value] = sentinelFor(token, index)
    const serialized = serialize(property, value)
    const escaped = serialized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return {
      name: token.name,
      value,
      serialized,
      pattern: new RegExp(`(?<![\\w.-])${escaped}(?![\\w.])`, "g"),
    }
  })

  const elements = []
  const unsupported = []
  const visit = (node, parentPath) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(/\s+/g, " ")
      return text.trim() ? [{ text }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return []
    }
    const { display } = getComputedStyle(node)
    if (display === "none") {
      return []
    }
    if (display === "contents") {
      return [...node.childNodes].flatMap((child) => visit(child, parentPath))
    }
    if (node.localName === "svg") {
      return [{ svg: node.outerHTML }]
    }
    const name = node.dataset.paperLayer ?? node.dataset.slot ?? null
    const kind =
      node === frame ? "frame" : node.dataset.paperLayer ? "chrome" : "slot"
    const path = parentPath ? `${parentPath} > ${name ?? node.localName}` : name
    const children = [...node.childNodes].flatMap((child) => visit(child, path))
    if (children.length === 1 && "text" in children[0]) {
      children[0].text = children[0].text.trim()
    }
    const hasText = children.some((child) => "text" in child)
    const hasElements = children.some((child) => !("text" in child))
    if (hasElements && !/^(inline-)?flex$/.test(display)) {
      unsupported.push({ layer: path, property: "display", value: display })
    }
    const entry = { element: node, name, kind, path, hasText, children }
    elements.push(entry)
    return [entry]
  }
  const [tree] = visit(frame, "")

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
  const real = read()
  const rects = elements.map(({ element }) => element.getBoundingClientRect())
  for (const { name, value } of sentinels) {
    frame.style.setProperty(name, value)
  }
  const marked = read()
  for (const { name } of sentinels) {
    frame.style.removeProperty(name)
  }

  const decide = (value, markedValue) => {
    if (value === "auto") {
      return null
    }
    if (value === markedValue) {
      return { value, tokens: [] }
    }
    const found = sentinels.filter(({ pattern }) => markedValue.match(pattern))
    if (found.length === 0) {
      return { value, tokens: [], unbound: true }
    }
    return {
      value: found.reduce(
        (bound, { name, pattern }) => bound.replace(pattern, `var(${name})`),
        markedValue
      ),
      tokens: found.map(({ name }) => name),
    }
  }

  const colorPattern = new RegExp(colorSource, "g")
  const colors = {}
  elements.forEach((entry, index) => {
    entry.styles = {}
    for (const property of Object.keys(real[index])) {
      const decided = decide(real[index][property], marked[index][property])
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
    const { width, height } = rects[index]
    entry.size = {
      width: Math.round(width * 1000) / 1000,
      height: Math.round(height * 1000) / 1000,
    }
    delete entry.element
  })
  probe.remove()
  return { tree, colors, unsupported }
}

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

const toDeclarations = ({ styles, hasText }) => {
  const declarations = []
  const add = (property, parts, value) => {
    declarations.push({
      property,
      value: value ?? parts.map((part) => part.value).join(" "),
      tokens: [...new Set(parts.flatMap((part) => part.tokens))],
      unbound: parts.filter((part) => part.unbound),
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
    if (row.value === column.value && row.value !== "normal") {
      add("gap", [row])
    } else {
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
    colorSource: colorPattern.source,
  })
  const layers = []
  const bindings = []
  const unbound = []
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
      layers.push({ name: node.name, kind: node.kind, ...node.size })
    }
    const declarations = toDeclarations(node)
    for (const { property, tokens, unbound: parts } of declarations) {
      for (const token of tokens) {
        bindings.push({ layer: node.path, property, token })
      }
      for (const { value } of parts) {
        unbound.push({ layer: node.path, property, value })
      }
    }
    const style = declarations
      .map(({ property, value }) => `${property}: ${toPaperValue(value)}`)
      .join("; ")
    const attributes = [
      node.name && ` layer-name="${escapeAttribute(node.name)}"`,
      style && ` style="${escapeAttribute(style)}"`,
    ].join("")
    return `<div${attributes}>${node.children.map(render).join("")}</div>`
  }

  const html = render(tree)
  const [frame] = layers
  return {
    html,
    frame: { width: frame.width, height: frame.height },
    layers,
    bindings,
    unbound,
    unsupported,
  }
}

export { flattenFrame }
