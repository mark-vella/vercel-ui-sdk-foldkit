# paper

Programs that put the ui-sdk catalogue into a Paper design file, as real HTML nodes bound to the kit's tokens. Code is the source of truth. The Paper file is output: one command regenerates it, and a second run changes nothing.

[PLAN.md](PLAN.md) records how it works, what was measured, and what is still open.

## What it makes

| Page             | Content                                                   |
| ---------------- | --------------------------------------------------------- |
| `00 Cover`       | Empty for now                                             |
| `01 Foundations` | `color`, `type`, `spacing`, `size`, `radius`, `elevation` |
| `02 Components`  | One artboard per component, in an alphabetical grid       |
| `03 Patterns`    | Empty                                                     |
| `04 Templates`   | Empty                                                     |
| `99 Playground`  | Yours. Sync never writes here                             |

A component artboard is named after its folder, `select`. It holds a header, one frame per example, three to a row, and a text block last. A frame is named after its example, `select/groups`, and each layer after its `data-slot`.

The text block says, for each frame, the commit it was captured at and either `exact` or what it loses. A frame that loses something still looks like its example where it can. It lists what Paper could not hold.

## Before you run it

- Paper Desktop is running, with the file open. The programs talk to it through `~/.paper/bin/paper`. Set `PAPER_BIN` to use another path.
- `pnpm install` has run.
- The web examples are built: `cd examples && node scripts/build.mjs web styles`.
- You have the file's id, the part after `/file/` in its URL.

Every command that opens a browser runs through `scripts/test-slot.sh`.

## Regenerate the kit

Capture every example. This takes about twelve minutes and writes `paper/out`, which git ignores.

```sh
scripts/test-slot.sh node paper/census.mjs
```

Then write the file, in this order.

```sh
node paper/sync.mjs tokens --file <id>
node paper/sync.mjs pages --file <id>
scripts/test-slot.sh node paper/sync.mjs foundations --file <id>
node paper/sync.mjs components --all --file <id>
```

Each command prints its number of writes. Run it again and it prints `writes 0`. Sync never deletes, and it leaves alone anything it did not make.

To work on a few examples, name them:

```sh
scripts/test-slot.sh node paper/capture.mjs select/groups select/rtl
node paper/sync.mjs components select/groups select/rtl --file <id>
```

## Check the kit

```sh
node paper/verify.mjs tokens --file <id>
node paper/verify.mjs pages --file <id>
scripts/test-slot.sh node paper/verify.mjs foundations --file <id>
scripts/test-slot.sh node paper/verify.mjs components --all --file <id>
```

Verify does not model Paper. It reads Paper's own export of each frame, draws it in the same Chromium that made the capture, and compares sizes, token links, colours and the picture, with no tolerance.

For components it ends with three counts:

- frames that match with nothing recorded,
- frames that differ only by what they record as lost,
- frames that differ in a way nothing records.

It exits 0 only when no frame differs. The third count is the one that means the kit is wrong. A frame whose only loss is a token link has no difference: the link is printed as a note, and the frame is counted in the second group.

## What Paper cannot hold

These stay recorded on the frame that has them:

- a layer at `opacity: 0`, such as a slider's hidden range input,
- a native range input, a textarea's resize grabber, password masking,
- a gradient Paper rewrites, a canvas, a remote image,
- bold that the browser fakes for a font with no bold, and a different fallback font,
- a colour mixed from two tokens, which keeps its colour and loses the link,
- a frame with more than 2,500 layers, which is not imported at all.

A popup is captured closed. Open states are not built yet.

## How the capture differs from the docs site

The capture draws each example as the docs site does, at the same 32rem width, in the light theme. `DOCS_PORT=<port> scripts/test-slot.sh node paper/compare-docs.mjs` checks that every docs example has the same size in both. Four things differ on purpose:

- corners stay rounded,
- `overscroll-behavior` is off, and the browser runs with `--disable-prefer-compositing-to-lcd-text`, because each changes how Chromium smooths a scroller's edge,
- the clock is fixed at one date, so a calendar's "today" does not move between runs,
- requests to other origins are blocked.

## Tests

```sh
scripts/test-slot.sh node --test paper/test/*.test.mjs
```
