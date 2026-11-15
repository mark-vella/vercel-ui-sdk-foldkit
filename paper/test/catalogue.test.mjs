import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureFrame, launchBrowser } from "../capture.mjs"
import {
  emittedProperties,
  ignoredProperties,
  toPhysical,
} from "../properties.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const examples = path.join(repo, "examples")
let browser
let page
let tokens

before(async () => {
  browser = await launchBrowser()
  page = await browser.newPage()
  ;({ tokens } = await readCodeTokens())
})
after(() => browser.close())

const readStylesheets = async () => {
  const components = path.join(examples, "components")
  const folders = [
    path.join(examples, "styles"),
    ...(await readdir(components)).map((name) => path.join(components, name)),
  ]
  const files = []
  for (const folder of folders) {
    for (const name of await readdir(folder)) {
      if (name.endsWith(".css")) {
        files.push(path.join(folder, name))
      }
    }
  }
  return Promise.all(files.map((file) => readFile(file, "utf8")))
}

const readDeclared = (sources) =>
  page.evaluate((sources) => {
    const declared = new Map()
    const collect = (rules) => {
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) {
          for (const name of rule.style ?? []) {
            const values = declared.get(name) ?? new Set()
            declared.set(name, values.add(rule.style.getPropertyValue(name)))
          }
        }
        collect(rule.cssRules ?? [])
      }
    }
    for (const source of sources) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(source)
      collect(sheet.cssRules)
    }
    return [...declared]
      .filter(([name]) => !name.startsWith("--"))
      .map(([name, values]) => [name, [...values]])
  }, sources)

const readLonghands = (properties) =>
  page.evaluate((properties) => {
    const probe = document.createElement("div")
    return properties.map((property) => {
      probe.style.cssText = ""
      probe.style.setProperty(property, "initial")
      return [...probe.style]
    })
  }, properties)

const mountCases = (cases) => {
  const preview = document.querySelector(".example-content")
  const add = (slot, property, value) => {
    const element = preview.appendChild(document.createElement("div"))
    element.dataset.slot = slot
    element.style.display = "flex"
    element.style.setProperty(property, value)
    const child = element.appendChild(document.createElement("div"))
    child.style.cssText = "width: 10px; height: 10px"
    return element
  }
  const plain = add("plain", "display", "flex")
  const elements = cases.map(({ property, value }, index) =>
    add(`case-${index}`, property, value)
  )
  const size = (element) => {
    const { width, height } = element.getBoundingClientRect()
    return `${width}x${height}`
  }
  const constraints = ["min-width", "min-height", "max-width", "max-height"]
  const identities = ["rotate: 0deg", "scale: 1", "translate: 0px"]
  return cases.flatMap(({ property, value }, index) => {
    const element = elements[index]
    const computed = getComputedStyle(element).getPropertyValue(property)
    const isChanged =
      computed !== getComputedStyle(plain).getPropertyValue(property) &&
      !identities.includes(`${property}: ${computed}`)
    const isUnbound =
      constraints.includes(property) && size(element) === size(plain)
    return isChanged && !isUnbound
      ? [{ slot: element.dataset.slot, property, value }]
      : []
  })
}

test("records each value the catalogue declares for a property it neither emits nor ignores", async () => {
  const handled = new Set(
    (await readLonghands([...emittedProperties, ...ignoredProperties]))
      .flat()
      .map(toPhysical)
  )
  const declared = await readDeclared(await readStylesheets())
  const cases = declared
    .map(([name, values]) => ({ property: toPhysical(name), values }))
    .filter(({ property }) => !handled.has(property))
    .flatMap(({ property, values }) =>
      values
        .filter(
          (value) => value && !/^(initial|inherit|unset|revert)/.test(value)
        )
        .map((value) => ({ property, value }))
    )
  let changed
  const { unsupported } = await captureFrame(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: async (page) => {
      changed = await page.evaluate(mountCases, cases)
    },
    tokens,
  })
  const unrecorded = changed.filter(
    ({ slot, property }) =>
      !unsupported.some(
        (entry) =>
          entry.layer === `fixture/case > preview > ${slot}` &&
          property.startsWith(entry.property)
      )
  )
  assert.ok(changed.length > 200, `${changed.length} declared values apply`)
  assert.deepEqual(
    unrecorded.map(({ property, value }) => `${property}: ${value}`),
    []
  )
})

test("puts no property in two classes", async () => {
  const longhands = await Promise.all(
    [emittedProperties, ignoredProperties].map(async (properties) =>
      (await readLonghands(properties)).flat().map(toPhysical)
    )
  )
  const repeated = longhands
    .flat()
    .filter((property, index, all) => all.indexOf(property) !== index)
  assert.deepEqual(repeated, [])
})
