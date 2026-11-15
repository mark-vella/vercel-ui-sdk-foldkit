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
  "row-gap",
  "column-gap",
  ...sides.map((side) => `padding-${side}`),
  ...sides.flatMap((side) =>
    ["width", "style", "color"].map((part) => `border-${side}-${part}`)
  ),
  ...corners.map((corner) => `border-${corner}-radius`),
  "background-color",
  "box-shadow",
  "outline-width",
  "outline-style",
  "outline-color",
  "outline-offset",
  "opacity",
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
  "white-space",
]
// Paper writes box-sizing: border-box on every node it imports.
const emittedProperties = [
  ...boxProperties,
  ...textProperties,
  "width",
  "height",
  "box-sizing",
]
const recordedProperties = [
  "align-content",
  "align-self",
  "appearance",
  "aspect-ratio",
  "background-attachment",
  "background-clip",
  "background-image",
  "background-origin",
  "background-position",
  "background-repeat",
  "background-size",
  "border-collapse",
  "border-image",
  "border-spacing",
  "clip-path",
  "contain",
  "container-type",
  "content",
  "fill",
  "filter",
  "flex-basis",
  "font-feature-settings",
  "font-kerning",
  "font-language-override",
  "font-optical-sizing",
  "font-size-adjust",
  "font-stretch",
  "font-variant",
  "font-variation-settings",
  "grid-column",
  "grid-row",
  "grid-template-columns",
  "inset",
  "isolation",
  "justify-items",
  "justify-self",
  "list-style",
  "margin",
  "mask",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "order",
  "overflow",
  "overflow-wrap",
  "position",
  "rotate",
  "scale",
  "stroke-width",
  "text-decoration-color",
  "text-decoration-style",
  "text-decoration-thickness",
  "text-overflow",
  "text-underline-offset",
  "text-wrap-style",
  "translate",
  "vertical-align",
  "visibility",
  "-webkit-box-orient",
  "-webkit-line-clamp",
  "z-index",
]
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
]
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
  boxProperties,
  corners,
  emittedProperties,
  ignoredProperties,
  logicalPattern,
  recordedProperties,
  sides,
  textProperties,
  toPhysical,
}
