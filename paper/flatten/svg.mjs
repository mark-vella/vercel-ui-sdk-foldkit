const createSvgReader =
  ({ shadow, dropped, record, round }) =>
  (svg, path) => {
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
    const { width, height } = svg.getBoundingClientRect()
    return {
      svg: svg.outerHTML,
      path,
      size: { width: round(width), height: round(height) },
    }
  }

export { createSvgReader }
