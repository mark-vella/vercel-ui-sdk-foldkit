# Paper kit plan

The ui-sdk catalogue in Paper, generated from this repo.

**Status.** The kit file holds the whole catalogue as of 2026-11-19: 54 component artboards, 573 frames. Not done: the cover, the open states of popups, and delivery as pull requests. See Progress and "After the second pass".
**Updated.** 2026-11-19. **Owner.** Mark Vella. **Base.** `fa82f52bfde4205085322a7bf40eb4d838faf166` on `t3/plan-paper-ui-sdk-catalogue`.

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

| Claim                                                | Observation                                                                                                                                                                                                        | When and where                                                      | Status                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Paper file is empty                              | `open_file` returned 1 page `Page 1`, 0 artboards, 0 tokens                                                                                                                                                        | 2026-11-15, file `01M7F5MBD4CPPWD9P0G739TERM`                       | supported                                                                                                                                                |
| A Node script can call Paper's MCP without an agent  | Spawned `~/.paper/bin/paper mcp`. `initialize` answered `paper-desktop 0.0.1`. `tools/list` returned 41 tools. `get_basic_info` answered in 49 ms.                                                                 | 2026-11-15, read calls only                                         | supported for reads and writes. U1 created and updated tokens through it.                                                                                |
| Paper's HTML subset                                  | `write_html` description: inline styles, flex, no margin, grid, tables or `display: inline`                                                                                                                        | 2026-11-15                                                          | superseded by U2's probes: Paper never errors, drops what it cannot parse, and renders margin, grid and absolute position. Tables become stacked frames. |
| Catalogue size                                       | 55 docs pages, 54 example folders, 574 web example files, 502 examples referenced by the web docs                                                                                                                  | `fa82f52`, shell counts                                             | supported                                                                                                                                                |
| The CSS needs flattening                             | Source lines across `examples/styles` and component CSS: grid 39, margin 153, pseudo-elements 29, `position: fixed` 5, of 10,494 lines                                                                             | `fa82f52`, `grep -c`                                                | supported. These count source lines, not rendered elements. U3 gives the rendered count.                                                                 |
| Fonts                                                | `get_font_family_info` lists Geist and Geist Mono, weights 100 to 900                                                                                                                                              | 2026-11-15                                                          | supported                                                                                                                                                |
| `time-input` has no example folder                   | Its docs page uses `date-input/time` and `date-input/hour-cycle`                                                                                                                                                   | `fa82f52`                                                           | supported                                                                                                                                                |
| Executor is unavailable now                          | `executor service status` printed `stopped`. Nothing listens on 4312.                                                                                                                                              | 2026-11-15                                                          | supported                                                                                                                                                |
| Paper is registered in Executor                      | Not checked. The service is stopped.                                                                                                                                                                               |                                                                     | blocked                                                                                                                                                  |
| T3 Code exposes a codemode tool                      | A tool search for codemode, execute and sandbox returned no T3 tool. `t3 --help` lists no such subcommand.                                                                                                         | 2026-11-15, planning session                                        | missing. U0 rechecks in the execution session.                                                                                                           |
| Dependencies                                         | No `node_modules` in this worktree                                                                                                                                                                                 | 2026-11-15                                                          | supported. U0 installs them.                                                                                                                             |
| Verify needs no model of Paper                       | Paper's `get_jsx` export, rendered in the same Chromium, matched the capture to 0.000px on seven correct frames and caught six of six deliberate errors. Rerun by the coordinator.                                 | 2026-11-15, `.swe-mode/paper-kit/reports/U2-premise-research.md`    | supported on 11 frames from 3 components. U3 and U4 test the rest.                                                                                       |
| Paper measures only the page a person is viewing     | `get_node_info` sizes are null on other pages. `get_jsx` returns full styles on any page.                                                                                                                          | 2026-11-15, same report                                             | supported                                                                                                                                                |
| The capture does not quite match the docs site       | Measured on real docs pages at 1280px: 463 of 500 examples match in every layer. The rest differ through Tailwind's base styles (7), the docs' 32rem content width (19) and an unexplained `date-picker` gap (11). | 2026-11-16, `.swe-mode/paper-kit/reports/docs-fidelity-research.md` | supported. U4c fixes it.                                                                                                                                 |
| Verify does not see position, paint order or opacity | A reviewer's hand-built frames passed with 0 differences while Paper had changed the stacking, dropped a negative `z-index` and dropped a translate. No catalogue example reaches these today.                     | 2026-11-16, `.swe-mode/paper-kit/reports/U4a-review-emit.md`        | supported. U4v addresses it.                                                                                                                             |
| Paper tokens have no light and dark modes            | No mode field in the `create_tokens` or `set_tokens` schemas                                                                                                                                                       | 2026-11-15                                                          | inferred                                                                                                                                                 |
| A page can hold the full catalogue                   | Not measured                                                                                                                                                                                                       |                                                                     | missing. U8's first batch shows it.                                                                                                                      |

