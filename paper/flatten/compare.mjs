const createComparison = ({
  compared,
  insets,
  harmlessSources,
  tagDefaults,
  sizeConstraints: constraints,
}) => {
  const harmlessValues = new Map(
    harmlessSources.map(([property, source]) => [property, new RegExp(source)])
  )
  const host = document.head.appendChild(document.createElement("div"))
  const shadow = host.attachShadow({ mode: "open" })
  const reference = shadow.appendChild(document.createElement("div"))
  const followsColor = (() => {
    const sample = shadow.appendChild(document.createElement("div"))
    sample.style.cssText = "all: initial; color: rgb(1, 2, 3)"
    const style = getComputedStyle(sample)
    const names = [...style].filter(
      (property) => style.getPropertyValue(property) === "rgb(1, 2, 3)"
    )
    sample.remove()
    return new Set(names)
  })()
  let context = null
  const enter = (element) => {
    if (element === context) {
      return
    }
    context = element
    const style = getComputedStyle(element)
    host.style.cssText = ""
    for (const property of style) {
      const value = style.getPropertyValue(property)
      // A computed currentcolor is a literal, which would stop following the
      // colour each reference is given.
      const isCurrentColor =
        property !== "color" &&
        followsColor.has(property) &&
        value === style.color
      host.style.setProperty(property, isCurrentColor ? "currentcolor" : value)
    }
  }
  const withStyle = (node, declaration, measure) => {
    const authored = node.getAttribute("style")
    // Chromium writes CSSOM edits back to the attribute lazily, which leaves
    // style="" in an svg's outerHTML after removeAttribute.
    node.setAttribute("style", `${authored ?? ""}; ${declaration} !important`)
    const measured = measure()
    if (authored === null) {
      node.removeAttribute("style")
    } else {
      node.setAttribute("style", authored)
    }
    return measured
  }
  const sizeOf = (element) => {
    const { width, height } = element.getBoundingClientRect()
    return { width, height }
  }
  const bindsSize = (node, property, value, measured = [node]) => {
    const sizes = () =>
      measured
        .map((element) => {
          const { width, height } = sizeOf(element)
          return `${width}x${height}`
        })
        .join()
    const before = sizes()
    return before !== withStyle(node, `${property}: ${value}`, sizes)
  }
  const toDiv = (node, display) => {
    const div = document.createElement("div")
    for (const { name, value } of node.attributes) {
      div.setAttribute(name, value)
    }
    const computed = node.computedStyleMap()
    for (const property of getComputedStyle(node)) {
      div.style.setProperty(
        property,
        String(computed.get(property)),
        "important"
      )
    }
    div.style.setProperty("display", display, "important")
    div.append(...[...node.childNodes].map(copyOf))
    return withoutIdentity(div)
  }
  // A connected copy of a custom element upgrades, and a copy that keeps its
  // name joins the radio group or exclusive details it came from.
  const copyOf = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.cloneNode()
    }
    if (node.localName.includes("-")) {
      return toDiv(node, getComputedStyle(node).display)
    }
    const copy = node.cloneNode()
    copy.append(...[...node.childNodes].map(copyOf))
    return withoutIdentity(copy)
  }
  const withoutIdentity = (element) => {
    for (const attribute of ["id", "name", "autofocus"]) {
      element.removeAttribute(attribute)
    }
    return element
  }
  const measureAsDiv = (node, display) => {
    const own = withStyle(node, `display: ${display}`, () => sizeOf(node))
    const div = toDiv(node, display)
    const asDiv = withStyle(node, "display: none", () => {
      node.after(div)
      const size = sizeOf(div)
      div.remove()
      return size
    })
    return {
      width: own.width !== asDiv.width,
      height: own.height !== asDiv.height,
    }
  }
  const sampleResizes = (tag, display) => {
    const sampleTag = customElements.get(tag) ? "paper-sample" : tag
    const container = document.createElement("div")
    container.style.cssText =
      "position: absolute; top: 0; left: 0; width: 300px; visibility: hidden"
    const layouts = [
      "display: block",
      "display: flex",
      "display: flex; flex-direction: column",
      "display: grid",
    ]
    const samples = layouts.flatMap((layout) =>
      ["", "Sample"].map((text) => {
        const parent = container.appendChild(document.createElement("div"))
        parent.style.cssText = layout
        const sample = parent.appendChild(document.createElement(sampleTag))
        sample.textContent = text
        return sample
      })
    )
    document.documentElement.append(container)
    const resizes = samples.some((sample) => {
      const { width, height } = measureAsDiv(sample, display)
      return width || height
    })
    container.remove()
    return resizes
  }
  const leafResizes = new Map()
  const isPlainLeaf = (node) =>
    node.childElementCount === 0 &&
    !node.shadowRoot &&
    ["::before", "::after"].every((pseudo) =>
      ["none", "normal"].includes(getComputedStyle(node, pseudo).content)
    )
  const resizesAsDiv = (node, display) => {
    if (!isPlainLeaf(node)) {
      return measureAsDiv(node, display)
    }
    const key = `${node.localName} ${display}`
    if (!leafResizes.has(key)) {
      leafResizes.set(key, sampleResizes(node.localName, display))
    }
    return leafResizes.get(key)
      ? measureAsDiv(node, display)
      : { width: false, height: false }
  }
  const droppedAgainst = (node, references, isEmitted = () => false) => {
    const style = getComputedStyle(node)
    for (const reference of references) {
      reference.style.color = style.color
    }
    const referenceStyles = references.map((reference) =>
      getComputedStyle(reference)
    )
    const ownDefaults = tagDefaults[node.localName] ?? []
    return compared.flatMap((property) => {
      // getComputedStyle resolves an auto inset of a positioned element to
      // the length it lands at, which moves nothing.
      const value = insets.includes(property)
        ? String(node.computedStyleMap().get(property))
        : style.getPropertyValue(property)
      const isHarmless =
        isEmitted(property, style, node) ||
        ownDefaults.includes(property) ||
        (property === "vertical-align" &&
          !/^(inline|table-cell)/.test(style.display)) ||
        harmlessValues.get(property)?.test(value) ||
        referenceStyles.some(
          (reference) => reference.getPropertyValue(property) === value
        ) ||
        (constraints.includes(property) &&
          !bindsSize(
            node,
            property,
            referenceStyles[0].getPropertyValue(property)
          ))
      return isHarmless ? [] : [[property, value]]
    })
  }
  const dropped = (node, isEmitted) =>
    droppedAgainst(node, [reference], isEmitted)
  const droppedFromCopies = (root, adjustments) => {
    const copies = adjustments.map((adjust) => {
      const copy = shadow.appendChild(root.cloneNode(true))
      adjust(copy)
      return copy
    })
    const [live, copied] = [root, copies[0]].map((element) => [
      element,
      ...element.querySelectorAll("*"),
    ])
    const found = live.flatMap((element, index) => {
      const references = index === 0 ? copies : [copied[index]]
      return droppedAgainst(element, references).map(([property, value]) => ({
        element,
        property,
        value,
      }))
    })
    for (const copy of copies) {
      copy.remove()
    }
    return found
  }
  return {
    enter,
    bindsSize,
    resizesAsDiv,
    dropped,
    droppedFromCopies,
    remove: () => host.remove(),
  }
}

export { createComparison }
