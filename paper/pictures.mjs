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
  const scale = Math.round(before.width / frameWidth)
  if (before.width !== after.width || before.height !== after.height) {
    const [width, height] = [
      Math.max(before.width, after.width),
      Math.max(before.height, after.height),
    ].map((edge) => Math.ceil(edge / scale))
    return { left: 0, top: 0, width, height, isResized: true }
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
  const [left, top] = edges.slice(0, 2).map((edge) => Math.floor(edge / scale))
  const [right, bottom] = edges
    .slice(2)
    .map((edge) => Math.ceil((edge + 1) / scale))
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    isResized: false,
  }
}

const comparePictures = async (browser, { expected, actual, frameWidth }) => {
  const page = await browser.newPage()
  try {
    return await page.evaluate(findChangedRegion, {
      expected: expected.toString("base64"),
      actual: actual.toString("base64"),
      frameWidth,
    })
  } finally {
    await page.close()
  }
}

const innermostLayer = (region, boxes) => {
  const holds = (box) =>
    box.left - 1 <= region.left &&
    box.top - 1 <= region.top &&
    region.left + region.width <= box.left + box.width + 1 &&
    region.top + region.height <= box.top + box.height + 1
  const area = ({ width, height }) => width * height
  return boxes
    .filter(holds)
    .reduce((inner, box) => (area(box) <= area(inner) ? box : inner), boxes[0])
    .layer
}

const resizedLayers = (expected, actual) =>
  expected.flatMap(({ layer, width, height }, index) => {
    const emitted = actual[index]
    if (emitted?.width === width && emitted?.height === height) {
      return []
    }
    const size = emitted ? `${emitted.width}x${emitted.height}` : "missing"
    return [
      {
        layer,
        property: "size",
        value: `${size} in the emitted HTML, ${width}x${height} in the example`,
      },
    ]
  })

export { comparePictures, innermostLayer, readLayerBoxes, resizedLayers }
