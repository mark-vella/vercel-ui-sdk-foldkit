import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { captureFrame } from "./capture.mjs"

const repo = fileURLToPath(new URL("..", import.meta.url))
const { transformSync } = createRequire(import.meta.url)("esbuild")
const treeLine = /^( *)(\S+) "(.*?)" \(([\w-]+)\)(.*)$/
const elidedLine = /^ *\.\.\. \d+ children$/

const parseTree = (summary) => {
  const stack = []
  let root
  for (const line of summary.split("\n").filter((text) => text.trim())) {
    if (elidedLine.test(line)) {
      stack.at(-1).node.isElided = true
      continue
    }
    const [, indent, type, name, id, rest] = line.match(treeLine)
    const node = {
      type,
      name,
      id,
      isHidden: rest.endsWith(" [hidden]"),
      isElided: false,
      children: [],
    }
    while (stack.length > 0 && stack.at(-1).depth >= indent.length) {
      stack.pop()
    }
    if (stack.length === 0) {
      root = node
    } else {
      stack.at(-1).node.children.push(node)
    }
    stack.push({ node, depth: indent.length })
  }
  return root
}

const flattenTree = (node) => [node, ...node.children.flatMap(flattenTree)]

const layerNames = (sidecar) =>
  new Set(
    sidecar.layers
      .filter(({ kind }) => kind !== "svg")
      .map(({ layer }) => layer.split(" > ").at(-1))
  )

const namedFor = (tree, names) => {
  const name = (node, isRoot) => ({
    name: isRoot || names.has(node.name) ? node.name : null,
    children: ["Text", "SVG"].includes(node.type)
      ? null
      : node.children
          .filter(({ isHidden }) => !isHidden)
          .map((child) => name(child, false)),
  })
  return name(tree, true)
}

const mountExport = ({ code, names }) => {
  const unitless = new Set([
    "fontWeight",
    "opacity",
    "flexGrow",
    "flexShrink",
    "lineHeight",
    "zIndex",
    "order",
  ])
  const keepCase = new Set([
    "viewBox",
    "preserveAspectRatio",
    "gradientUnits",
    "gradientTransform",
    "patternUnits",
    "clipPathUnits",
  ])
  const kebab = (name) =>
    name
      .replace(
        /^(Moz|Webkit|ms)(?=[A-Z])/,
        (prefix) => `-${prefix.toLowerCase()}`
      )
      .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
  const exported = new Function(
    "h",
    `let paperExport\n${code}\nreturn paperExport`
  )((tag, props, ...children) => ({ tag, props: props ?? {}, children }))
  const build = (node, named, isSvg) => {
    if (node === null || node === undefined || node === false) {
      return []
    }
    if (Array.isArray(node)) {
      return node.flatMap((child) => build(child, named, isSvg))
    }
    if (typeof node !== "object") {
      return [document.createTextNode(String(node))]
    }
    const inSvg = isSvg || node.tag === "svg"
    const element = inSvg
      ? document.createElementNS("http://www.w3.org/2000/svg", node.tag)
      : document.createElement(node.tag)
    for (const [key, value] of Object.entries(node.props)) {
      if (key === "style") {
        for (const [property, part] of Object.entries(value)) {
          const isLength = typeof part === "number" && !unitless.has(property)
          element.style.setProperty(
            property.startsWith("--") ? property : kebab(property),
            isLength ? `${part}px` : String(part)
          )
        }
      } else {
        const name = key === "className" ? "class" : key
        const attribute = inSvg && !keepCase.has(name) ? kebab(name) : name
        element.setAttribute(attribute, String(value))
      }
    }
    if (named?.name) {
      element.dataset.paperLayer = named.name
    }
    const children = node.children.flat(Infinity)
    const elements = children.filter((child) => typeof child === "object")
    if (named?.children && named.children.length !== elements.length) {
      throw new Error(
        `Paper's export and tree disagree under ${named.name ?? node.tag}`
      )
    }
    for (const child of children) {
      const childNamed = named?.children?.[elements.indexOf(child)]
      element.append(...build(child, childNamed, inSvg))
    }
    return [element]
  }
  const [root] = build(exported, names, false)
  root.dataset.example = ""
  document.querySelector("[data-example]").replaceWith(root)
}

