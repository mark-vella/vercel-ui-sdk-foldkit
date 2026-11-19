const createLayout = ({ comparison }) => {
  const dropInheritedDirection = ({ styles }, parent) => {
    if (styles.direction.value === getComputedStyle(parent).direction) {
      delete styles.direction
    }
  }
  const rectOf = ({ element, pseudo, fit }) => {
    const style = getComputedStyle(element)
    const isUnseenScale =
      !pseudo && style.opacity === "0" && style.scale !== "none"
    const declaration = [fit, isUnseenScale && "scale: none"]
      .filter(Boolean)
      .join(" !important; ")
    const measure = () => element.getBoundingClientRect()
    return declaration
      ? comparison.withStyle(element, declaration, measure)
      : measure()
  }
  const isAtRest = (element) => {
    const style = getComputedStyle(element)
    const gutter = (size, client, start, end) =>
      element[size] -
      element[client] -
      parseFloat(style[start]) -
      parseFloat(style[end])
    return (
      element.scrollTop === 0 &&
      element.scrollLeft === 0 &&
      gutter(
        "offsetWidth",
        "clientWidth",
        "borderLeftWidth",
        "borderRightWidth"
      ) === 0 &&
      gutter(
        "offsetHeight",
        "clientHeight",
        "borderTopWidth",
        "borderBottomWidth"
      ) === 0
    )
  }
  // Paper stores a scroll container as a clip with no automatic minimum size.
  const pinScroll = ({ element, styles }) => {
    const sides = [styles["overflow-x"], styles["overflow-y"]]
    const scrolls = sides.filter(({ value }) =>
      ["hidden", "auto", "scroll"].includes(value)
    )
    if (scrolls.length === 0 || !isAtRest(element)) {
      return
    }
    for (const side of scrolls) {
      side.value = "clip"
    }
    for (const property of ["min-width", "min-height"]) {
      if (styles[property].value === "auto") {
        styles[property] = { value: "0px", tokens: [] }
      }
    }
  }
  const boxSizes = {
    width: ["width", "min-width", "max-width"],
    height: ["height", "min-height", "max-height"],
  }
  const edgeProperties = (axis) => {
    const [start, end] =
      axis === "width" ? ["left", "right"] : ["top", "bottom"]
    return [start, end].flatMap((side) => [
      `padding-${side}`,
      `border-${side}-width`,
    ])
  }
  const edgesOf = (style, axis) =>
    edgeProperties(axis).reduce(
      (sum, property) => sum + parseFloat(style.getPropertyValue(property)),
      0
    )
  const withoutCalc = (value) => value.replace(/^calc\((.*)\)$/, "$1")
  const asTerm = (value) =>
    withoutCalc(value).includes(" ") ? `(${withoutCalc(value)})` : value
  const isLength = (value) => value.endsWith("px")
  const holdsContentBox = (node) => {
    const computed = node.computedStyleMap()
    return Object.values(boxSizes)
      .flat()
      .every((property) => {
        const value = String(computed.get(property))
        return isLength(value) || /^[a-z-]+$/.test(value)
      })
  }
  const pinBorderBox = ({ element, pseudo, path, styles }, record) => {
    const style = getComputedStyle(element, pseudo)
    if (style.boxSizing !== "content-box") {
      return
    }
    let isTokenFolded = false
    for (const [axis, properties] of Object.entries(boxSizes)) {
      const edges = edgesOf(style, axis)
      const hasTokenEdge = edgeProperties(axis).some(
        (property) => styles[property].tokens.length > 0
      )
      for (const property of properties) {
        const { value, tokens } = styles[property]
        if (edges === 0 || (tokens.length === 0 && !isLength(value))) {
          continue
        }
        isTokenFolded ||= hasTokenEdge
        styles[property] =
          tokens.length === 0
            ? {
                value: `${Math.round((parseFloat(value) + edges) * 1000) / 1000}px`,
                tokens,
              }
            : {
                value: `calc(${withoutCalc(value)} + ${edges}px)`,
                tokens,
              }
      }
    }
    if (isTokenFolded) {
      record(path, "box-sizing", "content-box")
    }
  }
  const pinContain = ({ element, styles }) => {
    if (comparison.isContained(element)) {
      styles.width = { value: "0px", tokens: [] }
      styles["min-width"] = { value: "100%", tokens: [] }
    }
  }
  const legends = []
  const pinLegend = (entry) => {
    const fieldset = entry.element.parentElement
    const fit =
      fieldset?.localName === "fieldset" &&
      fieldset.querySelector(":scope > legend") === entry.element &&
      comparison.legendFitOf(fieldset)
    if (fit) {
      entry.styles.width = { value: "fit-content", tokens: [] }
      if (fit.gap) {
        legends.push([entry, entry.parent])
      }
    }
  }
  const pinLegendMargins = () => {
    for (const [legend, fieldset] of legends) {
      const margin = legend.styles["margin-bottom"]
      const gap = fieldset.styles["row-gap"]
      const isCancelled = margin.value === gap.value
      const tokens = isCancelled
        ? []
        : [...new Set([...margin.tokens, ...gap.tokens])]
      legend.styles["margin-bottom"] = isCancelled
        ? { value: "0px", tokens }
        : tokens.length === 0
          ? {
              value: `${parseFloat(margin.value) - parseFloat(gap.value)}px`,
              tokens,
            }
          : {
              value: `calc(${withoutCalc(margin.value)} - ${asTerm(gap.value)})`,
              tokens,
            }
    }
  }
  const ownSizes = new Map()
  const holdsOwnSize = (node, display, changed) => {
    const sizes = comparison.ownSize(node, display, changed)
    if (sizes) {
      ownSizes.set(node, sizes)
    }
    return Boolean(sizes)
  }
  const pinOwnSize = ({ element, styles }) => {
    for (const [property, value] of Object.entries(
      ownSizes.get(element) ?? {}
    )) {
      styles[property] = { value, tokens: [] }
    }
  }
  const pinBox = (entry, record) => {
    pinBorderBox(entry, record)
    if (!entry.pseudo) {
      pinContain(entry)
      pinLegend(entry)
      pinOwnSize(entry)
    }
  }
  return {
    dropInheritedDirection,
    rectOf,
    isAtRest,
    pinScroll,
    holdsContentBox,
    holdsOwnSize,
    pinBox,
    pinLegendMargins,
  }
}

export { createLayout }