## Decisions

| Decision                                                     | Options                                                                                            | Chosen and why                                                                                                                                                                                                                                                                                                                                                            | Who                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Import mechanism                                             | A, B, C above                                                                                      | C. It is the only one where no payload passes through a model and a rerun converges.                                                                                                                                                                                                                                                                                      | agent, reversible         |
| Kit source                                                   | New `ui-kit/` or existing `examples/`                                                              | `examples/`. It already holds the tokens and styles for every component.                                                                                                                                                                                                                                                                                                  | agent, pending Mark       |
| Variant set                                                  | All 574 files or docs-referenced, deduplicated                                                     | Docs-referenced, deduplicated, plus states. The docs already curate and caption them.                                                                                                                                                                                                                                                                                     | agent, pending Mark       |
| Page layout                                                  | One components page or one per category                                                            | One page, alphabetical. The docs have no categories, so any grouping would be invented.                                                                                                                                                                                                                                                                                   | agent, reversible         |
| Theme                                                        | Light, or light and dark                                                                           | Light.                                                                                                                                                                                                                                                                                                                                                                    | agent, pending Mark       |
| Tracer target                                                | Kit file or a scratch file                                                                         | A scratch file named `ui-sdk probe`, archived when U2 passes. Archiving is reversible.                                                                                                                                                                                                                                                                                    | agent, pending Mark       |
| Tokens only in Paper                                         | Fail `verify`, or list them                                                                        | List them. `sync` never deletes, so failing would leave `verify` red for good. The cost: a token renamed in code leaves its old name behind.                                                                                                                                                                                                                              | agent, reviewer agreed    |
| Type of `--size-*`                                           | `spacing` or `container`                                                                           | `spacing`. Both kept the binding, but Paper's Tailwind export lost it for `container`.                                                                                                                                                                                                                                                                                    | agent, from a probe in U1 |
| How verify compares                                          | A model of Paper's rounding, property names and search, or a round trip through Paper's own export | The round trip. Six verify failures across two fix rounds shared the model premise, and a research pass refuted it.                                                                                                                                                                                                                                                       | agent, from research      |
| What fails verify                                            | Size and binding differences only, or every recorded drop too                                      | Every recorded drop. A frame that lost something is not a faithful import.                                                                                                                                                                                                                                                                                                | agent, from review        |
| A duplicated frame                                           | Sync removes it, or verify reports it                                                              | Verify reports it and names the remedy. Sync never deletes.                                                                                                                                                                                                                                                                                                               | agent, pending Mark       |
| A token used inside `calc()`                                 | Fails verify, or is reported                                                                       | Reported, not failed. It paints correctly. U4 first tests whether Paper can hold the `calc()` with the token inside.                                                                                                                                                                                                                                                      | agent, pending Mark       |
| U2's last finding, a false `list-style` loss on every `<ul>` | Should or nit                                                                                      | Nit, deferred. Measured over all 574 examples: 60 frames carry the entry and none has it as its only drop. A fresh reviewer recaptured everything and agreed. One frame, `drawer/outlet`, is red only for false list entries of two kinds, `display list-item` and `list-style-type`, confirmed in Paper. U3 fixes both, since it is the next unit to edit the flattener. | agent, reviewer agreed    |
| Corners                                                      | Square, as the docs site paints them, or rounded, as the examples' CSS writes them                 | Rounded. The examples' CSS is the code people copy, and it binds its corners to the radius tokens on the Foundations page. The docs square them with one `!important` rule.                                                                                                                                                                                               | agent, pending Mark       |
| Frame width                                                  | Hug the content, or the docs' 32rem content width                                                  | The docs' width. 19 examples size their content as a share of it. Every frame is then at least 560px wide.                                                                                                                                                                                                                                                                | agent, pending Mark       |
| A remote resource in an example                              | Wait for it, serve a checked-in copy, or block it                                                  | Block it and record the loss. A capture that depends on the network can change with no change in code. A checked-in copy of the one image involved, a third party's avatar, is Mark's to choose.                                                                                                                                                                          | agent, pending Mark       |
| Sync runner                                                  | Local Node program, or a sandboxed codemode tool                                                   | Local Node program. It is verified and it reads `paper/out/`. A sandboxed runner takes the computed-payload units when one is available.                                                                                                                                                                                                                                  | agent, pending Mark       |