const tally = (keys) =>
  keys.reduce(
    (counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1),
    new Map()
  )

const unmatched = (expected, actual, exported) => {
  const [inCapture, inExport] = [tally(expected), tally(actual)]
  const keys = new Set([...inCapture.keys(), ...inExport.keys()])
  return [...keys].flatMap((key) => {
    const surplus = (inCapture.get(key) ?? 0) - (inExport.get(key) ?? 0)
    const [side, otherSide] =
      surplus > 0 ? ["capture", exported] : [exported, "capture"]
    return Array.from({ length: Math.abs(surplus) }, () => ({
      key,
      side,
      otherSide,
    }))
  })
}

const compareFrames = (sidecar, rendered, exported = "Paper's export") => {
  const names = layerNames(sidecar)
  const named = (path) =>
    path
      .split(" > ")
      .filter((segment) => names.has(segment) || segment === "svg")
      .join(" > ")
  const differences = []
  const [expected, actual] = [sidecar, rendered].map(({ layers }) =>
    layers.map((layer) => ({ ...layer, key: named(layer.layer) }))
  )
  const length = Math.max(expected.length, actual.length)
  const position = Array.from({ length }).findIndex(
    (_, index) => actual[index]?.key !== expected[index]?.key
  )
  if (position >= 0) {
    differences.push(
      `layer ${position + 1} is ${actual[position]?.key ?? "missing"} in ${exported}, ${expected[position]?.key ?? "missing"} in capture`
    )
  } else {
    expected.forEach((layer, index) => {
      const { width, height } = actual[index]
      if (width !== layer.width || height !== layer.height) {
        differences.push(
          `${layer.key} is ${width}x${height} in ${exported}, ${layer.width}x${layer.height} in capture`
        )
      }
    })
  }
  const bindings = ({ bindings }) =>
    bindings.map(
      ({ layer, property, token }) =>
        `${named(layer)}: ${property} is bound to ${token}`
    )
  for (const { key, side, otherSide } of unmatched(
    bindings(sidecar),
    bindings(rendered),
    exported
  )) {
    differences.push(`${key} in ${side}, not in ${otherSide}`)
  }
  const literals = ({ literals }) =>
    literals.map(
      ({ layer, property, value }) =>
        `${named(layer)}: ${property} has the literal ${value}`
    )
  for (const { key, side, otherSide } of unmatched(
    literals(sidecar),
    literals(rendered),
    exported
  )) {
    differences.push(`${key} in ${side}, not in ${otherSide}`)
  }
  for (const { layer, property, value } of sidecar.unsupported) {
    differences.push(`${layer}: ${property} ${value} is not imported`)
  }
  return differences
}

const mountEmitted = (html) => {
  const template = document.createElement("template")
  template.innerHTML = html
  for (const element of template.content.querySelectorAll("[layer-name]")) {
    element.dataset.paperLayer = element.getAttribute("layer-name")
  }
  for (const element of template.content.querySelectorAll("div")) {
    element.style.boxSizing = "border-box"
  }
  for (const svg of template.content.querySelectorAll("svg")) {
    svg.style.flexShrink = "0"
  }
  const root = template.content.firstElementChild
  root.dataset.example = ""
  document.querySelector("[data-example]").replaceWith(root)
}

const renderEmitted = (browser, { sidecar, html, tokens, inspect }) =>
  captureFrame(browser, {
    name: sidecar.name,
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) => page.evaluate(mountEmitted, html),
    tokens,
    inspect,
  })

