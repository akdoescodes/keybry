# Contributing

The most useful contribution needs no code: run the [guided test](https://akdoescodes.github.io/keyboard-dock/) on your phone and send the trace. Every trace becomes a permanent test.

## Setup

```sh
npm install
npm test          # unit tests + every trace in traces/
npm run typecheck
npm run size      # the core has a size budget; CI fails past it
npm run demo      # build, then serve the test page on your network for a phone
```

Testing on a real phone:

- **Android:** connect over USB, open `chrome://inspect` on your computer, and add port forwarding `5173 → localhost:5173`. Then open `http://localhost:5173` on the phone. (The VirtualKeyboard API only works on HTTPS or localhost, so a plain Wi-Fi address won't show `exact` numbers.)
- **iPhone:** open the Wi-Fi address that `npm run demo` prints. To debug, use Safari on a Mac: Develop menu → your iPhone.

## Layout

```
src/index.ts      the engine: listen → predict → measure → correct → learn → move
src/focus.ts      which keyboard a focused field will open
src/react.ts      useKeyboard() and <KeyboardDock>
src/recorder.ts   records traces (a separate import, not in the core)
test/env.ts       the fake window that replays a trace through the engine
test/scenarios.ts synthetic traces for known browser behaviours
traces/           real device recordings, each one a regression test
demo/             the demo and guided test page (GitHub Pages)
docs/design.md    why it works the way it does
```

## Rules for the core

- **Everything goes through `win`.** The engine never touches `window`, `document` or `navigator` directly. That's what lets a recorded trace replay in tests.
- **No dependencies, and stay under the size budget.** If a change needs more bytes, say why in the PR, and raise the limit in `.size-limit.json` in the same PR.
- **A behaviour change needs a scenario or a trace that shows it.** Check that your new test fails without your change.
- **Never cover the input.** When in doubt, the bar should sit a little high rather than a little low.

## Releasing

1. Add a line to `CHANGELOG.md`.
2. Run `npm version patch` (or `minor`), then `git push --follow-tags`.
3. The Release workflow publishes to npm with provenance.
