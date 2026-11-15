import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { launchBrowser } from "../capture.mjs"
import {
  emittedProperties,
  ignoredProperties,
  recordedProperties,
  toPhysical,
} from "../properties.mjs"

const examples = fileURLToPath(new URL("../../examples/", import.meta.url))
let browser
let page

before(async () => {
  browser = await launchBrowser()
  page = await browser.newPage()
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
    const names = new Set()
    const collect = (rules) => {
      for (const rule of rules) {
        if (!(rule instanceof CSSFontFaceRule)) {
          for (const name of rule.style ?? []) {
            names.add(name)
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
    return [...names].filter((name) => !name.startsWith("--"))
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

test("classifies every property the catalogue's stylesheets declare", async () => {
  const classes = [emittedProperties, recordedProperties, ignoredProperties]
  const classified = new Set(
    (await readLonghands(classes.flat())).flat().map(toPhysical)
  )
  const declared = await readDeclared(await readStylesheets())
  const unclassified = declared
    .map(toPhysical)
    .filter((property) => !classified.has(property))
  assert.deepEqual([...new Set(unclassified)].toSorted(), [])
})

test("puts no property in two classes", async () => {
  const classes = [emittedProperties, recordedProperties, ignoredProperties]
  const longhands = await Promise.all(
    classes.map(async (properties) =>
      (await readLonghands(properties)).flat().map(toPhysical)
    )
  )
  const repeated = longhands
    .flat()
    .filter((property, index, all) => all.indexOf(property) !== index)
  assert.deepEqual(repeated, [])
})
