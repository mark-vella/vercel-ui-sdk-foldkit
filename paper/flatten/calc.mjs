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

  const read = (element, property) =>
    computedProperties.includes(property)
      ? String(element.computedStyleMap().get(property))
      : getComputedStyle(element).getPropertyValue(property)
  const readWith = (element, property, values) => {
    lengths.forEach(({ name }, index) =>
      frame.style.setProperty(name, `${values[index]}px`)
    )
    return parseFloat(read(element, property))
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

  const solve = (element, property, real) => {
    const authored = element.getAttribute("style")
    element.style.setProperty(
      "font-size",
      getComputedStyle(element).fontSize,
      "important"
    )
    const base = lengths.map(({ value }) => value)
    const nudged = (index, delta) =>
      readWith(element, property, base.with(index, base[index] + delta))
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
      Math.abs(readWith(element, property, mixed) - predicted) < 0.001
    for (const { name } of lengths) {
      frame.style.removeProperty(name)
    }
    if (authored === null) {
      element.removeAttribute("style")
    } else {
      element.setAttribute("style", authored)
    }
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

  const bind = (element, property, decided) => {
    if (!decided.unbound || !/^-?[\d.]+px$/.test(decided.value)) {
      return decided
    }
    return solve(element, property, parseFloat(decided.value)) ?? decided
  }
  return { bind }
}

export { createCalcBinder }
