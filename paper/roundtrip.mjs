import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { captureFrame } from "./capture.mjs"

const repo = fileURLToPath(new URL("..", import.meta.url))
const { transformSync } = createRequire(import.meta.url)("esbuild")
const treeLine = /^( *)(\S+) ("(?:[^"\\]|\\.)*") \(([^)]+)\)(.*)$/
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
      name: JSON.parse(name),
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

const unmatched = (expected, actual) => {
  const [inCapture, inExport] = [tally(expected), tally(actual)]
  const keys = new Set([...inCapture.keys(), ...inExport.keys()])
  return [...keys].flatMap((key) => {
    const surplus = (inCapture.get(key) ?? 0) - (inExport.get(key) ?? 0)
    const side = surplus > 0 ? "capture" : "Paper's export"
    return Array.from({ length: Math.abs(surplus) }, () => ({ key, side }))
  })
}

const otherSide = (side) => (side === "capture" ? "Paper's export" : "capture")

const compareFrames = (sidecar, rendered) => {
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
      `layer ${position + 1} is ${actual[position]?.key ?? "missing"} in Paper's export, ${expected[position]?.key ?? "missing"} in capture`
    )
  } else {
    expected.forEach((layer, index) => {
      const { width, height } = actual[index]
      if (width !== layer.width || height !== layer.height) {
        differences.push(
          `${layer.key} is ${width}x${height} in Paper's export, ${layer.width}x${layer.height} in capture`
        )
      }
    })
  }
  const bindings = ({ bindings }) =>
    bindings.map(
      ({ layer, property, token }) =>
        `${named(layer)}: ${property} is bound to ${token}`
    )
  for (const { key, side } of unmatched(
    bindings(sidecar),
    bindings(rendered)
  )) {
    differences.push(`${key} in ${side}, not in ${otherSide(side)}`)
  }
  const literals = ({ literals }) =>
    literals.map(
      ({ layer, property, value }) =>
        `${named(layer)}: ${property} has the literal ${value}`
    )
  for (const { key, side } of unmatched(
    literals(sidecar),
    literals(rendered)
  )) {
    differences.push(`${key} in ${side}, not in ${otherSide(side)}`)
  }
  for (const { layer, property, value } of sidecar.unsupported) {
    differences.push(`${layer}: ${property} ${value} is not imported`)
  }
  return differences
}

const checkExport = async (browser, { jsx, tree, sidecar, tokens }) => {
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
  return [...hidden, ...compareFrames(sidecar, rendered)]
}

export { checkExport, flattenTree, parseTree }
