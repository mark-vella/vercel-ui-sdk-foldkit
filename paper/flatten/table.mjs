const createTables = ({ frame, tokens, toPaperLength }) => {
  const groups = ["table-header-group", "table-row-group"]
  const translated = []
  const displayOf = (element) => getComputedStyle(element).display
  const shown = (element) =>
    [...element.children].flatMap((child) => {
      const display = displayOf(child)
      if (display === "none") {
        return []
      }
      return display === "contents" ? shown(child) : [child]
    })
  const structureOf = (table) => {
    const parts = shown(table)
    const rows = parts.flatMap((part) =>
      groups.includes(displayOf(part)) ? shown(part) : [part]
    )
    const cells = rows.flatMap(shown)
    const isTable =
      rows.every((row) => displayOf(row) === "table-row") &&
      cells.every((cell) => displayOf(cell) === "table-cell")
    return isTable ? { parts, rows, cells } : null
  }
  const restoreStyle = ({ element, authored }) => {
    if (authored === null) {
      element.removeAttribute("style")
    } else {
      element.setAttribute("style", authored)
    }
  }
  const apply = (forms) =>
    forms.map(([element, declaration]) => {
      const authored = element.getAttribute("style")
      const important = declaration.replaceAll(";", " !important;")
      element.setAttribute(
        "style",
        `${authored ?? ""}; ${important} !important`
      )
      return { element, authored }
    })
  const withAncestors = (element) =>
    element === frame
      ? [frame]
      : [element, ...withAncestors(element.parentElement)]
  const dependsOnTokens = (elements, read) => {
    const before = read()
    const override = tokens.map(({ name }) => `${name}: 9999px`).join("; ")
    const changes = apply(elements.map((element) => [element, override]))
    const after = read()
    changes.forEach(restoreStyle)
    return before !== after
  }
  const usedWidth = (element) =>
    toPaperLength(element.getBoundingClientRect().width)
  const pinWidths = (cells, widths) => {
    const changed = cells.flatMap((cell, index) =>
      usedWidth(cell) === widths[index] ? [] : [[cell, widths[index]]]
    )
    const isTokenWidth = changed.some(([cell]) =>
      dependsOnTokens(withAncestors(cell), () =>
        String(cell.computedStyleMap().get("width"))
      )
    )
    return isTokenWidth
      ? []
      : apply(
          changed.map(([cell, width]) => [
            cell,
            `flex-shrink: 0; box-sizing: border-box; width: ${width}`,
          ])
        )
  }
  const formsOf = (table, { parts, rows, cells }) => {
    const style = getComputedStyle(table)
    const [across, down] = ["horizontal", "vertical"].map((axis) =>
      style.getPropertyValue(`-webkit-border-${axis}-spacing`)
    )
    const spaced = [
      ["top", down],
      ["right", across],
      ["bottom", down],
      ["left", across],
    ].filter(([, spacing]) => spacing !== "0px")
    const gap = (axis, length) =>
      length === "0px" ? "" : `; ${axis}-gap: ${length}`
    const column = `flex-direction: column${gap("row", down)}`
    const display = style.display === "inline-table" ? "inline-flex" : "flex"
    const padding = spaced.map(
      ([side, spacing]) => `; padding-${side}: ${spacing}`
    )
    const isAutoWidth = String(table.computedStyleMap().get("width")) === "auto"
    const width = isAutoWidth ? "; width: fit-content" : ""
    return [
      [
        table,
        `display: ${display}; ${column}${padding.join("")}${width}; border-spacing: inherit`,
      ],
      ...parts
        .filter((part) => !rows.includes(part))
        .map((part) => [part, `display: flex; ${column}`]),
      ...rows.map((row) => [row, `display: flex${gap("column", across)}`]),
      ...cells.map((cell) => [cell, "display: block"]),
    ]
  }
  const boxes = (table) => {
    const range = document.createRange()
    range.selectNodeContents(table)
    return [
      ...[...table.parentElement.children, ...table.querySelectorAll("*")].map(
        (element) => element.getBoundingClientRect()
      ),
      ...range.getClientRects(),
    ]
      .map(({ x, y, width, height }) => `${x},${y} ${width}x${height}`)
      .join()
  }
  const translate = () => {
    const tables = [...frame.querySelectorAll("*")].filter((element) =>
      ["table", "inline-table"].includes(displayOf(element))
    )
    for (const table of tables) {
      const structure = structureOf(table)
      const spacing = () => getComputedStyle(table).borderSpacing
      const forms =
        structure &&
        !dependsOnTokens(withAncestors(table), spacing) &&
        formsOf(table, structure)
      if (!forms) {
        continue
      }
      const before = boxes(table)
      const widths = structure.cells.map(usedWidth)
      const changes = apply(forms)
      changes.push(...pinWidths(structure.cells, widths))
      if (boxes(table) === before) {
        translated.push(...changes)
      } else {
        changes.reverse().forEach(restoreStyle)
      }
    }
  }
  const restore = () => translated.reverse().forEach(restoreStyle)
  return { translate, restore }
}

export { createTables }
