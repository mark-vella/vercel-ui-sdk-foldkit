const createRecords = ({
  record,
  emitted,
  insets,
  movesOrTurnsSource,
  backgroundLonghands,
  isHeldBackground,
  markerOf,
  replacedElements,
  widgets,
  widgetInputs,
  comparison,
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
      return !scrolls(node, property)
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
    for (const pseudo of ["::before", "::after"]) {
      const { content } = getComputedStyle(node, pseudo)
      if (content !== "none" && content !== "normal") {
        record(path, pseudo, content)
      }
    }
    const style = getComputedStyle(node)
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
    const value = node.value || node.placeholder
    const showsValue =
      ["input", "textarea", "select"].includes(node.localName) && !isWidgetInput
    if (showsValue && value) {
      record(path, "value", value)
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
    if (children.length === 0 && paintsNothing(getComputedStyle(node))) {
      record(path, "empty layer", "absolute")
    }
  }
  const recordInlineBoxes = (node, children) => {
    const boxes = children.filter((child) => "element" in child)
    const measured = [node, ...boxes.map(({ element }) => element)]
    for (const { element, path } of boxes) {
      const { display } = getComputedStyle(element)
      const isLaidOutApart =
        display.startsWith("inline") &&
        comparison.bindsSize(
          element,
          "display",
          emittedDisplay(display),
          measured
        )
      if (isLaidOutApart) {
        record(path, "display", `${display} in a block`)
      }
    }
  }
  return { recordDropped, recordAbsolute, recordInlineBoxes }
}

export { createRecords }
