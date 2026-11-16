# Paper kit plan

The ui-sdk catalogue in Paper, generated from this repo.

**Status.** Executing since 2026-11-15, on Mark's request. Endpoint: ready for human review. See Progress.
**Updated.** 2026-11-16. **Owner.** Mark Vella. **Base.** `fa82f52bfde4205085322a7bf40eb4d838faf166` on `t3/plan-paper-ui-sdk-catalogue`.

## Intent

**Goal.** Every ui-sdk component is in the Paper file `vercel/ui` as real HTML nodes, in an organised kit that a person or an agent can navigate by name. Code is the source of truth. Paper is the visual layer.

**Problem.** The catalogue is 55 components and 574 web examples. Paper takes a narrow HTML subset and has no reusable components yet. Importing by hand, one tool call at a time, is slow and drifts from the code on the first style change.

**Outcome.** One command regenerates the kit from the repo. A second run changes nothing.

**Success signal.** `node paper/verify.mjs` exits 0. It checks the page list, the tokens, one artboard per component, that Paper's own export of each frame reproduces its capture with nothing dropped, and that a repeat sync makes zero writes.

**Endpoint.** Ready for human review. Merging needs its own request.

## How the import works

The import is codemode. Programs make the tool calls. The model does not make them one at a time.

Two shapes were compared.

| Shape                      | How HTML reaches Paper                                                                                                            | Result                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A. Agent writes each frame | The model reads the CSS and types HTML into `write_html`, call by call                                                            | Rejected. Thousands of calls, every frame is the model's reading of the CSS, no rerun. |
| B. Codemode                | A browser renders the real examples and a program flattens them to Paper's subset. A second program calls Paper's tools in loops. | Chosen. Rerunnable. The code stays the only source.                                    |

Two runners can execute the sync program.

| Runner                                                     | Reads files from disk         | State on 2026-11-15                                                                | Use                                                                                          |
| ---------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Local Node program over `paper mcp`                        | Yes                           | Verified for reads                                                                 | The default. Required for component frames, whose HTML lives in `paper/out/`.                |
| Sandboxed codemode in the harness, T3 Code's or Executor's | Executor no. T3 Code unknown. | No T3 Code codemode tool was visible in the planning session. Executor is stopped. | Work whose payload the program computes itself: pages, tokens, Foundations, renames, audits. |

The file question decides the split. A sandbox that cannot read `paper/out/` needs the flattened HTML pasted into the program, so every byte passes through the model. A sandbox that can read it may run the whole sync.

```text
examples/components/<name>/web/*.ts     the real <ui-*> elements
examples/styles + <name>.css            the real styles and tokens
        |
        |  node paper/capture.mjs       Chromium renders each example, then flattens it
        v
paper/out/<name>/<example>.html         inline styles, flex only, var(--token) bindings
paper/out/manifest.json                 names, source hashes, sizes, unsupported cases
        |
        |  node paper/sync.mjs          spawns `paper mcp`, reads the file, writes only differences
        v
Paper file vercel/ui                    pages, tokens, artboards, named layers
        |
        |  node paper/verify.mjs        exit 0 or a list of what differs
```

**Capture.** It reuses the web examples build (`node examples/scripts/build.mjs web styles`) and its `styles.json`, which already lists the stylesheets each example needs. It mounts each example under a `[data-example]` host in Chromium through the Playwright that `tests/` already depends on.

**Flatten.** Paper's guide asks for inline styles and flex layout, and says not to use margin, grid, tables or `display: inline`. Measured in U2, Paper does render margin, grid and absolute position, and does not render tables. U4 decides for each kind whether to pass the CSS through or convert it. Paper runs no scripts, so a `<ui-button>` never upgrades. The flattener turns the live DOM into what Paper takes.