## Progress

**Resolution record.** Adapter `t3`, from a live `orchestrator_capabilities` answer on 2026-11-15. Coordinator: `claude-fable-5-2`, effort xhigh. Worker, fixer, reviewer, recheck and decomment: provider instance `claudeAgent`, model `claude-opus-5-5`, effort high, from the run statement. No codemode tool is in the session catalog, so the runner is the local Node program.

**Scratch files.** `ui-sdk probe`, id `01M7GC1T67A9KMGNTCM6JP4EB3`, `ui-sdk probe pages`, `01M7GD588B93A45SFHNMBJVRMX`, `ui-sdk probe review`, `01M7GF5MY6FQQ5MCWRMQZ6MQXN`, and `ui-sdk probe four`, `01M7JP29WCMEDZPPCDNWPKT8NC`. Units U1 to U4 and their reviews write there, one writer to a file. All four are archived at the end. The kit file is `01M7F5MBD4CPPWD9P0G739TERM`.

**Work folder.** `.swe-mode/paper-kit/` in this worktree, ignored locally. It holds briefs and reports.

| Unit | Status             | Head      | Notes                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U0   | done               | `fa82f52` | `pnpm install --frozen-lockfile` exit 0. Chromium 153 launches through Playwright. Paper probe lists 41 tools. Defaults taken for the pending decisions.                                                                                                                                                                                                       |
| U1   | done               | `f3d94ed` | 36 tokens synced to the scratch file, 7 skipped. Repeat sync makes 0 writes. Verify exits 0 and fails on drift. Review `APPROVE` on patch id `f5c98d8`.                                                                                                                                                                                                        |
| U2   | done               | `b8b635b` | Three fix rounds. Verify was rebuilt on a round trip in round 2. Both lanes `APPROVE`: sync and verify at the round 3 recheck, capture after one re-rating, answered by a fresh reviewer that recaptured all 574 examples. All 574 capture with exit 0, and 37 drop nothing. 53 tests at this head.                                                            |
| U3   | done               | `6ea8613` | `node paper/census.mjs` classifies all 574 examples in about nine minutes. One fix round. Recheck `APPROVE` on whole patch id `e695246`. Capture now waits for the page to settle. The false list losses are gone. 85 tests.                                                                                                                                   |
| U4   | done               | `c6677d0` | Two passes, seven lanes, two merges. 419 of 574 frames are faithful imports, and every one passes verify in Paper. 33 more lose only a token link. 44 of 54 components have a faithful frame. The capture's clock is fixed. 256 tests. A full census takes 11 min 46 s on a quiet machine.                                                                     |
| U5   | not started        |           | Popups are captured closed. Measured so far, in "After the second pass": a generic step opens 184 of the 209 examples that have a popup, and an open popup needs the frame to act as the viewport. A follow-up, on Mark's word.                                                                                                                                |
| U6   | done               | `466d73b` | Six pages and two dividers. Repeat sync makes 0 writes. Review `APPROVE` on patch id `568b546`. Merged with U2's dispatch code by the coordinator, rechecked with U2.                                                                                                                                                                                          |
| U7   | done               | `3b24c84` | Six artboards on `01 Foundations`, 36 of 36 code tokens bound. Artboards land on named pages. Sync stops before writing when pages or tokens are missing. One fix round. Recheck `APPROVE` on whole patch id `f6eed36`. 66 tests.                                                                                                                              |
| U8   | done               | `c6677d0` | U8a made the sync carry the whole catalogue: `--all`, each frame's losses in the artboard's text, a header, frames three to a row, artboards in an alphabetical grid. The kit file was filled on 2026-11-19: 789 writes, then 0 on a second run. The gate as first written, every frame passing with nothing dropped, is not met: see "After the second pass". |
| U9   | partly done        |           | `paper/README.md` and `paper/AGENTS.md` are written. The cover page is empty.                                                                                                                                                                                                                                                                                  |
| U10  | not met as written |           | `verify components --all` on the kit file exits 1: 419 frames match with nothing recorded, 149 differ only by what they record as lost, 6 differ in a way nothing records. `verify tokens`, `pages` and `foundations` exit 0. Exit 0 for components needs Mark's rule on content Paper cannot hold.                                                            |

