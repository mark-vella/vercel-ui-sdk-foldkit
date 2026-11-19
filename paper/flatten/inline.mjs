const lineAsBlock = (box, entry, display, fits, toLength) => {
  const toStyle = (declarations) =>
    Object.entries(declarations)
      .map(([property, value]) => `${property}: ${value}`)
      .join(" !important; ")
  const { element } = box
  const rects = element.getClientRects()
  const own = getComputedStyle(element)
  const isAtomic = own.display !== "inline"
  const flow = entry.children.filter(
    (child) =>
      !("element" in child) ||
      !["absolute", "fixed"].includes(
        getComputedStyle(child.element, child.pseudo).position
      )
  )
  const index = flow.indexOf(box)
  const [before, after] = [flow[index - 1], flow[index + 1]]
  const isBlockBeside = (child) =>
    !child ||
    ("element" in child &&
      !child.pseudo &&
      !getComputedStyle(child.element).display.startsWith("inline"))
  const isAlone =
    rects.length === 1 &&
    (isAtomic || element.childElementCount === 0) &&
    isBlockBeside(before) &&
    isBlockBeside(after)
  if (!isAlone) {
    return null
  }
  const outer = getComputedStyle(entry.element)
  const [top, bottom] = ["top", "bottom"].map(
    (side) =>
      parseFloat(own.getPropertyValue(`padding-${side}`)) +
      parseFloat(own.getPropertyValue(`border-${side}-width`))
  )
  const parent = entry.element.getBoundingClientRect()
  const above =
    before?.element.getBoundingClientRect().bottom ??
    parent.top + parseFloat(outer.borderTopWidth) + parseFloat(outer.paddingTop)
  const below =
    after?.element.getBoundingClientRect().top ??
    parent.bottom -
      parseFloat(outer.borderBottomWidth) -
      parseFloat(outer.paddingBottom)
  const [rect] = rects
  const contentArea = rect.height - top - bottom
  const halfLeading =
    isAtomic || own.lineHeight === "normal"
      ? null
      : (parseFloat(own.lineHeight) - contentArea) / 2
  const asMargins = (shrink) => {
    const [marginTop, marginBottom] = [
      rect.top - above - shrink,
      below - rect.bottom - shrink,
    ]
    return marginTop < 0 || marginBottom < 0
      ? null
      : {
          "margin-top": toLength(marginTop),
          "margin-bottom": toLength(marginBottom),
        }
  }
  const margins = asMargins(0)
  const leadingLine = halfLeading === null ? null : asMargins(halfLeading)
  const contentLine =
    margins &&
    (isAtomic ? margins : { "line-height": toLength(contentArea), ...margins })
  const isSized = String(element.computedStyleMap().get("width")) !== "auto"
  const toFit = (line) =>
    toStyle({
      display,
      ...(isSized ? {} : { width: "fit-content" }),
      ...line,
    })
  const asBlock = (line) => ({
    fit: isSized ? undefined : toFit(line),
    layout: line,
  })
  if (leadingLine && fits(toFit(leadingLine), true)) {
    return asBlock(leadingLine)
  }
  if (contentLine && fits(toFit(contentLine), false)) {
    return asBlock(contentLine)
  }
  return null
}

export { lineAsBlock }