- Custom elements and native controls become `div`. A `display: contents` wrapper is hoisted away.
- Flex stays flex. Any other layout converts to flex when the conversion is exact. Otherwise the children are placed absolutely at measured offsets and the example is flagged `absolute-fallback`.
- A pseudo-element that paints becomes a child `div`.
- A popup in the top layer is captured into the same frame at its measured offset.
- Each layer is named after its `data-slot`.
- Whatever the flattener does not emit, and that would change how an element paints or lays out, is named in the sidecar's `unsupported` list. Every element is compared with a plain `div`, because that is what Paper receives. Nothing is lost without a record.

**Token binding.** Computed styles lose the `var()` reference. The capture gets it back by swapping each token for a unique sentinel value on the live DOM, reading which property received which sentinel, then removing the override. A literal the CSS authored as a literal stays a literal. A use inside `calc()` is reported as unbound.

**Sync.** It reads the Paper file first, matches pages and artboards by name, and compares each frame's recorded source hash. It writes only what differs. It never deletes. Anything it does not own is reported, not touched. Before its first write it checks that Paper has the kit pages and every token the frames use, and stops with one line if not.

**Verify.** It does not model Paper. It reads Paper's own export of a frame with `get_jsx`, renders that export in the same Chromium that made the capture, measures it with the same code, and compares the result with the capture's sidecar: sizes exactly, token bindings property by property, and literal colours. Every recorded drop is a difference. So is a duplicated frame name or a hidden layer. This works on a page nobody is viewing. It does not judge Paper's own text drawing, which comes out up to about 2px larger than a browser's. The saved Paper screenshot is there for a person to look at.

## The Paper file

| Page             | Icon         | Content                                                                                   |
| ---------------- | ------------ | ----------------------------------------------------------------------------------------- |
| `00 Cover`       | info         | Package version, git SHA, how to use, links to the repo and docs                          |
| `01 Foundations` | swatches     | Artboards `color`, `type`, `spacing`, `size`, `radius`, `elevation`, each bound to tokens |
| `02 Components`  | design       | One artboard per component, alphabetical, named as its folder                             |
| `03 Patterns`    | blueprint    | Scaffold only                                                                             |
| `04 Templates`   | presentation | Scaffold only                                                                             |
| `99 Playground`  | paper        | Free. Sync never writes here.                                                             |

A divider sits after `01 Foundations` and before `99 Playground`. The existing `Page 1` is renamed to `00 Cover`.

**Names.** They are the same strings the code and docs already use.

- Artboard: `select`, matching `examples/components/select/`.
- Variant frame: `select/groups`, matching `examples/components/select/web/groups.ts` and `<ComponentExample name="select/groups">` in the docs.
- State frame: `select/groups@open`.
- Part layer: the `data-slot` value.

Each variant frame carries a caption text node equal to its name. `find_nodes` searches styles and text, not layer names, so the caption is what makes `find_nodes({ textValue: "select/groups" })` work.

**Tokens.** Names are kept verbatim from `examples/styles/tokens.css` (`--ink`, `--surface-1`, `--radius-control`, `--space-2`). Values are the light scheme, resolved in the browser. Shadows and `--duration` have no Paper token type, so they are written as literals and shown on the `elevation` artboard.

**Generated pages are output.** Pages `00` to `02` are regenerated from code. Exploration happens in `99 Playground`, on a duplicate.

**Chrome.** The cover, artboard headers and captions use the kit's own tokens and Geist. The kit brings no second palette.

## Scope

**In.** All 55 components from `apps/docs/content/docs/web-components/components/`. The variants are the examples the docs reference, deduplicated by rendered output, plus the states each component has. Tokens. Foundations. Cover. The three scripts. A README and agent rules under `paper/`.

**Out, with the evidence that would add it.**