## The census

Measured at `6ea8613` by `scripts/test-slot.sh node paper/census.mjs`. The data is `paper/out/census.json`, which is git-ignored and regenerated by that command.

- 574 of 574 web examples render. 542 are distinct renders, and 472 of the 502 the web docs reference.
- 38 frames record nothing as dropped. 469 frames' flattened HTML does not reproduce its own capture when rendered offline.
- 209 examples in 22 components have a closed popup. Another 108 only hide parts such as panels, indicators and error messages. Both are U5's.
- `command/virtualized` puts all 10,000 rows in the page, 10,006 layers. U5 decides what to capture for it.

The kinds that are the only recorded loss in a frame, which are the cheapest frames to turn green: control values in 22 frames, `min-height` in 16, the two svg kinds together in 9, `direction` in 3, margin in 2.

**U4 is split along one line.**

- **U4a, pass through.** CSS that Paper can hold as written, so the work is to emit it: minimum and maximum sizes, margin, flex item properties, grid, position with insets and `z-index`, sizes in `%` and intrinsic keywords, overflow, transforms, a few text properties, background longhands. Each kind is emitted, checked offline, then verified in Paper on a real frame before the next starts.
- **U4b, convert.** Content that needs a translation: an svg styled by CSS, control values and placeholders, text mixed with elements, block layout with inline children, pseudo-elements, tables, content-box sizes, `direction`, the top layer, and content clipped out of a scroll container.

When Paper does not hold a property as written, the flattener uses an equivalent Paper does hold, or the px value the browser used, or leaves it recorded. It never emits something that makes a frame pass while it looks different.

Content with no Paper equivalent, such as a canvas or a native range input, needs a rule before U4b: it joins the ignore list when Paper looks the same without it, or it becomes a named, flagged fallback that cannot pass verify silently. That rule is Mark's to confirm.

## Before U4b

Four units stood between U4a and U4b. All are done and approved.

- **U4s, the flattener split,** `425b00e`. `paper/flatten.mjs` went from 773 lines to 309, with six modules under `paper/flatten/`. A reviewer built its own baseline from the old code: 574 of 574 HTML files, sidecars and screenshots identical.
- **U4v, verify compares the two renders,** `0a62628`. Paper's export and the emitted HTML, drawn by one engine, are byte-identical on every faithful frame, so the comparison has no tolerance. A failure names the region and the layer.
- **U4c, the capture matches the docs,** merged in U4i. The capture page loads Tailwind's preflight in a layer below the examples' CSS and takes the docs' 32rem content width. `node paper/compare-docs.mjs` starts the docs site, measures every docs example there and compares.
- **U4i, the merge,** `59a84de`, one fix round. It also made the capture wait for an example's own timers, made the page-side code run in strict mode with a test that fails on a stray global, and added a measurement that records an element whose own tag sizes it differently from the `div` Paper receives.

**The capture loads nothing from outside the repo.** A request to another origin is blocked, on both sides of the docs comparison, and recorded as a loss that names the URL. One example asks for one: `avatar/basic`, a remote photo. It shows its fallback and stays red.

