import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { captureFrame, launchBrowser } from "../capture.mjs"
import { toPaperOrder } from "../declarations.mjs"
import { checkEmitted } from "../roundtrip.mjs"
import { readCodeTokens } from "../tokens.mjs"

const repo = fileURLToPath(new URL("../..", import.meta.url))
const layerPath = (slot) => `fixture/case > preview > ${slot}`
let browser
let tokens

before(async () => {
  browser = await launchBrowser()
  ;({ tokens } = await readCodeTokens())
})
after(() => browser.close())

const capture = async (html) => {
  const result = await captureFrame(browser, {
    name: "fixture/case",
    root: repo,
    stylesheets: ["/examples/styles/tokens.css"],
    mount: (page) =>
      page.locator(".example-content").evaluate((preview, content) => {
        preview.innerHTML = content
      }, html),
    tokens,
  })
  const sidecar = { ...result, name: "fixture/case" }
  const offline = await checkEmitted(browser, {
    sidecar,
    html: result.html,
    tokens,
  })
  return { ...result, offline }
}

const styleOf = ({ html }, slot) =>
  html.match(new RegExp(`<div layer-name="${slot}" style="([^"]*)"`))?.[1]

const unsupportedAt = ({ unsupported }, slot) =>
  unsupported
    .filter(({ layer }) => layer === layerPath(slot))
    .map(({ property }) => property)
    .toSorted()

const bindingsAt = ({ bindings }, slot) =>
  bindings
    .filter(({ layer }) => layer.endsWith(` > ${slot}`))
    .map(({ property, token }) => `${property} ${token}`)