- A separate `ui-kit/` folder with rebuilt components. `@ui-sdk/web` ships the elements and `examples/styles` holds 10,494 lines of working CSS. A second copy would be a second source. Add it when the kit must be published or forked apart from this repo.
- `03 Patterns` and `04 Templates` content. The SDK catalogue has none. Add when composed examples exist in code.
- Dark theme. Paper tokens show no modes. Add by cloning the file and overriding the colour tokens with `set_tokens`. The same path serves per-project forks.
- React, Vue, Svelte and Solid variants. The rendered output is the same.
- Paper to code. Turning a Playground frame into a component is a later workflow on `get_jsx`.
- `examples/behaviors` and `examples/experiments`. They are not in the components catalogue.

## Units

| ID  | Outcome                                                                                                             | Needs  | Check that can fail                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U0  | Preflight. Dependencies installed, Chromium present, Paper Desktop open on the file, roles resolved, runner chosen. | none   | `pnpm install` exits 0. The stdio probe lists Paper's tools. `orchestrator_capabilities` names an Opus 5.5 high selection. The tool catalog is searched once for a codemode tool and the result is recorded.                                      |
| U1  | Tokens from code are in Paper. The MCP client and the read, diff, write pattern exist.                              | U0     | `verify tokens` exits 0, meaning every code token matches Paper by name, type and value. Tokens only in Paper are listed, not failed. A second `sync tokens` makes 0 writes.                                                                      |
| U2  | Tracer. `button/basic` goes capture, flatten, sync, into a scratch Paper file.                                      | U1     | `verify components button/basic` exits 0: Paper's export of the frame reproduces the capture in size, bindings and literal colours, with nothing recorded as dropped. A second sync makes 0 writes. An edit made in Paper is caught and repaired. |
| U3  | Census. Every web example is rendered once and classified.                                                          | U2     | `paper/out/census.json` accounts for all 574 files with a status, a dedupe hash and its unsupported cases. No file is missing.                                                                                                                    |
| U4  | The flattener handles each case class the census found.                                                             | U3     | One representative per class passes the U2 checks in the scratch file. The census rerun shows no unhandled class.                                                                                                                                 |
| U5  | State recipes. Each component lists its variants and states, with the steps that reach them.                        | U4     | `capture <component>` exits 0 and its contact sheet shows every listed frame.                                                                                                                                                                     |
| U6  | The page list exists in the kit file.                                                                               | U1     | `get_basic_info` returns the six pages and two dividers in order. A second run makes 0 writes.                                                                                                                                                    |
| U7  | Foundations artboards are generated from the token list.                                                            | U6     | Every token the code defines has a specimen bound to it on `01 Foundations`. `verify foundations` exits 0 and a second sync makes 0 writes.                                                                                                       |
| U8  | Every component is synced, in alphabetical batches.                                                                 | U5, U6 | Artboard count equals 55. Every frame passes `verify components`, with nothing recorded as dropped. A second sync makes 0 writes.                                                                                                                 |
| U9  | Cover, `paper/README.md` and `paper/AGENTS.md`.                                                                     | U8     | The cover shows the package version and SHA that the manifest records. The README commands run as written.                                                                                                                                        |
| U10 | Delivery gate.                                                                                                      | all    | `node paper/verify.mjs` exits 0. Exported screenshots of sampled artboards are attached for human review.                                                                                                                                         |

**Order.** U1 comes first because it is the thinnest full slice from code to Paper and it proves the script write path. U2 settles the riskiest assumption, that flattened HTML renders faithfully. Nothing multiplies before U2 passes.

**Parallel candidates.** After U1, the chain U2, U3, U4 and the chain U6, U7 touch different paths (`paper/capture*` against `paper/sync*` structure and foundations) and different Paper files (scratch against kit). U5 fans out by alphabetical slice, one writer per `paper/recipes/<component>.mjs`, against a recipe shape the coordinator freezes first. The slice count is sized from the census.

**One Paper writer.** Paper Desktop is one shared resource. Only the sync owner writes to the kit file, and only one sync runs at a time. Workers produce local HTML and contact sheets.