**U4o, the flattened HTML must look like the example,** `711c654`. For 95 of the 96 clean frames the live example and the flattened HTML were already the same picture, byte for byte. The 96th differed by one colour unit on 41 pixels, because `overscroll-behavior` changes how Chromium smooths a scroller's edge, so the capture page switches that property off. A picture difference is now a recorded loss that names the region and the layer. The false records every svg gained under preflight are gone, 1357 entries to 543. A gradient that Paper rewrites to interpolate in oklab is recorded: Paper does that only when the background has its default size and position.

**The capture page differs from the docs site in two deliberate ways:** corners stay rounded, and `overscroll-behavior` is off. The docs comparison still passes, 502 of 502.

**What the gate still cannot see:** hover, focus and animation, scrollbars, which headless Chromium never draws, and Paper's own text drawing.

**66 frames record a loss and are pixel-identical anyway.** A reviewer sorted 15. Some are real and invisible in a static frame, such as a dropped layer or a lost `direction`. Some are false: an empty `::before` or `::after` that paints nothing keeps 12 `resizable` frames red, and the "text and elements" record, the only loss in 22 frames, is likely false. Both go to U4b's children lane.

**U4b runs in three lanes,** from the split's review, so workers do not edit the same lines:

- **Icons,** inside `paper/flatten/svg.mjs`. 263 examples.
- **Children:** control values and placeholders, text mixed with elements, pseudo-elements, and an absolute layer that paints nothing. They all change how a node's children are built, so one owner.
- **Layout:** an inline child in a block, tables, `direction`, scroll containers, the top layer, backgrounds, a `calc()` with a token, and elements that size themselves, such as a button's width.

Losses by how many kinds a frame records, at `59a84de`: none 96, one kind 108, two 94, three or more 276. A kind that is often a frame's only loss: control values 41 frames, mixed text 23, `::before` 12, a `calc()` token 10, `direction` 9, empty layers 6.

**Content with no faithful form in Paper needs a rule, and it is Mark's to confirm.** A canvas, a native range input, password masking, a gradient that is not in oklab, and a remote image cannot be made pixel-identical. Proposed: such a frame carries a named, accepted difference. The name and reason live in code in one short list, the frame says so in its provenance text in Paper, verify reports it as accepted and not as passed, and the cover lists every such frame. Nothing passes silently. Until Mark confirms, those frames stay red.

## After the first pass of U4b

**Merged in U4m,** `e6ee3e7`. The three lanes' patches were applied onto one tree, with real conflicts only in `paper/flatten.mjs` and `paper/flatten/records.mjs`. Two reviewers approved it, one on the merge and the count, one on the fixes. Every frame any lane cleared is still clean.

- 327 of 574 frames record nothing, against 96 before the lanes. All 327 were synced to a scratch file and pass `verify components`, measured by the worker and again by a reviewer.
- 35 more frames lose only a token link. They pass, and verify prints each lost link as a note.
- 39 of 54 components have a faithful frame, and 12 are faithful in every frame. None yet in avatar, calendar, carousel, color-picker, date-input, date-picker, file-input, image-cropper, rating, scroll-area, slider, textarea, timeline, token-input and waterfall.
- 280 of the 502 examples the docs reference are faithful.
- A layer whose size differs between the example and the flattened HTML is now recorded as `size`, beside `picture`. A unitless line height is emitted as the length Chromium lays out, since Chromium floors it to 1/64 px and rounds a length.

**What keeps the other 247 red,** by the kinds a frame records, with `picture` and `size` left out because they are what a cause looks like:

| Frames | Kinds                                                               | Component                                                                 |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 36     | a token link only                                                   | accordion, listbox, switch, tree                                          |
| 24     | tables                                                              | calendar                                                                  |
| 21     | the resize grabber                                                  | textarea, trigger-menu, and a textarea inside accordion, tabs and toolbar |
| 18     | a hidden native range input at `opacity: 0`, with background layers | slider, and a slider inside label and image-cropper                       |
| 15     | `position: fixed` in the top layer                                  | toast                                                                     |
| 14     | `box-sizing: content-box`                                           | date-input                                                                |
| 14     | scroll snap and `interactivity`                                     | carousel                                                                  |
| 13     | a picture difference with no cause named                            | six right-to-left frames, command, tree, combobox, scroll-area, drawer    |
| 12     | an input's own width                                                | date-picker                                                               |
| 11     | password masking                                                    | password-input                                                            |
| 7      | a painting `::before`                                               | rating                                                                    |

