import { corners, sides, textProperties } from "./properties.mjs"

const paperDefaults = {
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "align-items": "normal",
  "justify-content": "normal",
  "flex-grow": "0",
  "flex-shrink": "1",
  "flex-basis": "auto",
  "align-self": "auto",
  "justify-self": "auto",
  "align-content": "normal",
  "justify-items": "normal",
  "grid-template-columns": "none",
  "grid-template-rows": "none",
  "grid-template-areas": "none",
  "grid-auto-flow": "row",
  "grid-auto-columns": "auto",
  "grid-auto-rows": "auto",
  "grid-column-start": "auto",
  "grid-column-end": "auto",
  "grid-row-start": "auto",
  "grid-row-end": "auto",
  position: "static",
  top: "auto",
  right: "auto",
  bottom: "auto",
  left: "auto",
  "z-index": "auto",
  order: "0",
  width: "auto",
  height: "auto",
  "min-width": "auto",
  "min-height": "auto",
  "max-width": "none",
  "max-height": "none",
  "aspect-ratio": "auto",
  "text-overflow": "clip",
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "box-shadow": "none",
  opacity: "1",
  transform: "none",
  rotate: "none",
  translate: "none",
  filter: "none",
  "backdrop-filter": "none",
  isolation: "auto",
  visibility: "visible",
  color: "rgb(0, 0, 0)",
  "font-size": "16px",
  "font-weight": "400",
  "font-style": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-transform": "none",
  "text-decoration-line": "none",
  "text-underline-offset": "auto",
  "font-variant-numeric": "normal",
  "text-wrap-style": "auto",
  "white-space": "normal",
  "overflow-wrap": "normal",
}

const alignment = ["align-items", "justify-content", "align-content"]
const containerProperties = {
  flex: ["flex-direction", "flex-wrap", ...alignment],
  grid: [
    "grid-template-columns",
    "grid-template-rows",
    "grid-template-areas",
    "grid-auto-flow",
    "grid-auto-columns",
    "grid-auto-rows",
    "justify-items",
    ...alignment,
  ],
}
const gridPlacement = [
  "grid-column-start",
  "grid-column-end",
  "grid-row-start",
  "grid-row-end",
]

// Paper drops a lone no-repeat layer, turns layers that are all one colour
// into a background colour, and uploads an image to its own host.
const isHeldBackground = ({ backgroundImage, backgroundRepeat }) => {
  const layers = backgroundRepeat.split(", ")
  const solidLayers = backgroundImage.match(
    /linear-gradient\((rgba?\([^()]*\)), \1\)/g
  )
  return !(
    backgroundImage.includes("url(") ||
    solidLayers?.length === layers.length ||
    (layers.length === 1 && layers[0].includes("no-repeat"))
  )
}

