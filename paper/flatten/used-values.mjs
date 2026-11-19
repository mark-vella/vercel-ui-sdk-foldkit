// Chromium floors a length to 1/64 px and prints six significant digits.
// Paper keeps three decimals, so the length is rounded up to three.
const toPaperLength = (pixels) =>
  `${Math.ceil(Math.round(pixels * 64) * 15.625) / 1000}px`

const createUsedValues = ({ frame, round, toPaperLength }) => {
  const lineHeightOf = (element, pseudo, value) => {
    const own = element.computedStyleMap().get("line-height")
    if (!pseudo) {
      return own
    }
    if (own.unit !== "number") {
      return null
    }
    const { fontSize } = getComputedStyle(element, pseudo)
    const isInherited =
      Math.abs(own.value * parseFloat(fontSize) - parseFloat(value)) < 0.001
    return isInherited ? own : null
  }
  const usedLineHeight = (element, pseudo, value) => {
    const lineHeight =
      value === "normal" ? value : lineHeightOf(element, pseudo, value)
    if (String(lineHeight) !== "normal" && lineHeight?.unit !== "number") {
      return null
    }
    const style = getComputedStyle(element, pseudo)
    const line = frame.appendChild(document.createElement("div"))
    line.style.cssText = `position: absolute; line-height: ${lineHeight}`
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

  const usedLength = (style, property) =>
    toPaperLength(parseFloat(style.getPropertyValue(property)))
  const pinPseudoLengths = (element, pseudo, styles) => {
    const style = getComputedStyle(element, pseudo)
    for (const [property, decided] of Object.entries(styles)) {
      const isLaidOut =
        /^(width|height|top|right|bottom|left|margin-\w+)$/.test(property) &&
        /^-?[\d.]+px$/.test(decided.value) &&
        decided.value === style.getPropertyValue(property)
      if (isLaidOut) {
        styles[property] = { ...decided, value: usedLength(style, property) }
      }
    }
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
  const pinUsedSize = ({ element, pseudo, styles }) => {
    if (pseudo) {
      pinPseudoLengths(element, pseudo, styles)
    }
    const style = getComputedStyle(element, pseudo)
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
  return { usedLineHeight, pinStaticPosition, pinUsedSize }
}

export { createUsedValues, toPaperLength }