The rest are groups of one to six frames.

**U4p, the second pass, runs in four lanes:**

- **Tables,** a new `paper/flatten/table.mjs`, then token links in `paper/flatten/bindings.mjs`.
- **Pseudo:** painting `::before` and `::after`, an inline element in a block, text mixed with elements, control values, `content-visibility`.
- **Boxes:** an input's width, `box-sizing`, button and select width, a fieldset and its legend, an image, and the six right-to-left frames with no cause named.
- **Layers:** `position: fixed` and the top layer, a box placed against a far ancestor, clipping, scroll snap, background layers, and seven frames with no cause named. U5 opens popups, which are top-layer boxes, so this lane goes before it.

**Measured in Paper for the token lane.** Paper keeps a token mixed with transparent, written token first, as `color-mix(var(--ink) 8%, transparent)`. That holds in a background, a border colour, an outline, a text colour and inside a box shadow. Paper drops the colour when transparent comes first, when the token is mixed with a literal or a second token, in relative colour syntax, and in an svg stroke.

**Content with no faithful form in Paper, as it stands.** A layer at `opacity: 0`, which Paper deletes whatever it holds: the slider's hidden range input, the scroll area's resting scrollbar, the file input's hidden input. The textarea's resize grabber. Password masking. A gradient Paper rewrites. A canvas. A remote image. About 70 frames stay red for these alone. The rule proposed under "Before U4b" would let them into the kit with the difference named. It is still Mark's to confirm.

**U8's gate needs the same answer.** It says every frame passes verify with nothing dropped, which those frames cannot do. Default until Mark says otherwise: U8 syncs every frame, so the kit holds the whole catalogue, and each frame that loses something lists its losses in its provenance text and in the report. Verify stays red for them.

## After the second pass

**U4p, the second pass,** ran in four lanes and was merged in U4q at `0453385`. Each lane had its own review. Three had a fix round. Two fresh reviewers then checked the merged tree and the sync at `c6677d0`, and both approved with nits only.

- 419 of 574 frames record nothing, against 327 after the first pass. All 419 pass `verify components` in Paper, measured by the merge worker, by a reviewer, and on the kit file.
- 33 more frames lose only a token link. They have no difference, and verify prints each lost link as a note.
- 44 of 54 components have a faithful frame. New in this pass: calendar, carousel, date-input, date-picker and timeline. Still none: avatar, color-picker, file-input, image-cropper, rating, scroll-area, slider, textarea, token-input and waterfall.
- 368 of the 502 examples the docs reference are faithful.

**What the lanes added.**

- **Tables.** A CSS table with separated borders is emitted as flex boxes, kept only when every box and every text stays where it was. A token mixed with transparent is bound as `color-mix(in oklab, var(--ink) 8%, transparent)`, which Paper keeps.
- **Pseudo.** A painting `::before` or `::after` is a real child layer. A lone inline box in a block becomes a block that keeps its token line height. An empty box that Paper would delete keeps an invisible svg.
- **Boxes.** An element its own tag sizes, a content-box size, `contain: inline-size`, a fieldset's legend. Two new records where Paper draws text differently: `font synthesis`, bold that Chromium fakes for a font with none, and `font fallback`.
- **Layers.** A fixed or far-anchored box is placed at its measured offset, with its dependence on tokens measured and not assumed. A scroller away from its start is clipped with its children moved.

**Three capture settings were added on purpose,** beside the two under "Before U4b":

- The browser runs with `--disable-prefer-compositing-to-lcd-text`. It stops Chromium compositing scrollers. On 41 of 44 sampled frames the picture is byte-identical with and without it. The other three have a scroller and change by at most 3 colour units on at most 106 device pixels.
- The clock is fixed at 2026-11-19 12:00 UTC, in the capture, in verify and in the docs comparison. Without it, seven calendar frames changed with the date.
- A frame with more than 2,500 layers records `layers` and is not imported. Paper wrote a 10,006-layer frame in 51 s, then the file stopped answering for ten minutes and came back empty. `command/virtualized` is the one such frame.

