import { escapeText } from "./provenance.mjs"

const frameWidth = 560
const framesPerRow = 3
const boardsPerRow = 6
const boardGap = { column: 160, row: 320 }
const headerHeight = 160
const lineHeight = 20
const charactersPerLine = 220
const docsUrl = "https://ui-sdk.dev/docs/web-components/components"

const boardStyles = (space) => ({
  width: `${framesPerRow * frameWidth + (framesPerRow + 1) * space}px`,
  height: "fit-content",
  display: "flex",
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "flex-start",
  alignContent: "flex-start",
  gap: "var(--space-8)",
  padding: "var(--space-8)",
  backgroundColor: "var(--tint)",
})

const countsText = (entries) => {
  const all = [...entries.values()]
  const exact = all.filter(({ losses }) => losses?.length === 0).length
  const lossy = all.filter(({ losses }) => losses?.length > 0).length
  const skipped = all.filter(({ skipped }) => skipped).length
  return [
    `${all.length} frames`,
    `${exact} record nothing`,
    `${lossy} list a loss`,
    ...(skipped > 0 ? [`${skipped} not imported`] : []),
  ].join(", ")
}

const headerTexts = ({ component, sourcePath, entries }) => [
  component,
  sourcePath,
  `${docsUrl}/${component}`,
  countsText(entries),
]

const headerHtml = (texts) => {
  const [title, sourcePath, url, counts] = texts.map(escapeText)
  return `<div layer-name="header" style="display: flex; flex-direction: column; gap: var(--space-2); width: 100%; padding-bottom: var(--space-6); border-bottom: 1px solid var(--line-faint); color: var(--ink); font-family: Geist; font-size: var(--text-sm); line-height: var(--leading)"><div style="font-size: 32px; line-height: 40px; font-weight: 600; letter-spacing: -0.02em">${title}</div><div style="display: flex; gap: var(--space-6); font-family: var(--mono); font-size: var(--text-xs); color: var(--muted)"><div>${sourcePath}</div><div>${url}</div></div><div style="color: var(--muted)">${counts}</div></div>`
}

const readTexts = (jsx) =>
  [...jsx.matchAll(/>([^<>]*)</g)]
    .map(([, text]) => text.trim())
    .filter(Boolean)

const estimateHeight = ({ frameHeights, lines }, space) => {
  const rows = Array.from(
    { length: Math.ceil(frameHeights.length / framesPerRow) },
    (_, row) =>
      Math.max(
        ...frameHeights.slice(row * framesPerRow, (row + 1) * framesPerRow)
      )
  )
  const provenance = lines.reduce(
    (height, line) =>
      height + lineHeight * Math.max(1, Math.ceil(line / charactersPerLine)),
    0
  )
  const blocks = [headerHeight, ...rows, provenance]
  return (
    blocks.reduce((sum, height) => sum + height, 0) +
    (blocks.length + 1) * space
  )
}

const placeBoards = (boards, space) => {
  const width = framesPerRow * frameWidth + (framesPerRow + 1) * space
  const places = new Map()
  let top = 0
  for (let start = 0; start < boards.length; start += boardsPerRow) {
    const row = boards.slice(start, start + boardsPerRow)
    row.forEach(({ component }, column) => {
      places.set(component, {
        left: `${column * (width + boardGap.column)}px`,
        top: `${top}px`,
      })
    })
    top += Math.max(...row.map((board) => estimateHeight(board, space)))
    top += boardGap.row
  }
  return places
}

export { boardStyles, headerHtml, headerTexts, placeBoards, readTexts }
