const createSvgReader =
  ({ comparison, record, round }) =>
  (svg, path) => {
    const found = comparison.droppedFromCopies(svg, [
      () => {},
      // Paper writes flex-shrink: 0 on every svg it imports.
      (copy) => {
        copy.style.flexShrink = "0"
      },
    ])
    for (const { element, property, value } of found) {
      const at = element === svg ? path : `${path} > ${element.localName}`
      record(at, property, value)
    }
    if (svg.outerHTML.includes("currentColor")) {
      record(path, "color", getComputedStyle(svg).color)
    }
    const { width, height } = svg.getBoundingClientRect()
    return {
      svg: svg.outerHTML,
      path,
      size: { width: round(width), height: round(height) },
    }
  }

export { createSvgReader }
