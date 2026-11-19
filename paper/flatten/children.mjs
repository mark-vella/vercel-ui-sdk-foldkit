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
    const isPlainText = /^[^ \t\n\r\f]+( [^ \t\n\r\f]+)*$/.test(shown)
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

const createPseudoReader = ({
  record,
  paintsNothing,
  recordDropped,
  enter,
}) => {
  const isUnseen = (style) =>
    ["none", "normal"].includes(style.content) ||
    style.display === "none" ||
    (style.content === '""' &&
      ["absolute", "fixed"].includes(style.position) &&
      paintsNothing(style))
  const textOf = ({ content }) =>
    /^"[^"\\]*"$/.test(content) ? content.slice(1, -1) : null
  const isTranslated = (node, style, hostStyle) =>
    textOf(style) !== null &&
    !node.shadowRoot &&
    style.float === "none" &&
    (!style.display.startsWith("inline") || /flex|grid/.test(hostStyle.display))
  const recordPainted = (node, pseudo, path, text) => {
    const style = getComputedStyle(node, pseudo)
    const copy = document.createElement("div")
    for (const property of style) {
      if (property !== "content") {
        copy.style.setProperty(
          property,
          style.getPropertyValue(property),
          "important"
        )
      }
    }
    copy.textContent = text
    const hidden = document.head.appendChild(document.createElement("style"))
    hidden.textContent = `[data-paper-pseudo]${pseudo} { display: none !important }`
    node.setAttribute("data-paper-pseudo", "")
    node[pseudo === "::before" ? "prepend" : "append"](copy)
    enter(node)
    recordDropped(copy, path, text !== "")
    copy.remove()
    node.removeAttribute("data-paper-pseudo")
    hidden.remove()
  }
  const readPseudos = (node, entry) => {
    const hostStyle = getComputedStyle(node)
    return ["::before", "::after"].map((pseudo) => {
      const style = getComputedStyle(node, pseudo)
      if (isUnseen(style)) {
        return null
      }
      if (!isTranslated(node, style, hostStyle)) {
        record(entry.path, pseudo, style.content)
        return null
      }
      const text = textOf(style)
        .replace(/[ \t\n\r\f]+/g, " ")
        .replace(/^ | $/g, "")
      const path = `${entry.path} > ${pseudo}`
      recordPainted(node, pseudo, path, text)
      return {
        element: node,
        pseudo,
        parent: entry,
        name: null,
        kind: "slot",
        path,
        hasText: text !== "",
        children: text === "" ? [] : [{ text }],
      }
    })
  }
  return readPseudos
}

export { createControlText, createPseudoReader }