**Recipes are exceptions.** The default recipe is generated: each deduplicated docs example, plus default, hover, focus-visible and disabled where the root part has them. A hand-written recipe exists only where the default is wrong, such as a popup that must be opened. Capture drives those steps through `@ui-sdk/core/agent` where it can.

## Delivery

A stack of four PRs on the fork's `main`. The coordinator owns the stack.

| PR  | Units       | Reviewable alone because                                                 |
| --- | ----------- | ------------------------------------------------------------------------ |
| 1   | U1, U2      | It proves the approach on one component. Small diff.                     |
| 2   | U6, U7      | A visible result, the pages and Foundations, that needs only PR 1.       |
| 3   | U3, U4, U5  | Capture coverage. It touches `paper/capture*` and `paper/recipes/` only. |
| 4   | U8, U9, U10 | The full run, the docs and the gate.                                     |

PR 3 work may start from PR 1's head in its own worktree while PR 2 is in review. The coordinator restacks it onto PR 2. Their paths are disjoint. Paper writes are not in any diff, so each PR's Verification section carries the verify output and exported screenshots.

## Roles and checks

| Role                                        | Selection                                                                                                                                                                                          | Source                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Coordinator                                 | The session that runs the kickoff                                                                                                                                                                  | inherits                                       |
| Worker, fixer, reviewer, recheck, decomment | Opus 5.5 (`claude-opus-5-5`), effort high, through T3 `delegate_task`                                                                                                                              | run statement "t3code opus 5.5 high subagents" |
| Effect reviewer                             | Not run. The scripts are plain Node with no Effect code.                                                                                                                                           | plan decision                                  |
| Framework expert                            | `web-expert` may be consulted on custom-element handling in U2. `ui-sdk-expert-review` runs only if a unit edits `examples/`, `packages/`, specs or docs. `node scripts/expert-scope.mjs` decides. | `AGENTS.md`                                    |

The exact provider instance for Opus 5.5 high is a kickoff obligation, resolved from `orchestrator_capabilities`.

**Per unit.** A fresh worker, then a fresh report-only reviewer on a frozen commit, then fixer and recheck when needed. The coordinator reruns the unit's check itself before advancing.

**Repo rules that bind the workers.** Write with `ui-sdk-write-code`. Run `ui-sdk-unslop` on the diff. `pnpm lint` and `pnpm format` pass. Scripts are `.mjs`, as in `scripts/`. Browser runs go through `scripts/test-slot.sh`. Any server sets its own port. No new dependency. No edit to shipped packages.

**Return to design when.**

- U2 fails parity twice on the same premise. The fallback to weigh is absolute placement for every frame.
- Paper refuses script-driven writes. The fallback is the same payloads sent through a sandboxed codemode tool or agent tool calls.
- `02 Components` becomes slow to open. The fallback is alphabetical page ranges.

## Evidence

