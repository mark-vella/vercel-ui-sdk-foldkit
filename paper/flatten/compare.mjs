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
  const withStyles = (declarations, measure) => {
    const authored = declarations.map(([node]) => node.getAttribute("style"))
    // Chromium writes CSSOM edits back to the attribute lazily, which leaves
    // style="" in an svg's outerHTML after removeAttribute.
    declarations.forEach(([node, declaration], index) => {
      node.setAttribute(
        "style",
        `${authored[index] ?? ""}; ${declaration} !important`
      )
    })
    const measured = measure()
    declarations.forEach(([node], index) => {
      if (authored[index] === null) {
        node.removeAttribute("style")
      } else {
        node.setAttribute("style", authored[index])
      }
    })
    return measured
  }
  const withStyle = (node, declaration, measure) =>
    withStyles([[node, declaration]], measure)
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
  const pinnedCopy = (node, copy) => {
    const computed = node.computedStyleMap()
    for (const property of getComputedStyle(node)) {
      copy.style.setProperty(
        property,
        String(computed.get(property)),
        "important"
      )
    }
    copy.append(...[...node.childNodes].map(copyOf))
    return withoutIdentity(copy)
  }
  const divWithAttributes = (node) => {
    const div = document.createElement("div")
    for (const { name, value } of node.attributes) {
      div.setAttribute(name, value)
    }
    return div
  }
  const toDiv = (node, display) => {
    const div = pinnedCopy(node, divWithAttributes(node))
    div.style.setProperty("display", display, "important")
    return div
  }
  // A connected copy of a custom element upgrades, and a copy that keeps its
  // name joins the radio group or exclusive details it came from.
  const copyOf = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.cloneNode()
    }
    const isCustom = node.localName.includes("-")
    return pinnedCopy(
      node,
      isCustom ? divWithAttributes(node) : node.cloneNode()
    )
  }
  const withoutIdentity = (element) => {
    for (const attribute of ["id", "name", "autofocus"]) {
      element.removeAttribute(attribute)
    }
    return element
  }
  const layoutOf = (element) => {
    const box = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const content = [...range.getClientRects()]
      .map(({ x, y, width, height }) => [x - box.x, y - box.y, width, height])
      .join()
    return { width: box.width, height: box.height, content }
  }
  const measureAsDiv = (node, display, sizes = {}) => {
    const own = withStyle(node, `display: ${display}`, () => layoutOf(node))
    const div = toDiv(node, display)
    for (const [property, value] of Object.entries(sizes)) {
      div.style.setProperty(property, value, "important")
    }
    const asDiv = withStyle(node, "display: none", () => {
      node.after(div)
      const layout = layoutOf(div)
      div.remove()
      return layout
    })
    return {
      width: own.width !== asDiv.width,
      height: own.height !== asDiv.height,
      content: own.content !== asDiv.content,
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
  const renderedLegend = (fieldset) => fieldset.querySelector(":scope > legend")
  const childBoxes = (element) => {
    const box = element.getBoundingClientRect()
    return [...element.children]
      .map((child) => {
        const { x, y, width, height } = child.getBoundingClientRect()
        return [x - box.x, y - box.y, width, height]
      })
      .concat([[box.width, box.height]])
      .join()
  }
  const findLegendFit = (fieldset) => {
    const legend = renderedLegend(fieldset)
    const style = getComputedStyle(fieldset)
    const isColumn =
      /grid/.test(style.display) ||
      (/flex/.test(style.display) && style.flexDirection === "column")
    const gap = isColumn ? parseFloat(style.rowGap) || 0 : 0
    const div = toDiv(fieldset, style.display)
    const copied = renderedLegend(div)
    copied.style.setProperty("width", "fit-content", "important")
    copied.style.setProperty(
      "margin-bottom",
      `${parseFloat(getComputedStyle(legend).marginBottom) - gap}px`,
      "important"
    )
    const asDiv = withStyle(fieldset, "display: none", () => {
      fieldset.after(div)
      const boxes = childBoxes(div)
      div.remove()
      return boxes
    })
    return asDiv === childBoxes(fieldset) ? { gap: gap !== 0 } : null
  }
  const legendFits = new Map()
  const legendFitOf = (fieldset) => {
    if (!renderedLegend(fieldset)) {
      return null
    }
    if (!legendFits.has(fieldset)) {
      legendFits.set(fieldset, findLegendFit(fieldset))
    }
    return legendFits.get(fieldset)
  }
  const ownSize = (node, display, changed) => {
    if (node.localName === "fieldset") {
      return legendFitOf(node) ? {} : undefined
    }
    const own = withStyle(node, `display: ${display}`, () => sizeOf(node))
    const axes = ["width", "height"].filter((axis) => changed[axis])
    const candidates = [
      Object.fromEntries(axes.map((axis) => [axis, "fit-content"])),
      Object.fromEntries(
        axes.map((axis) => [axis, `${Math.ceil(own[axis] * 1000) / 1000}px`])
      ),
    ]
    return candidates.find((sizes) => {
      const { width, height, content } = measureAsDiv(node, display, sizes)
      return !width && !height && !content
    })
  }
  const containFit =
    "contain: none !important; width: 0px !important; min-width: 100%"
  const contained = new Set()
  const holdsContain = (node) => {
    const chain = []
    for (let element = node; element; element = element.parentElement) {
      chain.push(element)
    }
    const measure = () => JSON.stringify(chain.map(layoutOf))
    const isHeld =
      getComputedStyle(node).contain === "inline-size" &&
      measure() === withStyle(node, containFit, measure)
    if (isHeld) {
      contained.add(node)
    }
    return isHeld
  }
  const paperFamilyOf = (fontFamily) =>
    `${fontFamily.split(",")[0]}, system-ui, sans-serif`
  const ownTextsOf = (element) =>
    [...element.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE)
  const rectsOf = (texts) =>
    texts
      .flatMap((text) => {
        const range = document.createRange()
        range.selectNodeContents(text)
        return [...range.getClientRects()].map(
          ({ x, y, width, height }) => `${x},${y} ${width}x${height}`
        )
      })
      .join()
  let isFrameFallbackMoved = null
  const frameFallbackMoves = (frame) => {
    if (isFrameFallbackMoved === null) {
      const elements = [frame, ...frame.querySelectorAll("*")]
      const texts = elements.flatMap(ownTextsOf)
      const declarations = elements.map((element) => [
        element,
        `font-family: ${paperFamilyOf(getComputedStyle(element).fontFamily)}`,
      ])
      isFrameFallbackMoved =
        rectsOf(texts) !== withStyles(declarations, () => rectsOf(texts))
    }
    return isFrameFallbackMoved
  }
  const fallsBackApart = (node) => {
    const { fontFamily } = getComputedStyle(node)
    const paperFamily = paperFamilyOf(fontFamily)
    const ownText = () => rectsOf(ownTextsOf(node))
    return (
      paperFamily !== fontFamily &&
      frameFallbackMoves(node.closest("[data-example]")) &&
      ownText() !== withStyle(node, `font-family: ${paperFamily}`, ownText)
    )
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
    const isUnpaintedBorder = (property) => {
      const side = property.match(/^border-(\w+)-style$/)?.[1]
      return (
        side && parseFloat(style.getPropertyValue(`border-${side}-width`)) === 0
      )
    }
    return compared.flatMap((property) => {
      // getComputedStyle resolves an auto inset of a positioned element to
      // the length it lands at, which moves nothing.
      const value = insets.includes(property)
        ? String(node.computedStyleMap().get(property))
        : style.getPropertyValue(property)
      const isHarmless =
        isEmitted(property, style, node) ||
        ownDefaults.includes(property) ||
        isUnpaintedBorder(property) ||
        (property === "contain" && holdsContain(node)) ||
        (property === "scale" && style.opacity === "0") ||
        (property === "vertical-align" &&
          !/^(inline|table-cell)/.test(style.display)) ||
        harmlessValues.get(property)?.test(value) ||
        referenceStyles.some(
          (reference) => reference.getPropertyValue(property) === value
        ) ||
        (property === "-webkit-locale" &&
          layoutOf(node).content ===
            withStyle(
              node,
              "-webkit-locale: auto",
              () => layoutOf(node).content
            )) ||
        ((constraints.includes(property) || property === "box-sizing") &&
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
    withStyle,
    bindsSize,
    resizesAsDiv,
    ownSize,
    isContained: (node) => contained.has(node),
    fallsBackApart,
    legendFitOf,
    dropped,
    droppedFromCopies,
    remove: () => host.remove(),
  }
}

export { createComparison }
