const createCalcBinder = ({ frame, tokens, computedProperties }) => {
  const probe = frame.appendChild(document.createElement("div"))
  const pxOf = (value) => {
    probe.style.paddingLeft = value
    return parseFloat(getComputedStyle(probe).paddingLeft)
  }
  const lengths = tokens
    .map(({ name }) => ({ name, value: pxOf(`var(${name})`) }))
    .filter(({ name, value }) => pxOf(`calc(var(${name}) + 1px)`) === value + 1)
  probe.remove()

  const read = (element, pseudo, property) =>
    computedProperties.includes(property) && !pseudo
      ? String(element.computedStyleMap().get(property))
      : getComputedStyle(element, pseudo).getPropertyValue(property)
  const readWith = (element, pseudo, property, values) => {
    lengths.forEach(({ name }, index) =>
      frame.style.setProperty(name, `${values[index]}px`)
    )
    return parseFloat(read(element, pseudo, property))
  }
  const pinFontSize = (element, pseudo, property) => {
    const { fontSize } = getComputedStyle(element, pseudo)
    if (!pseudo) {
      const authored = element.getAttribute("style")
      element.style.setProperty("font-size", fontSize, "important")
      return () =>
        authored === null
          ? element.removeAttribute("style")
          : element.setAttribute("style", authored)
    }
    const rule = document.head.appendChild(document.createElement("style"))
    // A pseudo-element out of the layout reads its computed lengths, as an
    // element's computedStyleMap does, not the lengths it was laid out at.
    const unrendered = computedProperties.includes(property)
      ? "display: none !important;"
      : ""
    rule.textContent = `[data-paper-calc]${pseudo} { font-size: ${fontSize} !important; ${unrendered} }`
    element.setAttribute("data-paper-calc", "")
    return () => {
      element.removeAttribute("data-paper-calc")
      rule.remove()
    }
  }
  const round = (number) => Math.round(number * 10000) / 10000
  const format = (terms, constant) => {
    const parts = terms.map(({ name, factor }) =>
      factor === 1 ? `var(${name})` : `var(${name}) * ${factor}`
    )
    if (constant !== 0) {
      parts.push(`${constant}px`)
    }
    const [first, ...rest] = parts
    const joined = rest
      .map((part) =>
        part.startsWith("-") ? ` - ${part.slice(1)}` : ` + ${part}`
      )
      .join("")
    return `calc(${first}${joined})`
  }

  const solve = (element, pseudo, property, real) => {
    const unpin = pinFontSize(element, pseudo, property)
    const base = lengths.map(({ value }) => value)
    const nudged = (index, delta) =>
      readWith(element, pseudo, property, base.with(index, base[index] + delta))
    const slopes = lengths.map((_, index) => [
      nudged(index, 1) - real,
      real - nudged(index, -1),
    ])
    const factors = slopes.map(([up]) => round(up))
    const mixed = base.map((value, index) => value + ((index % 4) - 1.5) / 2)
    const predicted = factors.reduce(
      (sum, factor, index) => sum + factor * (mixed[index] - base[index]),
      real
    )
    const isLinear =
      slopes.every(([up, down]) => Math.abs(up - down) < 0.001) &&
      Math.abs(readWith(element, pseudo, property, mixed) - predicted) < 0.001
    for (const { name } of lengths) {
      frame.style.removeProperty(name)
    }
    unpin()
    const terms = lengths
      .map(({ name }, index) => ({ name, factor: factors[index] }))
      .filter(({ factor }) => factor !== 0)
    if (!isLinear || terms.length === 0) {
      return null
    }
    const constant = round(
      real -
        terms.reduce((sum, { name, factor }) => {
          const { value } = lengths.find((length) => length.name === name)
          return sum + factor * value
        }, 0)
    )
    return {
      value: format(terms, constant),
      tokens: terms.map(({ name }) => name),
    }
  }

  const computedOf = (element, pseudo, property) => {
    const unpin = pinFontSize(element, pseudo, property)
    const value = read(element, pseudo, property)
    lengths.forEach(({ name, value: length }) =>
      frame.style.setProperty(name, `${length + 1}px`)
    )
    const isMoved = read(element, pseudo, property) !== value
    for (const { name } of lengths) {
      frame.style.removeProperty(name)
    }
    unpin()
    return { value, isMoved }
  }
  const isLength = (value) => /^-?[\d.]+px$/.test(value)
  const bind = (element, pseudo, property, decided) => {
    const isLaidOut =
      pseudo &&
      computedProperties.includes(property) &&
      decided.tokens.length === 0
    if (isLaidOut) {
      const { value, isMoved } = computedOf(element, pseudo, property)
      if (!isMoved) {
        return { value, tokens: [] }
      }
      if (!isLength(value)) {
        return decided
      }
      decided = { value, tokens: [], unbound: true }
    }
    if (!decided.unbound || !isLength(decided.value)) {
      return decided
    }
    return (
      solve(element, pseudo, property, parseFloat(decided.value)) ?? decided
    )
  }
  return { bind }
}

export { createCalcBinder }
