# paper

Rules for working on the Paper kit, in the Paper file and in this folder. Read [README.md](README.md) for the commands and [PLAN.md](PLAN.md) for what was measured.

## In the Paper file

- **Pages `00` to `02` are output.** Do not edit them by hand. To change how a component looks, change it under `examples/`, then regenerate. A frame edited by hand is rewritten on the next sync.
- **Work in `99 Playground`.** Duplicate a frame there and change the copy. Sync never writes to that page.
- **Do not add layers inside a generated artboard.** The grid sizes its rows from the captures, so the artboard would run into the row below.
- **Names are the code's names.** An artboard is a component folder, `select`. A frame is an example, `select/groups`. A layer is a `data-slot`.
- **Find a frame by its caption.** `find_nodes({ textValue: "select/groups" })`. Layer names are not searched.
- **Read what a frame loses** in the text block at the end of its artboard: `exact`, or `loses` and the kinds.
- **Never write a frame above 2,500 layers.** A 10,006-layer frame made a file stop answering and it came back empty.

## In this folder

- **One rule.** Nothing is lost without a record, and a frame that lost something cannot pass verify.
- **Never make a frame pass by hiding a difference.** No tolerance in a picture comparison, and no entry in an ignore list without a measurement that the pictures are the same without the value.
- **A new translation is checked in Paper,** on a real catalogue frame, with `verify components`. Paper's own export decides whether Paper holds a form.
- **A token link is exact or it is not made.** Where the code used a token, the layer is bound to that token. Where a value cannot be bound, it is listed as unbound.
- **Write to a scratch file while you work.** Only the finished, reviewed tree is synced to the kit file, by one sync at a time.
- **Run browser commands through `scripts/test-slot.sh`.** A docs server takes its own port.
- **A full census stays under fifteen minutes.** Time it when you add a check that measures layout per element.
