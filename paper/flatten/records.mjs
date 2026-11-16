const createRecords = ({
  record,
  isAtRest,
  emitted,
  insets,
  movesOrTurnsSource,
  backgroundLonghands,
  isHeldBackground,
  rewrittenGradientSpaces,
  markerOf,
  replacedElements,
  widgets,
  widgetInputs,
  comparison,
  keepLayer,
}) => {
  const movesOrTurns = new RegExp(movesOrTurnsSource)
  const emittedDisplay = (display) => {
    const layout = display.replace(/^inline-/, "")
    return ["flex", "grid"].includes(layout) ? layout : "block"
  }
  const scrolls = (node, property) => {
    const value = getComputedStyle(node).getPropertyValue(property)
    const overflows =
      property === "overflow-x"
        ? node.scrollWidth > node.clientWidth
        : node.scrollHeight > node.clientHeight
    return value === "scroll" || (value === "auto" && overflows)
  }
  const isEmittedBy = (hasText) => (property, style, node) => {
    if (!emitted.has(property)) {
      return false
    }
    if (
      property.startsWith("text-decoration-") ||
      property === "text-underline-offset"
    ) {
      // text-decoration-line does not inherit: it paints across the text
      // inside, which never carries it.
      return hasText
    }
    if (property === "position" || insets.includes(property)) {
      return style.position !== "fixed"
    }
    if (property === "overflow-x" || property === "overflow-y") {
      return !scrolls(node, property) || isAtRest(node)
    }
    if (property === "transform") {
      return movesOrTurns.test(node.computedStyleMap().get(property))
    }
    if (backgroundLonghands.includes(property)) {
      return isHeldBackground(style)
    }
    return true
  }
  const recordDropped = (node, path, hasText) => {
    for (const [property, value] of comparison.dropped(
      node,
      isEmittedBy(hasText)
    )) {
      record(path, property, value)
    }
    const style = getComputedStyle(node)
    const rewrittenSpaces = rewrittenGradientSpaces(style)
    if (rewrittenSpaces.length > 0 && isHeldBackground(style)) {
      record(path, "gradient", `in ${rewrittenSpaces.join(", in ")}`)
    }
    const marker = markerOf(style)
    if (marker) {
      record(path, "::marker", marker)
    }
    const isSizedAsContentBox =
      style.boxSizing === "content-box" &&
      comparison.bindsSize(node, "box-sizing", "border-box")
    if (isSizedAsContentBox) {
      record(path, "box-sizing", "content-box")
    }
    const isWidgetInput =
      node.localName === "input" && widgetInputs.includes(node.type)
    const drawsItself =
      replacedElements.includes(node.localName) ||
      ((isWidgetInput || widgets.includes(node.localName)) &&
        style.appearance !== "none")
    // A fieldset lays its first legend out apart from its other children, at
    // the legend's own width.
    const isRenderedLegend =
      node.parentElement?.localName === "fieldset" &&
      node === node.parentElement.querySelector(":scope > legend")
    if (drawsItself || isRenderedLegend) {
      const element = isWidgetInput ? `input type=${node.type}` : node.localName
      record(path, "element", element)
    } else if (node.localName !== "div") {
      const { width, height } = comparison.resizesAsDiv(
        node,
        emittedDisplay(style.display)
      )
      const change = width && height ? "size" : width ? "width" : "height"
      if (width || height) {
        record(path, "element", `${node.localName} ${change}`)
      }
    }
    const isBlocked =
      /^https?:/.test(node.currentSrc) &&
      !node.currentSrc.startsWith(`${document.location.origin}/`)
    if (isBlocked) {
      record(path, "blocked request", node.currentSrc)
    }
  }
  const paintsNothing = (style) =>
    style.backgroundColor === "rgba(0, 0, 0, 0)" &&
    style.backgroundImage === "none" &&
    style.boxShadow === "none" &&
    style.outlineStyle === "none" &&
    ["top", "right", "bottom", "left"].every(
      (side) =>
        style.getPropertyValue(`border-${side}-style`) === "none" ||
        parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0
    )
  const recordAbsolute = (node, path, children, contextElement) => {
    const { offsetParent } = node
    if (offsetParent !== contextElement) {
      record(
        path,
        "containing block",
        offsetParent?.dataset.slot ?? offsetParent?.localName ?? "viewport"
      )
    }
    const style = getComputedStyle(node)
    // Paper deletes an absolute layer at no opacity, whatever it holds.
    if (style.opacity === "0") {
      record(path, "empty layer", "opacity 0")
    } else if (children.length === 0 && paintsNothing(style)) {
      children.push(keepLayer(path))
    }
  }
  const sizesOf = (elements) =>
    elements
      .map((element) => {
        const { width, height } = element.getBoundingClientRect()
        return `${width}x${height}`
      })
      .join()
  const elementsOf = (children) =>
    children.filter((child) => "element" in child).map(({ element }) => element)
  const isSeen = ({ element, name }) =>
    name !== null || !paintsNothing(getComputedStyle(element))
  const laysOutApart = (entry, display, measured) =>
    comparison.bindsSize(entry.element, "display", emittedDisplay(display), [
      ...measured,
      ...(isSeen(entry) ? [entry.element] : []),
      ...elementsOf(entry.children),
    ])
  const recordDisplay = (entry, display, parent) => {
    if (
      !display.startsWith("inline") ||
      laysOutApart(entry, display, [parent])
    ) {
      record(entry.path, "display", display)
    }
  }
  const recordInlineBoxes = (entry, parent) => {
    const boxes = entry.children.filter((child) => "element" in child)
    const container = [parent, entry.element]
    const recordBoxes = () => {
      for (const box of boxes) {
        const { display } = getComputedStyle(box.element)
        const others = elementsOf(boxes.filter((other) => other !== box))
        if (
          !display.startsWith("inline") ||
          !laysOutApart(box, display, [...container, ...others])
        ) {
          continue
        }
        const fit = `display: ${emittedDisplay(display)}; width: fit-content`
        const measured = [...container, ...others, ...elementsOf(box.children)]
        const isFitted =
          sizesOf(measured) ===
          comparison.withStyle(box.element, fit, () => sizesOf(measured))
        if (isFitted) {
          box.fit = fit
        } else {
          record(box.path, "display", `${display} in a block`)
        }
      }
    }
    if (emittedDisplay(getComputedStyle(entry.element).display) === "block") {
      comparison.withStyle(entry.element, "display: block", recordBoxes)
    }
  }
  const flexAlignments = ["normal", "stretch", "center", "start", "end"]
  const textBoxes = (element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return [...range.getClientRects(), element.getBoundingClientRect()]
      .map(({ x, y, width, height }) => `${x},${y} ${width}x${height}`)
      .join()
  }
  // Paper drops display: grid from a node that holds only text.
  const recordTextGrid = (entry) => {
    const { display, justifyItems, alignItems } = getComputedStyle(
      entry.element
    )
    const flex = {
      display: display.replace("grid", "flex"),
      "justify-content": justifyItems,
      "align-items": alignItems,
    }
    const block = { display: display.replace("grid", "block") }
    const isFlexAligned =
      flexAlignments.includes(justifyItems) &&
      flexAlignments.includes(alignItems)
    const before = textBoxes(entry.element)
    const layout = [...(isFlexAligned ? [flex] : []), block].find(
      (candidate) => {
        const declaration = Object.entries(candidate)
          .map(([property, value]) => `${property}: ${value}`)
          .join(" !important; ")
        return (
          before ===
          comparison.withStyle(entry.element, declaration, () =>
            textBoxes(entry.element)
          )
        )
      }
    )
    if (layout) {
      entry.layout = layout
    } else {
      record(entry.path, "display", `${display} with only text`)
    }
  }
  return {
    recordDropped,
    recordAbsolute,
    recordDisplay,
    recordInlineBoxes,
    recordTextGrid,
    paintsNothing,
  }
}

export { createRecords }
