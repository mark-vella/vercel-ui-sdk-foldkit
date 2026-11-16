const createControlText = ({ frame, record, widgetInputs }) => {
  const textInputs = ["text", "search", "email", "url", "tel"]
  const fontProperties = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-stretch",
    "letter-spacing",
    "text-transform",
    "font-variant-numeric",
  ]
  const justified = { center: "center", right: "flex-end", end: "flex-end" }
  const lineWidth = (style, text) => {
    const line = frame.appendChild(document.createElement("span"))
    line.style.cssText = "position: absolute; white-space: pre"
    for (const property of fontProperties) {
      line.style.setProperty(property, style.getPropertyValue(property))
    }
    line.textContent = text
    const { width } = line.getBoundingClientRect()
    line.remove()
    return width
  }
  const contentWidth = (node) => {
    const style = getComputedStyle(node)
    return (
      node.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)
    )
  }
  const fitsOneLine = (node, style, text) =>
    lineWidth(style, text) <= contentWidth(node)
  const fitsHeight = (node) => node.scrollHeight <= node.clientHeight

  const readControl = (node, path) => {
    const isInput =
      node.localName === "input" && !widgetInputs.includes(node.type)
    if (!["textarea", "select"].includes(node.localName) && !isInput) {
      return null
    }
    const isTextarea = node.localName === "textarea"
    const { resize } = getComputedStyle(node)
    if (isTextarea && resize !== "none") {
      record(path, "resize", resize)
    }
    const shown = node.value || node.placeholder
    if (!shown) {
      return null
    }
    const textPseudo = node.value ? undefined : "::placeholder"
    const style = getComputedStyle(node, textPseudo)
    const isPlainText = /^\S+( \S+)*$/.test(shown)
    const isTranslated =
      isPlainText &&
      ((isInput &&
        textInputs.includes(node.type) &&
        fitsOneLine(node, style, shown)) ||
        (isTextarea && fitsHeight(node)))
    if (!isTranslated) {
      record(path, "value", shown)
      return null
    }
    const layout = isInput
      ? {
          display: getComputedStyle(node).display.startsWith("inline")
            ? "inline-flex"
            : "flex",
          "align-items": "center",
          "justify-content": justified[style.textAlign] ?? "normal",
        }
      : {}
    return { children: [{ text: shown }], textPseudo, layout }
  }
  return readControl
}

const createPseudoReader = ({ record, paintsNothing }) => {
  const isUnseen = (style) =>
    ["none", "normal"].includes(style.content) ||
    style.display === "none" ||
    (style.content === '""' &&
      ["absolute", "fixed"].includes(style.position) &&
      paintsNothing(style))
  const isSpacer = (style, hostStyle) =>
    style.content === '""' &&
    paintsNothing(style) &&
    style.backdropFilter === "none" &&
    style.float === "none" &&
    ["static", "relative"].includes(style.position) &&
    (!style.display.startsWith("inline") || /flex|grid/.test(hostStyle.display))
  const readPseudos = (node, entry) => {
    const hostStyle = getComputedStyle(node)
    return ["::before", "::after"].map((pseudo) => {
      const style = getComputedStyle(node, pseudo)
      if (isUnseen(style)) {
        return null
      }
      if (!isSpacer(style, hostStyle)) {
        record(entry.path, pseudo, style.content)
        return null
      }
      return {
        element: node,
        pseudo,
        parent: entry,
        name: null,
        kind: "slot",
        path: `${entry.path} > ${pseudo}`,
        hasText: false,
        children: [],
      }
    })
  }
  return readPseudos
}

export { createControlText, createPseudoReader }
