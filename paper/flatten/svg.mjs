const createSvgReader = ({ comparison, record, round }) => {
  const pending = []
  const elementsOf = (svg) => [svg, ...svg.querySelectorAll("*")]
  const heldOnRoot =
    /^(width|height|order|rotate|opacity|visibility|display|position|top|right|bottom|left|margin-(top|right|bottom|left)|stroke-width)$/
  const heldOnShape = /^(stroke-width|display|visibility)$/
  const isHeld = ({ index, property, value }) => {
    if (index > 0) {
      return heldOnShape.test(property)
    }
    // Paper drops display: block from an svg, which leaves it inline.
    const isBlock = property === "display" && value === "block"
    return heldOnRoot.test(property) && !isBlock
  }
  const translate = (copy, changes, colorAt) => {
    const copied = elementsOf(copy)
    for (const { index, property, value } of changes) {
      // Paper keeps an svg's own styles, and moves a stroke-width attribute
      // onto the shapes inside, where it still inherits.
      if (index === 0 && property !== "stroke-width") {
        copied[index].style.setProperty(property, value)
      } else {
        copied[index].setAttribute(property, value)
      }
    }
    copied.forEach((element, index) => {
      for (const { name, value } of [...element.attributes]) {
        if (/currentcolor/i.test(value)) {
          const color = colorAt(index)
          element.setAttribute(name, value.replace(/currentcolor/gi, color))
        }
      }
    })
    return copy
  }
  const withFlexShrink = (adjust) => [
    adjust,
    // Paper writes flex-shrink: 0 on every svg it imports.
    (copy) => {
      adjust(copy)
      copy.style.flexShrink = "0"
    },
  ]
  const tokensIn = (svg) => {
    const found = new Map()
    for (const element of elementsOf(svg)) {
      const values = [...element.attributes].flatMap(({ name, value }) =>
        name === "style"
          ? [...element.style].map((property) => [
              property,
              element.style.getPropertyValue(property),
            ])
          : [[name, value]]
      )
      for (const [property, value] of values) {
        for (const [, token] of value.matchAll(/var\((--[\w-]+)/g)) {
          found.set(`${property} ${token}`, { property, token })
        }
      }
    }
    return [...found.values()]
  }

  const layoutParentOf = (element) => {
    let parent = element.parentElement
    while (getComputedStyle(parent).display === "contents") {
      parent = parent.parentElement
    }
    return parent
  }
  const recordLineBox = (svg, path) => {
    const { display } = getComputedStyle(svg)
    const parent = layoutParentOf(svg)
    const isInBlock = ["block", "list-item"].includes(
      getComputedStyle(parent).display
    )
    const sitsInLine =
      display.startsWith("inline") &&
      isInBlock &&
      comparison.bindsSize(svg, "display", "block", [
        parent,
        ...parent.children,
      ])
    if (sitsInLine) {
      record(path, "display", `${display} in a block`)
    }
  }

  const read = (svg, path) => {
    const live = elementsOf(svg)
    const colors = live.map((element) => getComputedStyle(element).color)
    const translating = (changes) => (copy) =>
      translate(copy, changes, (index) => colors[index])
    const heldChanges = (changes) =>
      comparison
        .droppedFromCopies(svg, withFlexShrink(translating(changes)))
        .map(({ element, property, value }) => ({
          index: live.indexOf(element),
          property,
          value,
        }))
        .filter(isHeld)
    // Paper deletes a shape whose own visibility is hidden, so a shape keeps
    // only what it does not inherit from the translated svg.
    const rootChanges = heldChanges([]).filter(({ index }) => index === 0)
    const changes = [
      ...rootChanges,
      ...heldChanges(rootChanges).filter(({ index }) => index > 0),
    ]
    const untranslated = comparison.droppedFromCopies(
      svg,
      withFlexShrink(translating(changes))
    )
    for (const { element, property, value } of untranslated) {
      const at = element === svg ? path : `${path} > ${element.localName}`
      record(at, property, value)
    }
    recordLineBox(svg, path)
    const { width, height } = svg.getBoundingClientRect()
    const { position, zIndex } = getComputedStyle(svg)
    const entry = {
      svg: "",
      path,
      size: { width: round(width), height: round(height) },
      styles: { position: { value: position }, "z-index": { value: zIndex } },
      tokens: [],
      unbound: [],
    }
    pending.push({ entry, element: svg, changes, colors })
    return entry
  }

  const bind = (bindings) => {
    if (pending.length === 0) {
      return
    }
    const roots = pending.map(({ element }) => ({ element, hasText: true }))
    const real = bindings.read(roots)
    const marked = bindings.readMarked(roots, record)
    pending.forEach(({ entry, element, changes, colors }, index) => {
      const bound = (property, value) => {
        if (!(property in real[index])) {
          return value
        }
        const decided = bindings.decide(
          real[index][property],
          marked.map((values) => values[index][property])
        )
        if (decided.unbound) {
          entry.unbound.push({ property, value })
        }
        return decided.value
      }
      const rootColor = /currentcolor/i.test(element.outerHTML)
        ? bound("color", colors[0])
        : colors[0]
      const boundChanges = changes.map((change) =>
        change.index === 0
          ? { ...change, value: bound(change.property, change.value) }
          : change
      )
      const copy = translate(element.cloneNode(true), boundChanges, (at) =>
        colors[at] === colors[0] ? rootColor : colors[at]
      )
      entry.svg = copy.outerHTML
      entry.tokens = tokensIn(copy)
      if (/currentcolor/i.test(entry.svg)) {
        record(entry.path, "color", colors[0])
      }
    })
    pending.length = 0
  }

  // Paper deletes an absolute layer that paints nothing, unless it holds an
  // svg. An absolute svg adds no line box to a layer that sizes to it.
  const keepLayer = (path) => ({
    svg: `<svg width="0" height="0" viewBox="0 0 1 1" style="position: absolute"></svg>`,
    path: `${path} > svg`,
    size: { width: 0, height: 0 },
    styles: { position: { value: "absolute" }, "z-index": { value: "auto" } },
    tokens: [],
    unbound: [],
  })

  return { read, bind, keepLayer }
}

export { createSvgReader }
