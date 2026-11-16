const createLayout = ({ comparison }) => {
  const dropInheritedDirection = ({ styles }, parent) => {
    if (styles.direction.value === getComputedStyle(parent).direction) {
      delete styles.direction
    }
  }
  const rectOf = ({ element, fit }) => {
    const measure = () => element.getBoundingClientRect()
    return fit ? comparison.withStyle(element, fit, measure) : measure()
  }
  const isAtRest = (element) => {
    const style = getComputedStyle(element)
    const gutter = (size, client, start, end) =>
      element[size] -
      element[client] -
      parseFloat(style[start]) -
      parseFloat(style[end])
    return (
      element.scrollTop === 0 &&
      element.scrollLeft === 0 &&
      gutter(
        "offsetWidth",
        "clientWidth",
        "borderLeftWidth",
        "borderRightWidth"
      ) === 0 &&
      gutter(
        "offsetHeight",
        "clientHeight",
        "borderTopWidth",
        "borderBottomWidth"
      ) === 0
    )
  }
  // Paper stores a scroll container as a clip with no automatic minimum size.
  const pinScroll = ({ element, styles }) => {
    const sides = [styles["overflow-x"], styles["overflow-y"]]
    const scrolls = sides.filter(({ value }) =>
      ["hidden", "auto", "scroll"].includes(value)
    )
    if (scrolls.length === 0 || !isAtRest(element)) {
      return
    }
    for (const side of scrolls) {
      side.value = "clip"
    }
    for (const property of ["min-width", "min-height"]) {
      if (styles[property].value === "auto") {
        styles[property] = { value: "0px", tokens: [] }
      }
    }
  }
  return { dropInheritedDirection, rectOf, isAtRest, pinScroll }
}

export { createLayout }