const readLayerBoxes = () => {
  const frame = document.querySelector("[data-example]")
  const origin = frame.getBoundingClientRect()
  const pathOf = (element) =>
    element === frame
      ? element.dataset.paperLayer
      : `${pathOf(element.parentElement.closest("[data-paper-layer]"))} > ${element.dataset.paperLayer}`
  const layers = [frame, ...frame.querySelectorAll("[data-paper-layer]")]
  return layers.map((element) => {
    const { left, top, width, height } = element.getBoundingClientRect()
    return {
      layer: pathOf(element),
      left: left - origin.left,
      top: top - origin.top,
      width,
      height,
    }
  })
}

const findChangedRegion = async ({ expected, actual, frameWidth }) => {
  const decode = async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes]))
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext(
      "2d"
    )
    context.drawImage(bitmap, 0, 0)
    return context.getImageData(0, 0, bitmap.width, bitmap.height)
  }
  const [before, after] = await Promise.all([decode(expected), decode(actual)])
  if (before.width !== after.width || before.height !== after.height) {
    return null
  }
  let edges = null
  for (let index = 0; index < before.data.length; index++) {
    if (before.data[index] === after.data[index]) {
      continue
    }
    const pixel = index >> 2
    const [x, y] = [pixel % before.width, Math.floor(pixel / before.width)]
    edges = edges
      ? [
          Math.min(edges[0], x),
          Math.min(edges[1], y),
          Math.max(edges[2], x),
          Math.max(edges[3], y),
        ]
      : [x, y, x, y]
  }
  if (!edges) {
    return null
  }
  const scale = Math.round(before.width / frameWidth)
  const [left, top] = edges.slice(0, 2).map((edge) => Math.floor(edge / scale))
  const [right, bottom] = edges
    .slice(2)
    .map((edge) => Math.ceil((edge + 1) / scale))
  return { left, top, width: right - left, height: bottom - top }
}

const comparePictures = async (browser, { expected, actual, sidecar }) => {
  const page = await browser.newPage()
  try {
    return await page.evaluate(findChangedRegion, {
      expected: expected.png.toString("base64"),
      actual: actual.png.toString("base64"),
      frameWidth: sidecar.frame.width,
    })
  } finally {
    await page.close()
  }
}

const describeRegion = (region, boxes) => {
  const holds = (box) =>
    box.left - 1 <= region.left &&
    box.top - 1 <= region.top &&
    region.left + region.width <= box.left + box.width + 1 &&
    region.top + region.height <= box.top + box.height + 1
  const area = ({ width, height }) => width * height
  const innermost = boxes
    .filter(holds)
    .reduce((inner, box) => (area(box) <= area(inner) ? box : inner))
  const { left, top, width, height } = region
  return `${innermost.layer} looks different in Paper's export, in the ${width}x${height} region at ${left},${top} of the frame`
}

const checkExport = async (browser, { jsx, tree, sidecar, html, tokens }) => {
  const hidden = flattenTree(tree)
    .filter(({ isHidden }) => isHidden)
    .map(({ name }) => `${name} is hidden in Paper`)
  const { code } = transformSync(`paperExport = ${jsx.trim()}`, {
    loader: "jsx",
    jsxFactory: "h",
  })
  const rendered = await captureFrame(browser, {
    name: sidecar.name,
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) =>
      page.evaluate(mountExport, {
        code,
        names: namedFor(tree, layerNames(sidecar)),
      }),
    tokens,
  })
  const emitted = await renderEmitted(browser, {
    sidecar,
    html,
    tokens,
    inspect: (page) => page.evaluate(readLayerBoxes),
  })
  const region = await comparePictures(browser, {
    expected: emitted,
    actual: rendered,
    sidecar,
  })
  return [
    ...hidden,
    ...compareFrames(sidecar, rendered),
    ...(region ? [describeRegion(region, emitted.inspection)] : []),
  ]
}

const checkEmitted = async (browser, { sidecar, html, tokens }) => {
  const rendered = await renderEmitted(browser, { sidecar, html, tokens })
  const kept = { ...sidecar, unsupported: [] }
  return compareFrames(kept, rendered, "the emitted HTML")
}

export { checkEmitted, checkExport, flattenTree, parseTree }
