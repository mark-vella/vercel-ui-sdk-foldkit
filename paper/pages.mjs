const divider = { type: "divider" }

const kitPages = [
  { type: "page", name: "00 Cover", icon: "info" },
  { type: "page", name: "01 Foundations", icon: "swatches" },
  divider,
  { type: "page", name: "02 Components", icon: "design" },
  { type: "page", name: "03 Patterns", icon: "blueprint" },
  { type: "page", name: "04 Templates", icon: "presentation" },
  divider,
  { type: "page", name: "99 Playground", icon: "paper" },
]
const [cover] = kitPages
const kitPageNames = kitPages.flatMap((entry) => entry.name ?? [])
const placeholderName = "Page 1"

const readPages = async (paper, fileId) => {
  const { pages } = await paper.call("get_basic_info", { fileId })
  return pages
}

const isEmptyPage = async (paper, fileId, pageId) => {
  const { artboardCount } = await paper.call("get_basic_info", {
    fileId,
    pageId,
  })
  return artboardCount === 0
}

const pagesByName = (pages) => {
  const byName = new Map()
  for (const item of pages) {
    if (item.type === "page" && !byName.has(item.name)) {
      byName.set(item.name, item)
    }
  }
  return byName
}

const describeItem = (item) => (item.type === "divider" ? "divider" : item.name)

const describeIcon = (icon) => icon ?? "default"

const arrangePages = (pages) => {
  const byName = pagesByName(pages)
  const positions = new Map(pages.map((item, index) => [item.id, index]))
  const claimed = new Set()
  const neighbourOf = (name, offset) => {
    const page = byName.get(name)
    return page && pages[positions.get(page.id) + offset]
  }
  const kitItems = kitPages.map((entry, index) => {
    if (entry.type === "page") {
      return byName.get(entry.name) ?? entry
    }
    const existing = [
      neighbourOf(kitPages[index - 1].name, 1),
      neighbourOf(kitPages[index + 1].name, -1),
    ].find((item) => item?.type === "divider" && !claimed.has(item.id))
    if (!existing) {
      return divider
    }
    claimed.add(existing.id)
    return existing
  })
  const kitIds = new Set(kitItems.map((item) => item.id))
  return [...kitItems, ...pages.filter((item) => !kitIds.has(item.id))]
}

const isArranged = (arranged, pages) =>
  arranged.length === pages.length &&
  arranged.every((item, index) => item.id === pages[index].id)

const wrongIcons = (pages) => {
  const byName = pagesByName(pages)
  return kitPages.flatMap((entry) => {
    const page = byName.get(entry.name)
    return page && page.icon !== entry.icon ? [{ entry, page }] : []
  })
}

const printNames = (label, names) => {
  const list = names.length > 0 ? ` (${names.join(", ")})` : ""
  console.log(`${label} ${names.length}${list}`)
}

const syncPages = async (paper, fileId) => {
  let pages = await readPages(paper, fileId)
  const byName = pagesByName(pages)
  const missing = kitPages.filter(
    (entry) => entry.type === "page" && !byName.has(entry.name)
  )
  const placeholder = byName.get(placeholderName)
  const renamesPlaceholder =
    !byName.has(cover.name) &&
    placeholder !== undefined &&
    (await isEmptyPage(paper, fileId, placeholder.id))
  const created = renamesPlaceholder
    ? missing.filter((entry) => entry !== cover)
    : missing
  const iconFixes = wrongIcons(pages)
  let writes = 0

  for (const { name, icon } of created) {
    await paper.call("create_page", { fileId, name, icon })
    writes += 1
  }
  const updates = iconFixes.map(({ entry, page }) => ({
    pageId: page.id,
    icon: entry.icon,
  }))
  if (renamesPlaceholder) {
    updates.push({ pageId: placeholder.id, name: cover.name, icon: cover.icon })
  }
  if (updates.length > 0) {
    await paper.call("update_pages", { fileId, updates })
    writes += 1
  }
  if (created.length > 0 || renamesPlaceholder) {
    pages = await readPages(paper, fileId)
  }
  const arranged = arrangePages(pages)
  const isReordered = !isArranged(arranged, pages)
  if (isReordered) {
    const order = arranged.map((item) => {
      if (item.id) {
        return item.id
      }
      if (item.type !== "divider") {
        throw new Error(`${item.name} is still missing after sync.`)
      }
      return divider
    })
    await paper.call("arrange_pages", { fileId, order })
    writes += 1
  }

  printNames(
    "created",
    created.map((entry) => entry.name)
  )
  printNames(
    "renamed",
    renamesPlaceholder ? [`${placeholderName} -> ${cover.name}`] : []
  )
  printNames(
    "icons",
    iconFixes.map(
      ({ entry, page }) =>
        `${entry.name}: ${describeIcon(page.icon)} -> ${entry.icon}`
    )
  )
  console.log(`arranged ${isReordered ? "yes" : "no"}`)
  console.log(`writes ${writes}`)
}

const verifyPages = async (paper, fileId) => {
  const pages = await readPages(paper, fileId)
  const byName = pagesByName(pages)
  const missing = kitPageNames.filter((name) => !byName.has(name))
  const iconFixes = wrongIcons(pages)
  const arranged = arrangePages(pages)
  const isOrdered = isArranged(arranged, pages)
  for (const name of missing) {
    console.log(`${name}: missing`)
  }
  for (const { entry, page } of iconFixes) {
    console.log(
      `${entry.name}: icon ${describeIcon(page.icon)}, expected ${entry.icon}`
    )
  }
  if (!isOrdered) {
    console.log(`order: expected ${arranged.map(describeItem).join(", ")}`)
    console.log(`       Paper has ${pages.map(describeItem).join(", ")}`)
  }
  const differences = missing.length + iconFixes.length + (isOrdered ? 0 : 1)
  console.log(
    `pages: ${kitPageNames.length - missing.length} of ${kitPageNames.length} present, ${differences} differ`
  )
  return differences === 0
}

class PrerequisiteError extends Error {}

const findPageId = async (paper, fileId, name) => {
  if (!kitPageNames.includes(name)) {
    throw new Error(`${name} is not a kit page.`)
  }
  const page = pagesByName(await readPages(paper, fileId)).get(name)
  if (!page) {
    throw new PrerequisiteError(
      `${name} is missing. Run node paper/sync.mjs pages --file ${fileId} first.`
    )
  }
  return page.id
}

export { findPageId, PrerequisiteError, syncPages, verifyPages }