**What keeps the other 155 red.** 33 lose only a token link, mostly a colour mixed from two tokens, or a position that depends on several tokens. The rest, by cause: the textarea's resize grabber, the slider's hidden range input, password masking, a layer at `opacity: 0`, gradients, faked bold and fallback fonts in right-to-left frames, token-input's mixed text, the collapsed table in `checkbox/table`, and smaller groups.

**Six frames differ in Paper in a way nothing records:** `accordion/search`, `file-input/basic`, `file-input/page`, `rating/form`, `scroll-area/both-axes` and `scroll-area/type`. Verify fails all six, so none passes wrongly. A reviewer traced them: two are real gaps, below, and four are a recorded loss on a child that verify does not yet link to its parent.

**The first plan's gate for U8 and U10 is not met, and cannot be without a rule from Mark.** It said every frame passes with nothing dropped. 149 frames record a loss, most of them for content Paper has no faithful form for. The kit holds every frame all the same, and each one says in Paper what it loses. The rule proposed under "Before U4b", a named and accepted difference, would let verify exit 0 with those frames listed. It is still Mark's to confirm.

**Measured for the open states, U5.** Probe `.swe-mode/paper-kit/probes/open-popups.mjs`.

- A generic step opens 184 of the 209 examples that have a closed popup: 149 by clicking the first trigger, 25 by focusing the input and pressing ArrowDown. Trigger-menu, tooltip and hover-card need their own step.
- Nearly every open popup is `position: fixed` in the top layer, and many land outside the example's frame. So an open-state frame has to act as the viewport, and grow to hold its popup.
- Chromium draws a fixed or top-layer box in its own compositing layer. Drawn as fixed in both comparison renders, an open tooltip gives three byte-identical pictures. An open menu still differs from the live page on 822 pixels of text, from a second cause not yet found.

## The kit file today

Written by the coordinator on 2026-11-16, after U2 passed, with the commands at commit `ec2cf6f`.

- `sync pages`: 7 writes. `Page 1` was renamed to `00 Cover`, five pages and two dividers were added.
- `sync tokens`: 36 created, 7 skipped.
- `sync foundations`: 24 writes, six artboards on `01 Foundations`.
- A second run of each made 0 writes. `verify pages`, `verify tokens` and `verify foundations` each exit 0.
- Both guards fired on the way, as designed: frames were refused before the pages existed, and again before the tokens existed.

Filled by the coordinator on 2026-11-19, from the reviewed head `c6677d0`, with a census made at that commit on a clean tree.

- `sync foundations`: 12 writes, a one-time rewrite of the six artboards' text to the new format. Positions, styles and content did not change.
- `sync components --all`: 789 writes in 105 s. 54 artboards and 573 frames on `02 Components`. `command/virtualized` is not imported, and its artboard says why.
- A second run of `tokens`, `pages`, `foundations` and `components --all` made 0 writes.
- `verify tokens`, `verify pages` and `verify foundations` exit 0. `verify components --all` took 519 s and exits 1, as above: 419 match, 149 differ only by recorded losses, 6 differ in a way nothing records.
- The logs are under `.swe-mode/paper-kit/reports/U8-kit/` in the coordinator's checkout.

`00 Cover`, `03 Patterns` and `04 Templates` are empty.

## Follow-ups

Deferred nits from review. None blocks a unit.

- `paper/paper-client.mjs`: `close()` waits forever if the relay ignores both stdin EOF and SIGTERM. Send SIGKILL and resolve after the grace period. From the U1 review.
- `paper/tokens.mjs`: the `--size` prefix has no trailing hyphen, and a colour named like `--text-muted` would be typed as a font size. From the U1 review.
- `paper/paper-client.mjs`: the line splitter assigns inside the `while` condition, and `failAll` leaves request timers running. From the U1 review.

### Deferred review findings, by owner

The briefs, reviews and dispositions are under `.swe-mode/paper-kit/` in the coordinator's checkout.