| Claim                                               | Observation                                                                                                                                                                        | When and where                                                   | Status                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Paper file is empty                             | `open_file` returned 1 page `Page 1`, 0 artboards, 0 tokens                                                                                                                        | 2026-11-15, file `01M7F5MBD4CPPWD9P0G739TERM`                    | supported                                                                                                                                                |
| A Node script can call Paper's MCP without an agent | Spawned `~/.paper/bin/paper mcp`. `initialize` answered `paper-desktop 0.0.1`. `tools/list` returned 41 tools. `get_basic_info` answered in 49 ms.                                 | 2026-11-15, read calls only                                      | supported for reads and writes. U1 created and updated tokens through it.                                                                                |
| Paper's HTML subset                                 | `write_html` description: inline styles, flex, no margin, grid, tables or `display: inline`                                                                                        | 2026-11-15                                                       | superseded by U2's probes: Paper never errors, drops what it cannot parse, and renders margin, grid and absolute position. Tables become stacked frames. |
| Catalogue size                                      | 55 docs pages, 54 example folders, 574 web example files, 502 examples referenced by the web docs                                                                                  | `fa82f52`, shell counts                                          | supported                                                                                                                                                |
| The CSS needs flattening                            | Source lines across `examples/styles` and component CSS: grid 39, margin 153, pseudo-elements 29, `position: fixed` 5, of 10,494 lines                                             | `fa82f52`, `grep -c`                                             | supported. These count source lines, not rendered elements. U3 gives the rendered count.                                                                 |
| Fonts                                               | `get_font_family_info` lists Geist and Geist Mono, weights 100 to 900                                                                                                              | 2026-11-15                                                       | supported                                                                                                                                                |
| `time-input` has no example folder                  | Its docs page uses `date-input/time` and `date-input/hour-cycle`                                                                                                                   | `fa82f52`                                                        | supported                                                                                                                                                |
| Executor is unavailable now                         | `executor service status` printed `stopped`. Nothing listens on 4312.                                                                                                              | 2026-11-15                                                       | supported                                                                                                                                                |
| Paper is registered in Executor                     | Not checked. The service is stopped.                                                                                                                                               |                                                                  | blocked                                                                                                                                                  |
| T3 Code exposes a codemode tool                     | A tool search for codemode, execute and sandbox returned no T3 tool. `t3 --help` lists no such subcommand.                                                                         | 2026-11-15, planning session                                     | missing. U0 rechecks in the execution session.                                                                                                           |
| Dependencies                                        | No `node_modules` in this worktree                                                                                                                                                 | 2026-11-15                                                       | supported. U0 installs them.                                                                                                                             |
| Verify needs no model of Paper                      | Paper's `get_jsx` export, rendered in the same Chromium, matched the capture to 0.000px on seven correct frames and caught six of six deliberate errors. Rerun by the coordinator. | 2026-11-15, `.swe-mode/paper-kit/reports/U2-premise-research.md` | supported on 11 frames from 3 components. U3 and U4 test the rest.                                                                                       |
| Paper measures only the page a person is viewing    | `get_node_info` sizes are null on other pages. `get_jsx` returns full styles on any page.                                                                                          | 2026-11-15, same report                                          | supported                                                                                                                                                |
| Paper tokens have no light and dark modes           | No mode field in the `create_tokens` or `set_tokens` schemas                                                                                                                       | 2026-11-15                                                       | inferred                                                                                                                                                 |
| A page can hold the full catalogue                  | Not measured                                                                                                                                                                       |                                                                  | missing. U8's first batch shows it.                                                                                                                      |

## Decisions

| Decision                            | Options                                                                                            | Chosen and why                                                                                                                               | Who                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Import mechanism                    | A, B, C above                                                                                      | C. It is the only one where no payload passes through a model and a rerun converges.                                                         | agent, reversible         |
| Kit source                          | New `ui-kit/` or existing `examples/`                                                              | `examples/`. It already holds the tokens and styles for every component.                                                                     | agent, pending Mark       |
| Variant set                         | All 574 files or docs-referenced, deduplicated                                                     | Docs-referenced, deduplicated, plus states. The docs already curate and caption them.                                                        | agent, pending Mark       |
| Page layout                         | One components page or one per category                                                            | One page, alphabetical. The docs have no categories, so any grouping would be invented.                                                      | agent, reversible         |
| Theme                               | Light, or light and dark                                                                           | Light.                                                                                                                                       | agent, pending Mark       |
| Tracer target                       | Kit file or a scratch file                                                                         | A scratch file named `ui-sdk probe`, archived when U2 passes. Archiving is reversible.                                                       | agent, pending Mark       |
| Tokens only in Paper                | Fail `verify`, or list them                                                                        | List them. `sync` never deletes, so failing would leave `verify` red for good. The cost: a token renamed in code leaves its old name behind. | agent, reviewer agreed    |
| Type of `--size-*`                  | `spacing` or `container`                                                                           | `spacing`. Both kept the binding, but Paper's Tailwind export lost it for `container`.                                                       | agent, from a probe in U1 |
| How verify compares                 | A model of Paper's rounding, property names and search, or a round trip through Paper's own export | The round trip. Six verify failures across two fix rounds shared the model premise, and a research pass refuted it.                          | agent, from research      |
| What fails verify                   | Size and binding differences only, or every recorded drop too                                      | Every recorded drop. A frame that lost something is not a faithful import.                                                                   | agent, from review        |
| A duplicated frame                  | Sync removes it, or verify reports it                                                              | Verify reports it and names the remedy. Sync never deletes.                                                                                  | agent, pending Mark       |
| A token used inside `calc()`        | Fails verify, or is reported                                                                       | Reported, not failed. It paints correctly. U4 first tests whether Paper can hold the `calc()` with the token inside.                         | agent, pending Mark       |
| U2's open should after three rounds | A fourth small round, or carry it into U4                                                          | Pending. The coordinator recommends the fourth round.                                                                                        | Mark                      |
| Sync runner                         | Local Node program, or a sandboxed codemode tool                                                   | Local Node program. It is verified and it reads `paper/out/`. A sandboxed runner takes the computed-payload units when one is available.     | agent, pending Mark       |

