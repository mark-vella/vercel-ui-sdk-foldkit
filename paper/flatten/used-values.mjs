const createUsedValues = ({ frame, round }) => {
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
  return { usedLineHeight, pinStaticPosition, pinUsedSize }
}

export { createUsedValues }