- **U4a, pass through.** Add `drawer/basic` to the closed-popup test, which misses a hidden part that holds a popup. The two svg kinds always appear together, so each reads 0 in the only-loss column: add a note or one combined row.
- **U4, coverage, both halves.** An `svg` sized or coloured by CSS. `direction: rtl`. Input values. Mixed text and element children. Built-in control drawing. A content-box sized element. Layer positions are not compared. `max()` and averaged tokens can bind the wrong token: bind only when the token's value equals the real value. A font-size token used in another property is not recorded as unbound. Colour or weight on a `display: contents` element that holds text. The tree parser breaks on a layer name containing `" (word)` and on text with a newline. Four flattener exceptions have no test. A harmless `position: relative` is recorded on the scroll-area thumb. The `display: block` exception also hides inline children laid out on one line. A background with several layers records each layer's defaults. The catalogue test does not check emitted properties.
- **U8, full sync.** The provenance commit line is rewritten for every frame when one frame is written. A crash after `create_artboard` leaves a 400x400 artboard.
- **U10, delivery gate.** Verify passes when `paper/out` is stale against the code.
- **U4b, from the merge's reviews.** A blocked request that no element names is recorded from a callback that can arrive after the frame is read: 1 run in 20 on a made-up frame. The measurement's copy cannot carry a child's pseudo-element or shadow root. The leaf shortcut misses a tag rule scoped to an ancestor. The page's own MutationObservers see the measurement's temporary copy. Twelve tooltip frames ended a loaded census run with one more element in the document, with no effect on output and no cause found.
- **U4b, from U4o's review.** The gradient rule misses a gradient sized `auto 100%` or `100%`, or placed at `0px 0px` or `50% 50%`, which Paper still rewrites, and records `repeating-linear-gradient`, which Paper keeps. No catalogue example uses those forms. A picture record names the parent when paint overflows its layer. No test covers the `overscroll-behavior` rule. A zero-width border with an explicit colour still records its colour. The Foundations frames skip the picture comparison.
- **U4p, from the merge's reviews.** An underline with no `text-underline-offset` records nothing and fails verify, because Paper adds `text-underline-position: from-font`: boxes lane. A text-only grid with `align-content` takes the block form and records only `picture`: boxes lane. The `calc()` binder reads the host for a pseudo-element entry and can bind the host's token: pseudo lane. A placeholder's line height is measured with the input's font: pseudo lane. No catalogue frame reaches any of the four today.
- **After the second pass, the flattener.** Paper deletes a bare empty layer whose parent is not flex, and nothing keeps or records it: `accordion/search`. Give it the invisible svg an empty absolute layer already gets. An absolute layer placed against its own parent loses a margin bound to a token in Paper, with no record: nine scroll-area frames. The token line-height form is taken for a lone inline box that paints a background, where the other form would match. No test fails if the capture stops recording an oversize frame. A token with its own alpha, mixed with transparent, is refused though the binding would be right. A locale that changes only glyph shapes loses its named record. A contained text in a zero-width `auto` grid column wraps per character in Paper. The px form fixes an input's width that came from a font-size token. A position that moves at half a token is listed as unbound, where `calc(var(--size) * 0.5 + Npx)` might hold. A pseudo-element's unset `top` is bound to its host's padding token.
- **After the second pass, first frames one change away.** Scroll-area: emit `font-weight: 400` where the parent's weight differs. Rating: emit the mask properties, which Paper keeps, and emit an empty gradient as nothing, since Paper turns every hard-stop gradient into solid ink. Date-input: a segment that holds just a space is dropped with no record, four frames.
- **After the second pass, the sync.** A layer a person adds inside a component artboard makes it overlap the row below, since the grid sizes rows from the captures. A run cut off between writing a header or a frame and moving it leaves it out of place for good. Verify links a difference to a loss recorded on its own layer or above, and not below, so four frames sit in the wrong count. A frame whose only record is a lost token link is counted with the frames that differ. No test covers adding a header to an artboard that already has frames. `paper/test/components.test.mjs` is 540 lines.
- **No owner yet.** The resize-observer test caught its defect in 15 of 16 runs under load. `tokens`, `pages` and `foundations` ignore extra arguments. Verify names layers by DOM path in drop messages and by layer name elsewhere. A text label equal to a layer name confuses the round trip. `::first-letter` and `::first-line` styles are not recorded. The token guard misses tokens used only by the artboard and the provenance text.

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