## Progress

**Resolution record.** Adapter `t3`, from a live `orchestrator_capabilities` answer on 2026-11-15. Coordinator: `claude-fable-5-2`, effort xhigh. Worker, fixer, reviewer, recheck and decomment: provider instance `claudeAgent`, model `claude-opus-5-5`, effort high, from the run statement. No codemode tool is in the session catalog, so the runner is the local Node program.

**Scratch file.** `ui-sdk probe`, id `01M7GC1T67A9KMGNTCM6JP4EB3`. Units U1 to U4 write there. The kit file is `01M7F5MBD4CPPWD9P0G739TERM`.

**Work folder.** `.swe-mode/paper-kit/` in this worktree, ignored locally. It holds briefs and reports.

| Unit | Status  | Head      | Notes                                                                                                                                                                                                                                                                                                                |
| ---- | ------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U0   | done    | `fa82f52` | `pnpm install --frozen-lockfile` exit 0. Chromium 153 launches through Playwright. Paper probe lists 41 tools. Defaults taken for the pending decisions.                                                                                                                                                             |
| U1   | done    | `f3d94ed` | 36 tokens synced to the scratch file, 7 skipped. Repeat sync makes 0 writes. Verify exits 0 and fails on drift. Review `APPROVE` on patch id `f5c98d8`.                                                                                                                                                              |
| U2   | open    | `b8b635b` | Three fix rounds, all used. Sync and verify lane: `APPROVE`. Capture lane: `REQUEST_CHANGES` on one should, every `<ul>` records a harmless `list-style-type none`. With Mark: a fourth small round, or carry it into U4. Six of nine buttons pass verify, and each red frame names its loss. 53 tests at this head. |
| U3   | pending |           | Waits on Mark's answer about U2.                                                                                                                                                                                                                                                                                     |
| U4   | pending |           |                                                                                                                                                                                                                                                                                                                      |
| U5   | pending |           |                                                                                                                                                                                                                                                                                                                      |
| U6   | done    | `466d73b` | Six pages and two dividers. Repeat sync makes 0 writes. Review `APPROVE` on patch id `568b546`. Merged with U2's dispatch code by the coordinator, rechecked with U2.                                                                                                                                                |
| U7   | done    | `3b24c84` | Six artboards on `01 Foundations`, 36 of 36 code tokens bound. Artboards land on named pages. Sync stops before writing when pages or tokens are missing. One fix round. Recheck `APPROVE` on whole patch id `f6eed36`. 66 tests.                                                                                    |
| U8   | pending |           |                                                                                                                                                                                                                                                                                                                      |
| U9   | pending |           |                                                                                                                                                                                                                                                                                                                      |
| U10  | pending |           |                                                                                                                                                                                                                                                                                                                      |

