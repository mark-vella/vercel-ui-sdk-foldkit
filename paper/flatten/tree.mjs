const readTree = ({
  frame,
  record,
  markerOf,
  enter,
  readSvg,
  recordDropped,
  recordAbsolute,
  recordInlineBoxes,
}) => {
  const elements = []
  const visit = (node, parent) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.data.replace(/\s+/g, " ")
      return text.trim() ? [{ text }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return []
    }
    const style = getComputedStyle(node)
    const { display } = style
    if (display === "none") {
      return []
    }
    if (display === "contents") {
      return [...node.childNodes].flatMap((child) => visit(child, parent))
    }
    const contextElement = parent?.element ?? frame.parentElement
    if (node.localName === "svg") {
      enter(contextElement)
      return [readSvg(node, `${parent.path} > svg`)]
    }
    const name = node.dataset.paperLayer ?? node.dataset.slot ?? null
    const path = parent ? `${parent.path} > ${name ?? node.localName}` : name
    const kind =
      node === frame ? "frame" : node.dataset.paperLayer ? "chrome" : "slot"
    const entry = { element: node, parent, name, kind, path }
    const children = [...node.childNodes].flatMap((child) =>
      visit(child, entry)
    )
    if (children.length === 1 && "text" in children[0]) {
      children[0].text = children[0].text.trim()
    }
    const hasText = children.some((child) => "text" in child)
    const hasElements = children.some((child) => !("text" in child))
    if (hasText && hasElements) {
      record(path, "children", "text and elements")
    }
    const isBlockFlow =
      display === "block" || (display === "list-item" && !markerOf(style))
    const hasSupportedLayout =
      isBlockFlow || /^(inline-)?(flex|grid)$/.test(display)
    if (hasElements && !hasSupportedLayout) {
      record(path, "display", display)
    }
    if (isBlockFlow) {
      recordInlineBoxes(node, children)
    }
    enter(contextElement)
    recordDropped(node, path, hasText)
    if (style.position === "absolute") {
      recordAbsolute(node, path, children, contextElement)
    }
    Object.assign(entry, { hasText, children })
    elements.push(entry)
    return [entry]
  }
  const [tree] = visit(frame, null)
  return { tree, elements }
}

export { readTree }
