import { corners, sides, textProperties } from "./properties.mjs"

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
  "letter-spacing": "normal",
  "text-align": "start",
  "text-transform": "none",
  "text-decoration-line": "none",
  "white-space": "normal",
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

export { toDeclarations }