## Follow-ups

Deferred nits from review. None blocks a unit.

- `paper/paper-client.mjs`: `close()` waits forever if the relay ignores both stdin EOF and SIGTERM. Send SIGKILL and resolve after the grace period. From the U1 review.
- `paper/tokens.mjs`: the `--size` prefix has no trailing hyphen, and a colour named like `--text-muted` would be typed as a font size. From the U1 review.
- `paper/paper-client.mjs`: the line splitter assigns inside the `while` condition, and `failAll` leaves request timers running. From the U1 review.

### Deferred review findings, by owner

The briefs, reviews and dispositions are under `.swe-mode/paper-kit/` in the coordinator's checkout.

- **U3, census.** One failing example aborts a capture batch. An unknown example name crashes sync with a raw `ENOENT`. Count elements with `line-height: normal`, which is now emitted in px.
- **U4, coverage.** An `svg` sized or coloured by CSS. `direction: rtl`. Input values. Mixed text and element children. Built-in control drawing. A content-box sized element. Layer positions are not compared. `max()` and averaged tokens can bind the wrong token: bind only when the token's value equals the real value. A font-size token used in another property is not recorded as unbound. Colour or weight on a `display: contents` element that holds text. The tree parser breaks on a layer name containing `" (word)` and on text with a newline. Four flattener exceptions have no test. A harmless `position: relative` is recorded on the scroll-area thumb.
- **U8, full sync.** The provenance commit line is rewritten for every frame when one frame is written. A crash after `create_artboard` leaves a 400x400 artboard.
- **U10, delivery gate.** Verify passes when `paper/out` is stale against the code.
- **No owner yet.** `tokens`, `pages` and `foundations` ignore extra arguments. Verify names layers by DOM path in drop messages and by layer name elsewhere. A text label equal to a layer name confuses the round trip. `::first-letter` and `::first-line` styles are not recorded. The token guard misses tokens used only by the artboard and the provenance text.

## Artifact index

| Stage    | Artifact               | Status  | Next action                         |
| -------- | ---------------------- | ------- | ----------------------------------- |
| Shape    | Intent and Scope above | ready   | Mark confirms the pending decisions |
| Design   | How the import works   | ready   | U2 tests the flatten premise        |
| Plan     | This file              | ready   | An execution request                |
| The Loop | None yet               | pending | U0                                  |

## Kickoff prompt

**NOT STARTED.** This prompt is prepared. It is not permission to run.

```text
/swe-mode t3code opus 5.5 high subagents

Execute the plan at paper/PLAN.md in this repository, to the endpoint "ready for human review".

Goal: every ui-sdk component is in the Paper file vercel/ui as real HTML nodes, generated from this
repo by rerunnable scripts, organised into named pages and artboards and bound to design tokens.

Paper file: https://app.paper.design/file/01M7F5MBD4CPPWD9P0G739TERM/p-1-0
Plan base: fa82f52bfde4205085322a7bf40eb4d838faf166. Resolve the current base before U1 and record it.
If the base moved, recheck the Evidence rows that name it.

Preflight (U0) before any dispatch:
1. pnpm install, then install Chromium for Playwright.
2. Confirm Paper Desktop is open on the file and the stdio probe lists Paper's tools.
3. Call orchestrator_capabilities once and record the exact Opus 5.5 high selection.
4. Search the tool catalog once for a codemode tool. If one exists, record whether its sandbox can read
   paper/out, then choose the runner per the plan's runner table.
5. Confirm the decisions marked "pending Mark" in the plan, or proceed on the listed defaults.

Then enter The Loop at U1. Follow the unit order, the one-Paper-writer rule and the PR stack in the plan.
Write each brief and report under the session's durable work folder and record the paths in the plan's
artifact index. Do not write to the kit file before U2 passes. Never delete Paper nodes, pages or tokens.
Stop and report if a "Return to design when" condition holds.
```
