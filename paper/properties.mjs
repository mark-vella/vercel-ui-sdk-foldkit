const sides = ["top", "right", "bottom", "left"]
const corners = ["top-left", "top-right", "bottom-right", "bottom-left"]
const boxProperties = [
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "justify-content",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-self",
  "justify-self",
  "order",
  "align-content",
  "justify-items",
  "grid-template-columns",
  "grid-template-rows",
  "grid-template-areas",
  "grid-auto-flow",
  "grid-auto-columns",
  "grid-auto-rows",
  "grid-column-start",
  "grid-column-end",
  "grid-row-start",
  "grid-row-end",
  "position",
  ...sides,
  "z-index",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "aspect-ratio",
  "overflow-x",
  "overflow-y",
  "text-overflow",
  "row-gap",
  "column-gap",
  ...sides.map((side) => `margin-${side}`),
  ...sides.map((side) => `padding-${side}`),
  ...sides.flatMap((side) =>
    ["width", "style", "color"].map((part) => `border-${side}-${part}`)
  ),
  ...corners.map((corner) => `border-${corner}-radius`),
  "background-color",
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
  "box-shadow",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "opacity",
  "transform",
  "rotate",
  "translate",
  "filter",
  "backdrop-filter",
  "isolation",
  "visibility",
  "direction",
]
const computedProperties = [
  "width",
  "height",
  "grid-template-columns",
  "grid-template-rows",
  "grid-auto-columns",
  "grid-auto-rows",
  ...sides,
  ...sides.map((side) => `margin-${side}`),
  "transform",
]
const textProperties = [
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
  "font-variant-numeric",
  "text-wrap-style",
  "white-space",
  "overflow-wrap",
]
// Paper writes box-sizing: border-box on every node it imports.
const emittedProperties = [...boxProperties, ...textProperties, "box-sizing"]
const ignoredProperties = [
  "accent-color",
  "app-region",
  "caret-color",
  "cursor",
  "pointer-events",
  "resize",
  "touch-action",
  "user-select",
  "-webkit-tap-highlight-color",
  "-webkit-user-drag",
  "-webkit-user-modify",
  "overscroll-behavior",
  "scroll-padding",
  "scrollbar-width",
  "animation",
  "transition",
  "will-change",
  "transform-origin",
  "perspective-origin",
  "-webkit-text-decorations-in-effect",
  "list-style",
]
const sizeConstraints = ["min-width", "min-height", "max-width", "max-height"]
const backgroundLonghands = [
  "background-image",
  "background-size",
  "background-position",
  "background-repeat",
]
const movesOrTurns = /^(none|((translate[XY]?|rotate)\([^()]*\) ?)+)$/
// Paper draws every layer as a box, where unicode-bidi normal and isolate
// are the same.
const harmlessValues = [
  ["rotate", /(^| )0deg$/],
  ["scale", /^1$/],
  ["translate", /^0(px|%)$/],
  ["transform", /^matrix\(1, 0, 0, 1, 0, 0\)$/],
  ["unicode-bidi", /^normal$/],
  ...[
    ["background-origin", "padding-box"],
    ["background-clip", "border-box"],
    ["background-attachment", "scroll"],
    ["background-blend-mode", "normal"],
  ].map(([property, initial]) => [
    property,
    new RegExp(`^${initial}(, ${initial})*$`),
  ]),
]
// A control or an image clips and wraps only its own content, which is
// recorded. Chromium stops drawing a control natively once its border or
// background is styled.
const tagDefaults = {
  input: ["appearance", "overflow-x", "overflow-y"],
  textarea: ["appearance", "overflow-x", "overflow-y", "overflow-wrap"],
  button: ["appearance"],
  img: ["overflow-x", "overflow-y", "overflow-clip-margin"],
}
const replacedElements = [
  "img",
  "picture",
  "video",
  "audio",
  "canvas",
  "iframe",
  "embed",
  "object",
]
const widgets = ["select", "progress", "meter"]
const widgetInputs = ["checkbox", "radio", "range", "color", "file", "image"]
const logicalPattern =
  /(^|-)(block|inline)(-|$)|^border-(start|end)-(start|end)-radius$/
const logicalSides = [
  ["block-start", "top"],
  ["block-end", "bottom"],
  ["inline-start", "left"],
  ["inline-end", "right"],
  ["block-size", "height"],
  ["inline-size", "width"],
  ["block", "y"],
  ["inline", "x"],
]
const logicalCorners = new Map([
  ["start-start", "top-left"],
  ["start-end", "top-right"],
  ["end-start", "bottom-left"],
  ["end-end", "bottom-right"],
])

const toPhysical = (property) => {
  const corner = property.match(/^border-(\w+-\w+)-radius$/)
  if (corner && logicalCorners.has(corner[1])) {
    return `border-${logicalCorners.get(corner[1])}-radius`
  }
  const logical = logicalSides.find(([side]) =>
    new RegExp(`(^|-)${side}(-|$)`).test(property)
  )
  return logical
    ? property.replace(...logical).replace(/^inset-/, "")
    : property
}

export {
  backgroundLonghands,
  boxProperties,
  computedProperties,
  corners,
  emittedProperties,
  harmlessValues,
  ignoredProperties,
  logicalPattern,
  movesOrTurns,
  replacedElements,
  sides,
  sizeConstraints,
  tagDefaults,
  textProperties,
  toPhysical,
  widgetInputs,
  widgets,
}
