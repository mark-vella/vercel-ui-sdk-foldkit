const createBindings = ({
  frame,
  tokens,
  serialize,
  boxProperties,
  textProperties,
  computedProperties,
}) => {
  const lengthBases = [9000, 8000]
  const sentinelFor = ({ type }, index, pass) => {
    if (type === "color") {
      return ["color", `rgb(1 ${pass + 1} ${index * pass})`]
    }
    if (type === "fontFamily") {
      return ["font-family", `"paper-sentinel-${pass}-${index}"`]
    }
    return ["padding-left", `${lengthBases[pass - 1] + index * pass}px`]
  }
  const [first, second] = [1, 2].map((pass) =>
    tokens.map((token, index) => {
      const [property, value] = sentinelFor(token, index, pass)
      return {
        name: token.name,
        value,
        serialized: serialize(property, value),
      }
    })
  )
  const resolver = frame.appendChild(document.createElement("div"))
  const resolvedTokens = new Map(
    tokens.map((token, index) => {
      const [property] = sentinelFor(token, index, 1)
      resolver.style.setProperty(property, `var(${token.name})`)
      return [token.name, getComputedStyle(resolver).getPropertyValue(property)]
    })
  )
  resolver.remove()
  const [firstNames, secondNames] = [first, second].map(
    (sentinels) =>
      new Map(sentinels.map(({ name, serialized }) => [serialized, name]))
  )
  const read = (elements) =>
    elements.map(({ element, hasText }) => {
      const style = getComputedStyle(element)
      const properties = hasText
        ? [...boxProperties, ...textProperties]
        : boxProperties
      const computed = element.computedStyleMap()
      return Object.fromEntries(
        properties.map((property) => [
          property,
          computedProperties.includes(property)
            ? String(computed.get(property))
            : style.getPropertyValue(property),
        ])
      )
    })
  const tokenValues = (element) => {
    const style = getComputedStyle(element)
    return tokens.map(({ name }) => style.getPropertyValue(name))
  }
  const readWithSentinels = (elements, sentinels, inspect) => {
    for (const { name, value } of sentinels) {
      frame.style.setProperty(name, value)
    }
    const values = read(elements)
    inspect?.()
    for (const { name } of sentinels) {
      frame.style.removeProperty(name)
    }
    return values
  }
  const readDirectTokenUses = (elements, sentinels) => {
    const pinned = elements.map(({ element }) => ({
      element,
      authored: element.getAttribute("style"),
      fontSize: getComputedStyle(element).fontSize,
    }))
    for (const { element, fontSize } of pinned) {
      element.style.setProperty("font-size", fontSize, "important")
    }
    const values = readWithSentinels(elements, sentinels)
    for (const { element, authored } of pinned) {
      if (authored === null) {
        element.removeAttribute("style")
      } else {
        element.setAttribute("style", authored)
      }
    }
    return values
  }
  const recordRedeclared = (elements, record) => {
    for (const { element, parent, path } of elements) {
      if (!parent) {
        continue
      }
      const [values, inherited] = [element, parent.element].map(tokenValues)
      const redeclared = tokens
        .filter((_, index) => values[index] !== inherited[index])
        .map(({ name }) => name)
      if (redeclared.length > 0) {
        record(path, "tokens", redeclared.join(" "))
      }
    }
  }
  const readMarked = (elements, record) => [
    readWithSentinels(elements, first, () =>
      recordRedeclared(elements, record)
    ),
    readWithSentinels(elements, second),
    readDirectTokenUses(elements, first),
  ]
  const splitParts = (value) => {
    const parts = []
    let current = ""
    let depth = 0
    let isQuoted = false
    for (const character of value) {
      if (character === '"') {
        isQuoted = !isQuoted
      }
      if (depth === 0 && !isQuoted && /[\s,]/.test(character)) {
        if (current) {
          parts.push(current)
        }
        if (character === ",") {
          parts.push(",")
        }
        current = ""
        continue
      }
      if (character === "(") {
        depth++
      }
      if (character === ")") {
        depth--
      }
      current += character
    }
    return current ? [...parts, current] : parts
  }
  const joinParts = (parts) => parts.join(" ").replaceAll(" ,", ",")

  const decide = (real, [markedFirst, markedSecond, markedDirect]) => {
    if (real === markedFirst && real === markedSecond) {
      return { value: real, tokens: [] }
    }
    const [realParts, firstParts, secondParts, directParts] = [
      real,
      markedFirst,
      markedSecond,
      markedDirect,
    ].map(splitParts)
    const boundAt = (index, realPart) => {
      const name = firstNames.get(firstParts[index])
      const isBound =
        name &&
        secondNames.get(secondParts[index]) === name &&
        resolvedTokens.get(name) === realPart
      return isBound ? name : null
    }
    const isAligned =
      realParts.length === firstParts.length &&
      secondParts.length === firstParts.length
    if (!isAligned) {
      const name = firstParts.length === 1 && boundAt(0, real)
      return name
        ? { value: `var(${name})`, tokens: [name] }
        : {
            value: real,
            tokens: [],
            unbound: markedDirect !== real,
          }
    }
    const found = []
    let unbound = false
    const parts = realParts.map((part, index) => {
      const name = boundAt(index, part)
      if (name) {
        found.push(name)
        return `var(${name})`
      }
      const dependsOnToken =
        firstParts[index] !== part || secondParts[index] !== part
      if (dependsOnToken && directParts[index] !== part) {
        unbound = true
      }
      return part
    })
    return { value: joinParts(parts), tokens: found, unbound }
  }
  return { read, readMarked, decide }
}

export { createBindings }
