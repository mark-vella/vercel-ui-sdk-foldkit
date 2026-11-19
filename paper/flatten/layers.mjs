const createLayers = ({ frame, tokens, toLength }) => {
  const dependsOnContainer = /^auto$|%|fit-content|stretch/
  const isPlaced = (element, parentElement) => {
    const { position } = getComputedStyle(element)
    return (
      position === "fixed" ||
      (position === "absolute" && element.offsetParent !== parentElement)
    )
  }
  const probe = frame.appendChild(document.createElement("div"))
  const pxOf = (value) => {
    probe.style.paddingLeft = value
    return parseFloat(getComputedStyle(probe).paddingLeft)
  }
  const lengths = tokens
    .map(({ name }) => ({ name, value: pxOf(`var(${name})`) }))
    .filter(({ name, value }) => pxOf(`calc(var(${name}) + 1px)`) === value + 1)
  probe.remove()
  const measure = (element, container, values) => {
    lengths.forEach(({ name }, index) =>
      frame.style.setProperty(name, `${values[index]}px`)
    )
    const box = element.getBoundingClientRect()
    const outer = container.getBoundingClientRect()
    for (const { name } of lengths) {
      frame.style.removeProperty(name)
    }
    return {
      left: box.left - outer.left - container.clientLeft,
      top: box.top - outer.top - container.clientTop,
      width: box.width,
      height: box.height,
    }
  }
  // Paper makes an absolute layer's parent its containing block and drops a
  // margin bound to a token from it, so each inset is the offset measured
  // against every length token.
  const measureInsets = (element, container) => {
    const authored = element.getAttribute("style")
    for (const property of ["transform", "translate", "rotate", "scale"]) {
      element.style.setProperty(property, "none", "important")
    }
    const base = lengths.map(({ value }) => value)
    const real = measure(element, container, base)
    const slopes = lengths.map((_, index) =>
      [1, -1].map((delta) =>
        measure(element, container, base.with(index, base[index] + delta))
      )
    )
    const mixed = base.map((value, index) => value + ((index % 4) - 1.5) / 2)
    const atMixed = measure(element, container, mixed)
    if (authored === null) {
      element.removeAttribute("style")
    } else {
      element.setAttribute("style", authored)
    }
    const insetOn = (side) => {
      const factors = slopes.map(
        ([up]) => Math.round((up[side] - real[side]) * 10000) / 10000
      )
      const predicted = factors.reduce(
        (sum, factor, index) => sum + factor * (mixed[index] - base[index]),
        real[side]
      )
      const isLinear =
        slopes.every(
          ([up, down]) =>
            Math.abs(up[side] - real[side] - (real[side] - down[side])) < 0.001
        ) && Math.abs(atMixed[side] - predicted) < 0.001
      const terms = lengths
        .map(({ name, value }, index) => ({
          name,
          value,
          factor: factors[index],
        }))
        .filter(({ factor }) => factor !== 0)
      if (terms.length === 0 && isLinear) {
        return { value: toLength(real[side]), tokens: [], unbound: false }
      }
      const [term] = terms
      if (terms.length > 1 || !isLinear || Math.abs(term.factor) !== 1) {
        return { value: toLength(real[side]), tokens: [], unbound: true }
      }
      const constant = real[side] - term.factor * term.value
      const sign = constant < 0 ? "-" : "+"
      const variable =
        term.factor === 1 ? `var(${term.name})` : `var(${term.name}) * -1`
      return {
        value:
          constant === 0
            ? `calc(${variable})`
            : `calc(${variable} ${sign} ${toLength(Math.abs(constant))})`,
        tokens: [term.name],
        unbound: false,
      }
    }
    return { left: insetOn("left"), top: insetOn("top"), size: real }
  }
  const placeAgainstParent = ({ element, styles, parent }) => {
    const insets = measureInsets(element, parent.element)
    styles.position = { value: "absolute", tokens: [] }
    for (const [side, opposite] of [
      ["left", "right"],
      ["top", "bottom"],
    ]) {
      const inset = insets[side]
      styles[side] = {
        ...inset,
        unbound:
          inset.unbound ||
          [side, opposite].some((name) =>
            styles[name].tokens.some((token) => !inset.tokens.includes(token))
          ),
      }
      styles[opposite] = { value: "auto", tokens: [] }
    }
    for (const side of ["left", "top", "right", "bottom"]) {
      styles[`margin-${side}`] = { value: "0px", tokens: [] }
    }
    for (const [property, length] of [
      ["width", insets.size.width],
      ["height", insets.size.height],
    ]) {
      if (dependsOnContainer.test(styles[property].value)) {
        styles[property] = { value: toLength(length), tokens: [] }
      }
    }
    parent.holdsPlaced = true
  }
  const isStatic = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo)
    return (
      style.position === "static" ||
      (pseudo && ["none", "normal"].includes(style.content))
    )
  }
  const hasGutter = (element) => {
    const style = getComputedStyle(element)
    const borders = (start, end) =>
      parseFloat(style[start]) + parseFloat(style[end])
    return (
      element.offsetWidth - element.clientWidth !==
        borders("borderLeftWidth", "borderRightWidth") ||
      element.offsetHeight - element.clientHeight !==
        borders("borderTopWidth", "borderBottomWidth")
    )
  }
  const isScrolledAside = (element) =>
    (element.scrollLeft !== 0 || element.scrollTop !== 0) &&
    !hasGutter(element) &&
    ["::before", "::after"].every((pseudo) => isStatic(element, pseudo)) &&
    [...element.childNodes].every((child) =>
      child.nodeType === Node.ELEMENT_NODE
        ? child.localName !== "svg" &&
          getComputedStyle(child).display !== "contents" &&
          isStatic(child)
        : !child.data.trim()
    )
  const scrollAside = ({ element, styles, children }) => {
    for (const property of ["overflow-x", "overflow-y"]) {
      styles[property] = { value: "clip", tokens: [] }
    }
    for (const property of ["min-width", "min-height"]) {
      if (styles[property].value === "auto") {
        styles[property] = { value: "0px", tokens: [] }
      }
    }
    for (const child of children) {
      child.styles.position = { value: "relative", tokens: [] }
      child.styles.left = { value: toLength(-element.scrollLeft), tokens: [] }
      child.styles.top = { value: toLength(-element.scrollTop), tokens: [] }
    }
  }
  const scrolls = ({ styles }) =>
    ["overflow-x", "overflow-y"].some((property) =>
      ["hidden", "auto", "scroll"].includes(styles[property].value)
    )
  const place = (entry) => {
    const { element, styles, parent } = entry
    if (!entry.pseudo && scrolls(entry) && isScrolledAside(element)) {
      scrollAside(entry)
    }
    if (entry.holdsPlaced && styles.position.value === "static") {
      styles.position = { value: "relative", tokens: [] }
      for (const side of ["top", "right", "bottom", "left"]) {
        styles[side] = { value: "auto", tokens: [] }
      }
    }
    if (!entry.pseudo && parent && isPlaced(element, parent.element)) {
      placeAgainstParent(entry)
    }
    // Paper deletes a text layer that clips its overflow and does not wrap.
    // Under inset(50%) nothing paints either way.
    if (!entry.pseudo && getComputedStyle(element).clipPath === "inset(50%)") {
      entry.clipPath = "inset(50%)"
      for (const property of ["overflow-x", "overflow-y"]) {
        styles[property] = { value: "visible", tokens: [] }
      }
    }
  }
  return { place, isScrolledAside }
}

const toLayerDeclarations = ({ clipPath }) =>
  clipPath
    ? [{ property: "clip-path", value: clipPath, tokens: [], isUnbound: false }]
    : []

export { createLayers, toLayerDeclarations }
