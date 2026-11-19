const columns =
  "frame, capture hash, Paper fingerprint, commit it was captured at, losses"
const hash = "[0-9a-f]{12}"
const frameLine = new RegExp(
  `^(\\S+/\\S+) (${hash}) (${hash}) (${hash})(-dirty)? (?:exact|loses (.+))$`
)
const skippedLine = /^(\S+\/\S+) not imported, (.+)$/

const escapeText = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const lossesOf = (sidecar) =>
  [
    ...new Set([
      ...sidecar.unsupported.map(({ property }) => property),
      ...(sidecar.unbound.length > 0 ? ["unbound token"] : []),
    ]),
  ].toSorted()

const formatEntry = (name, entry) => {
  if (entry.skipped) {
    return `${name} not imported, ${entry.skipped}`
  }
  const { sourceHash, fingerprint, commit, dirty, losses } = entry
  const lost = losses.length > 0 ? `loses ${losses.join(", ")}` : "exact"
  return `${name} ${sourceHash} ${fingerprint} ${commit}${dirty ? "-dirty" : ""} ${lost}`
}

const formatProvenance = (sourcePath, entries) =>
  [
    `source ${sourcePath}`,
    columns,
    ...[...entries]
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .map(([name, entry]) => formatEntry(name, entry)),
  ].join("\n")

const parseLine = (line) => {
  const frame = line.match(frameLine)
  if (frame) {
    const [, name, sourceHash, fingerprint, sha, dirty, lost] = frame
    const losses = lost?.split(", ") ?? []
    return [
      name,
      { sourceHash, fingerprint, commit: sha, dirty: Boolean(dirty), losses },
    ]
  }
  const skipped = line.match(skippedLine)
  if (skipped) {
    return [skipped[1], { skipped: skipped[2] }]
  }
  return null
}

const parseProvenance = (text) =>
  new Map(
    text.split("\n").flatMap((line) => {
      const entry = parseLine(line)
      return entry ? [entry] : []
    })
  )

export { escapeText, formatProvenance, lossesOf, parseProvenance }
