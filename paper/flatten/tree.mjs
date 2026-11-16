const readTree = ({
  frame,
  record,
  markerOf,
  enter,
  readSvg,
  readControl,
  readPseudos,
  recordDropped,
  recordAbsolute,
  recordDisplay,
  recordInlineBoxes,
  recordTextGrid,
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
    const control = readControl(node, path)
    const entry = {
      element: node,
      parent,
      name,
      kind,
      path,
      textPseudo: control?.textPseudo,
      layout: control?.layout,
    }
    const [before, after] = readPseudos(node, entry)
    const pseudos = [before, after].filter(Boolean)
    const children = [
      before,
      ...(control?.children ??
        [...node.childNodes].flatMap((child) => visit(child, entry))),
      after,
    ].filter(Boolean)
    if (children.length === 1 && "text" in children[0]) {
      children[0].text = children[0].text.trim()
    }
    const hasText = children.some((child) => "text" in child)
    const hasElements = children.some((child) => !("text" in child))
    const isBlockFlow =
      display === "block" || (display === "list-item" && !markerOf(style))
    const isFlexOrGrid = /^(inline-)?(flex|grid)$/.test(display)
    const isOwnBlock = (child) =>
      "text" in child ||
      ("element" in child &&
        !getComputedStyle(child.element, child.pseudo).display.startsWith(
          "inline"
        ))
    const holdsTextApart =
      style.whiteSpaceCollapse === "collapse" &&
      (isFlexOrGrid || (isBlockFlow && hasText && children.every(isOwnBlock)))
    if (hasText && hasElements && !holdsTextApart) {
      record(path, "children", "text and elements")
    }
    const hasSupportedLayout = isBlockFlow || isFlexOrGrid
    if (hasElements && !hasSupportedLayout) {
      recordDisplay({ ...entry, children }, display, contextElement)
    }
    recordInlineBoxes({ ...entry, children }, contextElement)
    if (hasText && !hasElements && /grid$/.test(display)) {
      recordTextGrid(entry)
    }
    enter(contextElement)
    recordDropped(node, path, hasText)
    if (style.position === "absolute") {
      recordAbsolute(node, path, children, contextElement)
    }
    Object.assign(entry, { hasText, children })
    elements.push(entry, ...pseudos)
    return [entry]
  }
  const [tree] = visit(frame, null)
  return { tree, elements }
}

export { readTree }
