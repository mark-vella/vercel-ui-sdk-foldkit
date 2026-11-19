import { comparePictures } from "../pictures.mjs"

const textElements = () =>
  [...document.querySelectorAll("[data-example] *")].filter((element) =>
    [...element.childNodes].some(
      (child) => child.nodeType === Node.TEXT_NODE && child.data.trim()
    )
  )

const synthesizedAxes = (elements) => {
  const styles = elements.map((element) => getComputedStyle(element))
  return [
    styles.some(({ fontWeight }) => Number(fontWeight) >= 600) && "weight",
    styles.some(({ fontStyle }) => fontStyle !== "normal") && "style",
  ].filter(Boolean)
}

const underlinedWithNoOffset = (elements) =>
  elements.filter((element) => {
    const style = getComputedStyle(element)
    return (
      style.textDecorationLine.includes("underline") &&
      style.textUnderlineOffset === "auto" &&
      style.textUnderlinePosition === "auto"
    )
  })

const placeFromFont = (elements) =>
  elements.map((element) => {
    const authored = element.getAttribute("style")
    element.setAttribute(
      "style",
      `${authored ?? ""}; text-underline-position: from-font !important`
    )
    return [element, authored]
  })

const restoreStyles = (changed) => {
  for (const [element, authored] of changed) {
    if (authored === null) {
      element.removeAttribute("style")
    } else {
      element.setAttribute("style", authored)
    }
  }
}

const changedRegion = async (page, frameWidth, change) => {
  const frame = page.locator("[data-example]")
  const expected = await frame.screenshot()
  const undo = await change()
  const actual = await frame.screenshot()
  await undo()
  return comparePictures(page.context().browser(), {
    expected,
    actual,
    frameWidth,
  })
}

const recordIfChanged = async (page, { layer, width }, record, change) => {
  const region = await changedRegion(page, width, change)
  if (!region) {
    return []
  }
  const { left, top, width: regionWidth, height } = region
  const value = `${record.value} in ${regionWidth}x${height} at ${left},${top}`
  return [{ layer, property: record.property, value }]
}

// Paper never synthesizes bold or italic, which Chromium draws for a fallback
// font that lacks the weight or style. Paper places an underline that has no
// offset from the font.
const recordTextDrawing = async (page, frame) => {
  const elements = await page.evaluateHandle(textElements)
  const underlined = await elements.evaluateHandle(underlinedWithNoOffset)
  try {
    const axes = await elements.evaluate(synthesizedAxes)
    const synthesis =
      axes.length === 0
        ? []
        : await recordIfChanged(
            page,
            frame,
            { property: "font synthesis", value: axes.join(", ") },
            async () => {
              const style = await page.addStyleTag({
                content: "[data-example] * { font-synthesis: none !important }",
              })
              return () => style.evaluate((element) => element.remove())
            }
          )
    const hasUnderlines = await underlined.evaluate(
      (elements) => elements.length > 0
    )
    const underlines = !hasUnderlines
      ? []
      : await recordIfChanged(
          page,
          frame,
          { property: "text-underline-position", value: "auto" },
          async () => {
            const changed = await underlined.evaluateHandle(placeFromFont)
            return async () => {
              await changed.evaluate(restoreStyles)
              await changed.dispose()
            }
          }
        )
    return [...synthesis, ...underlines]
  } finally {
    await underlined.dispose()
    await elements.dispose()
  }
}

export { recordTextDrawing }