describe("minimum and maximum sizes", () => {
  test("are emitted with their tokens and reproduce the layout", async () => {
    const result = await capture(
      `<div data-slot="tall" style="display: flex; box-sizing: border-box; min-height: var(--size-item); padding: var(--space-1)"><div style="width: 8px; height: 8px"></div></div><div data-slot="capped" style="display: flex; max-width: 60px"><div style="width: 200px; height: 8px"></div></div>`
    )
    assert.deepEqual(
      {
        tall: styleOf(result, "tall"),
        capped: styleOf(result, "capped"),
        bindings: bindingsAt(result, "tall"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        tall: "display: flex; min-height: var(--size-item); padding: var(--space-1)",
        capped: "display: flex; max-width: 60px",
        bindings: ["min-height --size-item", "padding --space-1"],
        unsupported: [],
        offline: [],
      }
    )
  })
})

describe("margins", () => {
  test("are emitted with auto, tokens and negative lengths, and reproduce the layout", async () => {
    const result = await capture(
      `<div style="display: flex; flex-direction: column; width: 200px"><div data-slot="pushed" style="display: flex; margin-left: auto"><div style="width: 20px; height: 10px"></div></div></div><div style="display: flex; flex-direction: column"><div data-slot="spaced" style="width: 30px; height: 10px; margin: var(--space-2) var(--space-4)"></div><div data-slot="pulled" style="width: 30px; height: 10px; margin-top: -4px"></div></div>`
    )
    assert.deepEqual(
      {
        pushed: styleOf(result, "pushed"),
        spaced: styleOf(result, "spaced"),
        pulled: styleOf(result, "pulled"),
        bindings: bindingsAt(result, "spaced"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        pushed: "display: flex; margin: 0px 0px 0px auto",
        spaced:
          "flex-shrink: 1; width: 30px; height: 10px; margin: var(--space-2) var(--space-4)",
        pulled:
          "flex-shrink: 1; width: 30px; height: 10px; margin: -4px 0px 0px 0px",
        bindings: ["margin --space-2", "margin --space-4"],
        unsupported: [],
        offline: [],
      }
    )
  })

  test("of a heading are emitted as the browser gives them", async () => {
    const result = await capture(
      `<h4 data-slot="h" style="margin-block: 1.33em">Title</h4>`
    )
    assert.match(styleOf(result, "h"), /^margin: 21\.28px 0px; /)
  })
})

describe("flex item properties", () => {
  test("are emitted with their tokens and reproduce the layout", async () => {
    const result = await capture(
      `<div style="display: flex; width: 200px; height: 40px; align-items: flex-start"><div data-slot="grow" style="flex: 1; height: 10px"></div><div data-slot="basis" style="flex: 0 0 var(--space-8); height: 10px"></div><div data-slot="stretched" style="align-self: stretch; order: 1; width: 10px"></div></div><div data-slot="lines" style="display: flex; flex-wrap: wrap; align-content: flex-start; width: 40px; height: 60px"><div style="width: 30px; height: 10px"></div><div style="width: 30px; height: 10px"></div></div>`
    )
    assert.deepEqual(
      {
        grow: styleOf(result, "grow"),
        basis: styleOf(result, "basis"),
        stretched: styleOf(result, "stretched"),
        lines: styleOf(result, "lines"),
        bindings: bindingsAt(result, "basis"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        grow: "flex-grow: 1; flex-shrink: 1; flex-basis: 0%; height: 10px",
        basis: "flex-shrink: 0; flex-basis: var(--space-8); height: 10px",
        stretched: "flex-shrink: 1; align-self: stretch; order: 1; width: 10px",
        lines:
          "display: flex; flex-wrap: wrap; align-content: flex-start; flex-shrink: 1; width: 40px; height: 60px",
        bindings: ["flex-basis --space-8"],
        unsupported: [],
        offline: [],
      }
    )
  })
})

describe("grid", () => {
  test("is emitted with its tracks, areas, placement and tokens, and reproduces the layout", async () => {
    const result = await capture(
      `<div data-slot="tracks" style="display: grid; width: 200px; grid-template-columns: repeat(3, 1fr) var(--space-8); grid-auto-rows: var(--size-sm); gap: var(--space-2)"><div data-slot="wide" style="grid-column: 2 / span 2"></div><div></div></div><div data-slot="areas" style="display: inline-grid; grid-template-areas: 'head head' 'side main'; grid-template-columns: 40px 80px; grid-template-rows: 20px 30px"><div data-slot="head" style="grid-area: head"></div></div>`
    )
    assert.deepEqual(
      {
        tracks: styleOf(result, "tracks"),
        wide: styleOf(result, "wide"),
        areas: styleOf(result, "areas"),
        head: styleOf(result, "head"),
        bindings: bindingsAt(result, "tracks"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        tracks:
          "display: grid; grid-template-columns: repeat(3, 1fr) var(--space-8); grid-auto-rows: var(--size-sm); gap: var(--space-2); flex-shrink: 1; width: 200px",
        wide: "grid-column-start: 2; grid-column-end: span 2",
        areas:
          "display: grid; grid-template-columns: 40px 80px; grid-template-rows: 20px 30px; grid-template-areas: &quot;head head&quot; &quot;side main&quot;",
        head: "grid-column-start: head; grid-column-end: head; grid-row-start: head; grid-row-end: head",
        bindings: [
          "grid-template-columns --space-8",
          "grid-auto-rows --size-sm",
          "gap --space-2",
        ],
        unsupported: [],
        offline: [],
      }
    )
  })
})

describe("position", () => {
  test("is emitted with insets, tokens and z-index, and reproduces the layout", async () => {
    const result = await capture(
      `<div data-slot="box" style="position: relative; display: flex; width: 120px; height: 40px"><div data-slot="cover" style="position: absolute; inset: var(--space-1); z-index: 1; background-color: var(--tint)"></div><div data-slot="nudged" style="position: relative; top: 5px; width: 20px; height: 20px"></div></div>`
    )
    assert.deepEqual(
      {
        box: styleOf(result, "box"),
        cover: styleOf(result, "cover"),
        nudged: styleOf(result, "nudged"),
        bindings: bindingsAt(result, "cover"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        box: "display: flex; flex-shrink: 1; width: 120px; height: 40px; position: relative",
        cover:
          "min-width: 0px; min-height: 0px; position: absolute; top: var(--space-1); right: var(--space-1); bottom: var(--space-1); left: var(--space-1); z-index: 1; background-color: var(--tint)",
        nudged:
          "flex-shrink: 1; width: 20px; height: 20px; position: relative; top: 5px",
        bindings: [
          "top --space-1",
          "right --space-1",
          "bottom --space-1",
          "left --space-1",
          "background-color --tint",
        ],
        unsupported: [],
        offline: [],
      }
    )
  })

  test("puts an absolute layer where Paper paints it among its siblings", async () => {
    const result = await capture(
      `<div style="position: relative; display: flex"><div data-slot="above" style="position: absolute; z-index: 3"></div><div data-slot="raised" style="position: relative; z-index: 1"></div><div data-slot="overlay" style="position: absolute"></div><div data-slot="flow"></div><div data-slot="below" style="position: absolute; z-index: -1"></div><div data-slot="top" style="z-index: 5"></div><div data-slot="last" style="position: relative"></div></div>`
    )
    assert.deepEqual(
      [...result.html.matchAll(/layer-name="(\w+)"/g)]
        .map(([, name]) => name)
        .slice(2),
      ["below", "overlay", "raised", "flow", "above", "top", "last"]
    )
  })

  test("leaves out a z-index that CSS ignores on a static child of a block", async () => {
    const result = await capture(
      `<div data-slot="block" style="position: relative"><div data-slot="ignored" style="z-index: 1; height: 10px"></div><div data-slot="cover" style="position: absolute; inset: 0; background-color: var(--tint)"></div></div><div data-slot="row" style="position: relative; display: flex"><div data-slot="lifted" style="z-index: 1; width: 10px; height: 10px"></div><div data-slot="under" style="position: absolute; inset: 0; background-color: var(--tint)"></div></div>`
    )
    assert.deepEqual(
      {
        order: [...result.html.matchAll(/layer-name="(\w+)"/g)]
          .map(([, name]) => name)
          .slice(2),
        ignored: styleOf(result, "ignored"),
        lifted: styleOf(result, "lifted"),
        unsupported: result.unsupported,
      },
      {
        order: ["block", "ignored", "cover", "row", "under", "lifted"],
        ignored:
          "flex-shrink: 1; height: 10px; min-width: 0px; min-height: 0px",
        lifted: "flex-shrink: 1; width: 10px; height: 10px; z-index: 1",
        unsupported: [],
      }
    )
  })

  test("keeps every absolute row of a virtualized list before a relative spacer", () => {
    const layer = (position) => ({
      styles: { position: { value: position }, "z-index": { value: "auto" } },
    })
    const rows = Array.from({ length: 10_000 }, () => layer("absolute"))
    const spacer = layer("relative")
    const ordered = toPaperOrder([...rows, spacer])
    assert.deepEqual(
      { length: ordered.length, last: ordered.at(-1) === spacer },
      { length: 10_001, last: true }
    )
  })

  test("pins an absolute box at the static position it lands at", async () => {
    const result = await capture(
      `<div style="position: relative; display: flex; padding-left: 10px"><div style="width: 20px; height: 10px"></div><div data-slot="badge" style="position: absolute; width: 4px; height: 4px"></div></div>`
    )
    assert.match(
      styleOf(result, "badge"),
      /position: absolute; top: 0px; left: 10px$/
    )
  })

  test("is recorded on an absolute box placed against an ancestor other than its parent", async () => {
    const result = await capture(
      `<div data-slot="outer" style="position: relative; display: flex"><div data-slot="inner" style="display: flex"><div data-slot="dot" style="position: absolute; top: 0; left: 0; width: 4px; height: 4px; background-color: var(--ink)"></div></div></div>`
    )
    assert.deepEqual(result.unsupported, [
      {
        layer: layerPath("outer > inner > dot"),
        property: "containing block",
        value: "outer",
      },
    ])
  })
})

describe("sizes", () => {
  test("in % and intrinsic keywords, and an aspect ratio, are emitted as written", async () => {
    const result = await capture(
      `<div style="display: flex; flex-direction: column; width: 200px; height: 60px"><div data-slot="half" style="width: 50%; height: 25%"></div><div data-slot="fit" style="width: fit-content; line-height: 16px">Fit</div></div><div data-slot="ratio" style="display: flex; height: var(--size-sm); aspect-ratio: 16 / 9"></div>`
    )
    assert.deepEqual(
      {
        half: styleOf(result, "half"),
        fit: styleOf(result, "fit"),
        ratio: styleOf(result, "ratio"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        half: "flex-shrink: 1; width: 50%; height: 25%",
        fit: "flex-shrink: 1; width: fit-content; font-family: Geist, system-ui, sans-serif; line-height: 16px",
        ratio:
          "display: flex; flex-shrink: 1; height: var(--size-sm); aspect-ratio: 16 / 9",
        unsupported: [],
        offline: [],
      }
    )
  })

  test("are pinned to the px used where Paper would round a % or wrap min-content text", async () => {
    const result = await capture(
      `<div style="display: flex; flex-direction: column; width: 201px"><div data-slot="half" style="width: 50%; height: 10px"></div><div data-slot="min" style="width: min-content; font-size: 12px; line-height: 16px">Two words</div></div>`
    )
    assert.deepEqual(
      {
        half: styleOf(result, "half"),
        min: styleOf(result, "min").split("; ").slice(0, 2),
        offline: result.offline,
      },
      {
        half: "flex-shrink: 1; width: 100.5px; height: 10px",
        min: ["flex-shrink: 1", "width: 33.61px"],
        offline: [],
      }
    )
  })
})

describe("overflow", () => {
  test("that clips, truncates or wraps is emitted, and reproduces the layout", async () => {
    const result = await capture(
      `<div style="display: flex; width: 100px"><div data-slot="clipped" style="display: flex; overflow: hidden"><div style="width: 200px; height: 10px; flex-shrink: 0"></div></div></div><div data-slot="truncated" style="width: 80px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; line-height: 20px">A long label that will not fit</div><div data-slot="broken" style="width: 50px; overflow-wrap: break-word; line-height: 20px">Supercalifragilistic</div>`
    )
    assert.deepEqual(
      {
        clipped: styleOf(result, "clipped"),
        truncated: styleOf(result, "truncated"),
        broken: styleOf(result, "broken"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        clipped:
          "display: flex; min-width: 0px; min-height: 0px; overflow: clip",
        truncated:
          "flex-shrink: 1; width: 80px; min-width: 0px; min-height: 0px; overflow: clip; text-overflow: ellipsis; font-family: Geist, system-ui, sans-serif; line-height: 20px; white-space: nowrap",
        broken:
          "flex-shrink: 1; width: 50px; font-family: Geist, system-ui, sans-serif; line-height: 20px; overflow-wrap: break-word",
        unsupported: [],
        offline: [],
      }
    )
  })
})

describe("effects", () => {
  test("that move, turn, filter, isolate or hide are emitted, and reproduce the layout", async () => {
    const result = await capture(
      `<div data-slot="turned" style="width: 40px; height: 20px; transform: rotate(45deg)"></div><div data-slot="moved" style="width: 40px; height: 20px; translate: 50% var(--space-1); rotate: 90deg"></div><div data-slot="blurred" style="width: 40px; height: 20px; filter: blur(2px); backdrop-filter: blur(4px); isolation: isolate; visibility: hidden"></div>`
    )
    assert.deepEqual(
      {
        turned: styleOf(result, "turned"),
        moved: styleOf(result, "moved"),
        blurred: styleOf(result, "blurred"),
        bindings: bindingsAt(result, "moved"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        turned:
          "flex-shrink: 1; width: 40px; height: 20px; transform: rotate(45deg)",
        moved:
          "flex-shrink: 1; width: 40px; height: 20px; rotate: 90deg; translate: 50% var(--space-1)",
        blurred:
          "flex-shrink: 1; width: 40px; height: 20px; filter: blur(2px); backdrop-filter: blur(4px); isolation: isolate; visibility: hidden",
        bindings: ["translate --space-1"],
        unsupported: [],
        offline: [],
      }
    )
  })
})

describe("text", () => {
  test("numbers, wrapping and decoration are emitted with their tokens", async () => {
    const result = await capture(
      `<div data-slot="clock" style="font-variant-numeric: tabular-nums; line-height: 20px">10:45</div><div data-slot="heading" style="width: 120px; text-wrap: balance; line-height: 20px">A heading that wraps onto two lines</div><div data-slot="link" style="text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 4px; line-height: 20px; color: var(--ink)">Link</div><div data-slot="plain" style="text-decoration: underline; line-height: 20px; color: var(--ink)">Plain</div>`
    )
    assert.deepEqual(
      {
        clock: styleOf(result, "clock"),
        heading: styleOf(result, "heading"),
        link: styleOf(result, "link"),
        plain: styleOf(result, "plain"),
        bindings: bindingsAt(result, "link"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        clock:
          "font-family: Geist, system-ui, sans-serif; line-height: 20px; font-variant-numeric: tabular-nums",
        heading:
          "flex-shrink: 1; width: 120px; font-family: Geist, system-ui, sans-serif; line-height: 20px; text-wrap-style: balance",
        link: "color: var(--ink); font-family: Geist, system-ui, sans-serif; line-height: 20px; text-decoration-line: underline; text-decoration-color: var(--line); text-decoration-thickness: auto; text-underline-offset: 4px",
        plain:
          "color: var(--ink); font-family: Geist, system-ui, sans-serif; line-height: 20px; text-decoration-line: underline; text-decoration-thickness: auto",
        bindings: ["color --ink", "text-decoration-color --line"],
        unsupported: [],
        offline: [],
      }
    )
  })

  test("leaves out vertical-align on a flex item, where it does nothing", async () => {
    const result = await capture(
      `<div style="display: flex"><div data-slot="icon" style="vertical-align: middle; width: 10px; height: 10px"></div></div>`
    )
    assert.deepEqual(result.unsupported, [])
  })
})

describe("backgrounds", () => {
  test("of gradients are emitted with their size, position and repeat, in every layer", async () => {
    const result = await capture(
      `<div data-slot="checker" style="width: 64px; height: 24px; background-image: linear-gradient(rgb(34, 197, 94), rgb(34, 197, 94)), repeating-conic-gradient(rgb(226, 226, 224) 0deg 25%, rgb(255, 255, 255) 0deg 50%); background-size: 16px 100%, 8px 8px; background-repeat: no-repeat, repeat"></div><div data-slot="tiles" style="width: 120px; height: 20px; background-image: linear-gradient(to right, red, blue); background-size: 50% 100%; background-position: 10px 0px"></div>`
    )
    assert.deepEqual(
      {
        checker: styleOf(result, "checker"),
        tiles: styleOf(result, "tiles"),
        unsupported: result.unsupported,
        offline: result.offline,
      },
      {
        checker:
          "flex-shrink: 1; width: 64px; height: 24px; background-image: linear-gradient(rgb(34 197 94), rgb(34 197 94)), repeating-conic-gradient(rgb(226 226 224) 0deg, rgb(226 226 224) 25%, rgb(255 255 255) 0deg, rgb(255 255 255) 50%); background-size: 16px 100%, 8px 8px; background-position: 0% 0%, 0% 0%; background-repeat: no-repeat, repeat",
        tiles:
          "flex-shrink: 1; width: 120px; height: 20px; background-image: linear-gradient(to right, rgb(255 0 0), rgb(0 0 255)); background-size: 50% 100%; background-position: 10px 0px; background-repeat: repeat",
        unsupported: [],
        offline: [],
      }
    )
  })

  test("of gradients in another space are emitted, and recorded where Paper interpolates them in oklab", async () => {
    const result = await capture(
      `<div data-slot="fade" style="width: 120px; height: 20px; background-image: linear-gradient(to right, red, blue)"></div><div data-slot="linear" style="width: 120px; height: 20px; background-image: linear-gradient(in srgb-linear, red, blue), radial-gradient(in oklab, red, blue)"></div><div data-slot="sized" style="width: 120px; height: 20px; background-image: linear-gradient(to right, red, blue); background-size: 50% 100%"></div><div data-slot="solid" style="width: 120px; height: 20px; background-image: linear-gradient(red, red), linear-gradient(in oklab, red, blue)"></div>`
    )
    assert.deepEqual(
      {
        fade: styleOf(result, "fade"),
        unsupported: result.unsupported,
      },
      {
        fade: "flex-shrink: 1; width: 120px; height: 20px; background-image: linear-gradient(to right, rgb(255 0 0), rgb(0 0 255)); background-size: auto; background-position: 0% 0%; background-repeat: repeat",
        unsupported: [
          { layer: layerPath("fade"), property: "gradient", value: "in srgb" },
          {
            layer: layerPath("linear"),
            property: "gradient",
            value: "in srgb-linear",
          },
        ],
      }
    )
  })

  test("that Paper turns into a colour are recorded", async () => {
    const result = await capture(
      `<div data-slot="rule" style="width: 120px; height: 20px; background-image: linear-gradient(var(--line), var(--line)); background-size: 100% 1px; background-repeat: no-repeat"></div>`
    )
    assert.deepEqual(unsupportedAt(result, "rule"), [
      "background-image",
      "background-repeat",
      "background-size",
    ])
    assert.equal(
      styleOf(result, "rule"),
      "flex-shrink: 1; width: 120px; height: 20px"
    )
  })
})

describe("flex-shrink", () => {
  test("is emitted on a sized element, which Paper would stop shrinking", async () => {
    const result = await capture(
      `<div style="display: flex; width: 60px"><div data-slot="bar" style="width: 200px; height: 8px"></div></div>`
    )
    assert.equal(
      styleOf(result, "bar"),
      "flex-shrink: 1; width: 200px; height: 8px"
    )
  })
})
