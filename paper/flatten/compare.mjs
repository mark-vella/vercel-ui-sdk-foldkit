const createComparison = ({
  compared,
  insets,
  harmlessSources,
  tagDefaults,
  sizeConstraints: constraints,
}) => {
  const harmlessValues = new Map(
    harmlessSources.map(([property, source]) => [property, new RegExp(source)])
  )
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
  const bindsSize = (node, property, value, measured = [node]) => {
    const sizes = () =>
      measured
        .map((element) => {
          const { width, height } = element.getBoundingClientRect()
          return `${width}x${height}`
        })
        .join()
    const before = sizes()
    const authored = node.getAttribute("style")
    // Chromium writes CSSOM edits back to the attribute lazily, which leaves
    // style="" in an svg's outerHTML after removeAttribute.
    node.setAttribute(
      "style",
      `${authored ?? ""}; ${property}: ${value} !important`
    )
    const after = sizes()
    if (authored === null) {
      node.removeAttribute("style")
    } else {
      node.setAttribute("style", authored)
    }
    return before !== after
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
  return {
    shadow,
    reference,
    enter,
    bindsSize,
    dropped,
    remove: () => host.remove(),
  }
}

export { createComparison }