// Paper interpolates a gradient in oklab whatever space it asks for, unless a
// layer is sized or placed: then it keeps the background as written.
const rewrittenGradientSpaces = ({
  backgroundImage,
  backgroundSize,
  backgroundPosition,
}) => {
  const isPlaced =
    backgroundSize
      .split(", ")
      .some((size) => !["auto", "100% 100%"].includes(size)) ||
    backgroundPosition.split(", ").some((position) => position !== "0% 0%")
  if (isPlaced) {
    return []
  }
  const blended = backgroundImage.replace(
    /linear-gradient\((rgba?\([^()]*\)), \1\)/g,
    ""
  )
  const spaces = [...blended.matchAll(/gradient\(([^,]*)/g)].map(
    ([, first]) => first.match(/\bin ([\w-]+)/)?.[1] ?? "srgb"
  )
  return [...new Set(spaces)].filter((space) => space !== "oklab")
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

// Paper keeps only the first family and falls back to system-ui after it.
const paperFontFamily = ({ value, tokens }) =>
  tokens.length > 0 ? value : `${value.split(",")[0]}, system-ui, sans-serif`

const toDeclarations = ({ kind, styles, hasText, children, fit }) => {
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
  const addKept = (property) => {
    if (keep(property)) {
      const part = styles[property]
      add(property, [part], part.value.replace(/^safe /, ""))
    }
  }

  const layout = styles.display.value.replace(/^inline-/, "")
  if (layout === "flex" || layout === "grid") {
    add("display", [], layout)
    for (const property of containerProperties[layout]) {
      addKept(property)
    }
    const [row, column] = [styles["row-gap"], styles["column-gap"]]
    const isSpacing =
      layout === "grid"
        ? children.some((child) => !("text" in child))
        : children.length > 1
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
  const hasSize = keep("width") || keep("height")
  addKept("flex-grow")
  if (keep("flex-shrink") || hasSize) {
    add("flex-shrink", [styles["flex-shrink"]])
  }
  for (const property of [
    "flex-basis",
    "align-self",
    "justify-self",
    "order",
    ...gridPlacement,
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "aspect-ratio",
  ]) {
    addKept(property)
  }
  if (fit) {
    add("width", [], "fit-content")
  }

  if (keep("position") && styles.position.value !== "fixed") {
    for (const property of ["position", ...sides]) {
      addKept(property)
    }
  }
  addKept("z-index")

  const addSides = (property, parts) => {
    if (parts.some((part) => part.value !== "0px")) {
      const values = compressSides(parts.map((part) => part.value))
      add(property, parts, values.join(" "))
    }
  }
  addSides(
    "margin",
    sides.map((side) => styles[`margin-${side}`])
  )
  addSides(
    "padding",
    sides.map((side) => styles[`padding-${side}`])
  )
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
  addSides(
    "border-radius",
    corners.map((corner) => styles[`border-${corner}-radius`])
  )
  const [overflowX, overflowY] = [styles["overflow-x"], styles["overflow-y"]]
  if (overflowX.value === overflowY.value && overflowX.value !== "visible") {
    add("overflow", [overflowX])
  } else if (overflowX.value !== overflowY.value) {
    add("overflow-x", [overflowX])
    add("overflow-y", [overflowY])
  }
  addKept("text-overflow")
  addKept("background-color")
  const background = {
    backgroundImage: styles["background-image"].value,
    backgroundRepeat: styles["background-repeat"].value,
  }
  if (keep("background-image") && isHeldBackground(background)) {
    for (const property of [
      "background-image",
      "background-size",
      "background-position",
      "background-repeat",
    ]) {
      add(property, [styles[property]])
    }
  }
  for (const property of [
    "box-shadow",
    "opacity",
    "transform",
    "rotate",
    "translate",
    "filter",
    "backdrop-filter",
    "isolation",
    "visibility",
  ]) {
    addKept(property)
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
  addKept("direction")
  // Paper never synthesizes bold or italic in a frame it imports.
  if (kind === "frame") {
    add("font-synthesis", [], "none")
  }
  if (hasText) {
    const isDecorationColorImplied =
      styles["text-decoration-line"].value === "none" ||
      (styles["text-decoration-color"].value === styles.color.value &&
        styles["text-decoration-color"].tokens.join() ===
          styles.color.tokens.join())
    for (const property of textProperties) {
      if (property === "font-family") {
        add(property, [styles[property]], paperFontFamily(styles[property]))
      } else if (property === "text-decoration-thickness") {
        // Paper stores an underline with no thickness as 1px thick.
        if (styles["text-decoration-line"].value !== "none") {
          add(property, [styles[property]])
        }
      } else if (
        property !== "text-decoration-color" ||
        !isDecorationColorImplied
      ) {
        addKept(property)
      }
    }
  }
  return declarations
}

const isAbsolute = (node) => node.styles?.position.value === "absolute"

const paintLevel = ({ styles }) => {
  if (!styles || styles.position.value === "fixed") {
    return -0.5
  }
  const zIndex = styles["z-index"].value
  if (zIndex !== "auto") {
    return Number(zIndex)
  }
  return styles.position.value === "static" ? -0.5 : 0
}

const toPaperOrder = (children) => {
  const position = new Map(children.map((child, index) => [child, index]))
  const inFlow = children.filter((child) => !isAbsolute(child))
  const before = inFlow.map(() => [])
  const after = []
  const absolute = children
    .filter(isAbsolute)
    .toSorted((a, b) => paintLevel(a) - paintLevel(b))
  for (const child of absolute) {
    const level = paintLevel(child)
    const above = inFlow.findIndex(
      (other) =>
        paintLevel(other) > level ||
        (paintLevel(other) === level &&
          position.get(other) > position.get(child))
    )
    ;(above < 0 ? after : before[above]).push(child)
  }
  return [
    ...inFlow.flatMap((child, index) => [...before[index], child]),
    ...after,
  ]
}

export {
  isHeldBackground,
  rewrittenGradientSpaces,
  toDeclarations,
  toPaperOrder,
}
