# keybry

**Keep chat bars and toolbars on top of the mobile keyboard. They move _with_ the keyboard, not after it.**

[![npm](https://img.shields.io/npm/v/keybry)](https://www.npmjs.com/package/keybry)
[![size](https://img.shields.io/badge/core-1.7%20kB%20brotli-blue)](./.size-limit.json)
[![CI](https://github.com/akdoescodes/keybry/actions/workflows/ci.yml/badge.svg)](https://github.com/akdoescodes/keybry/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/keybry)](./LICENSE)

**[Try it on your phone →](https://akdoescodes.github.io/keybry/)**

- **On time.** It starts moving the moment a field is tapped, using the height it saved on this device last time.
- **Exact where possible.** Uses Chrome's VirtualKeyboard API (Chrome, Edge, Samsung Internet), and the visual viewport everywhere else.
- **No bounce.** Hopping between fields, or the keyboard closing and reopening, doesn't make the bar jump.
- **Fast.** Moves your element with a GPU transform. No layout, no React re-renders.
- **Small.** Under 1.7 kB min+brotli, with zero dependencies, and it's safe for server rendering.

```sh
npm install keybry
```

## The problem

On the mobile web, the on-screen keyboard slides over your page, and a `position: fixed; bottom: 0` composer ends up behind it.

The usual fixes fall short:

- `100dvh` and `interactive-widget` don't follow the keyboard in iOS Safari.
- `visualViewport` does, but it often reports only after the keyboard has finished sliding in. Your bar jumps up a beat too late.
- Hooks built on it usually call `setState` on every viewport event, so React re-renders throughout the animation.

## How it works

```
 field tapped ──▶ 1. PREDICT  height saved on this device last time (first time: a deliberately tall guess)
                     │        the bar starts moving now, on an iOS-like curve
                     ▼
 browser reports ─▶ 2. MEASURE exact rect from the VirtualKeyboard API, or the visual viewport
                     │
                     ▼
                  3. CORRECT  glide to the real number; ignore dips while focus hops between fields
                     │
                     ▼
                  4. LEARN    save it per keyboard type, orientation and screen size
```

The second time a keyboard opens on a device, the prediction is already exact, so there's nothing to correct.

## Usage

### Plain JavaScript (any framework)

```js
import { dock } from 'keybry'

dock(document.querySelector('.composer')) // returns an undock() function
```

```css
.composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
}
```

### Layout tip: scroll the message list, not the page

When the whole page scrolls under an open keyboard, the browser moves things itself. Chrome and Safari slide the visible area, and Firefox also hides its toolbar. keybry follows all of that, but Firefox draws fixed elements up to a toolbar's height away from where it reports while its toolbar is hidden, and no script can see that. If only the message list scrolls, none of it happens:

```css
html,
body {
  height: 100%;
  overflow: hidden;
}
body {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  margin: 0;
}
.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: calc(80px + var(--keyboard-height, 0px)); /* room for the composer */
}
```

### CSS only

`--keyboard-height` is always set on `<html>`, so you can move anything with it yourself:

```css
.composer {
  transform: translateY(calc(-1 * var(--keyboard-height, 0px)));
}
.messages {
  padding-bottom: calc(80px + var(--keyboard-height, 0px));
}
```

### React

```jsx
import { Dock, useKeyboard } from 'keybry/react'

function Chat() {
  const open = useKeyboard((s) => s.open) // re-renders only when `open` changes
  return (
    <>
      <Messages />
      {!open && <BottomNav />}
      <Dock className="composer">
        <ChatInput />
      </Dock>
    </>
  )
}
```

`<Dock>` never re-renders as the keyboard moves. It takes any HTML attributes, plus `as` to pick the element (`<Dock as="footer">`).

### Vue, Svelte, Solid, Angular

Use the core directly. It's three lines in any framework:

```js
// Vue
onMounted(() => (undock = dock(el.value)))
onUnmounted(() => undock())
```

```svelte
<!-- Svelte 5: dock() returns its own cleanup, which is what an attachment needs -->
<form {@attach dock}>...</form>
```

### Reading the state

```js
import { keyboard } from 'keybry'

const kb = keyboard()
kb.subscribe((s) => console.log(s.open, s.height, s.phase, s.source))
```

| Field    | Meaning                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `open`   | `true` while a keyboard is up, or predicted to be coming up.                                                                            |
| `height` | Pixels of the page the keyboard covers, so how far to move bottom-anchored UI. `0` when the browser shrank the page itself (Brave does; Firefox sometimes does). Briefly negative in Firefox when its visible area reaches past the page bottom; moving by it is still right. |
| `phase`  | `'closed'`, `'opening'` (predicted, not yet confirmed) or `'open'` (measured).                                                          |
| `source` | `'predicted'`, `'measured'` (visual viewport) or `'exact'` (VirtualKeyboard API).                                                       |

## API

```ts
import { keyboard, dock, createKeyboard } from 'keybry'
```

- **`keyboard()`** returns the shared tracker for the page. It's created on first use.
- **`dock(el)`** keeps `el` above the keyboard and returns `undock()`. It's shorthand for `keyboard().dock(el)`.
- **`createKeyboard(options?)`** creates a separate tracker. You only need this for tests and custom timings:
  - `wait` (default `1000`): ms to wait for an on-screen keyboard before deciding there isn't one (hardware keyboard, floating iPad keyboard). It grows by itself on devices whose keyboard is slower than that.
  - `settle` (default `300`): ms a shrinking keyboard must hold before the UI follows it down. This is what stops the bounce.
  - `win`: the window to read. Tests pass a fake one.
- A **`Keyboard`** has `state`, `subscribe(fn) → unsubscribe`, `dock(el) → undock` and `destroy()`.

From `keybry/react`:

- **`useKeyboard()`** returns the full state.
- **`useKeyboard(select)`** returns a selected value and re-renders only when it changes.
- **`<Dock as? ...props>`** renders a docked element.

From `keybry/recorder` (a separate import, not part of the core):

- **`record({ keyboard? })`** returns `{ trace, mark(note), stop() }`. It logs every keyboard-related event as a trace you can replay in tests.

## Good to know

- **Use 16px or larger text in inputs.** Smaller text makes iOS zoom the page on focus, which moves everything.
- **While something is docked, Chrome stops shrinking the page for the keyboard.** The exact numbers need `navigator.virtualKeyboard.overlaysContent = true`, which keybry switches on only while at least one element is docked, then restores. Other inputs on the page aren't scrolled into view automatically during that time.
- **`dock()` takes over the element's inline `transform`.** Put your own transforms on a wrapper.
- **The first open on a device is a guess.** It's deliberately on the tall side, because a bar that starts a little high and settles looks fine, and a bar hidden behind the keyboard does not. From the second open, the saved height is used.
- **Short strips count too.** The iPad shortcut bar shown with a hardware keyboard, or Chrome's autofill bar, is far shorter than a keyboard. The bar still sits on top of it.
- **Firefox for Android** is supported on the measured path. It reports a fine pointer on phones with a stylus, so keybry detects touch with `navigator.maxTouchPoints`, not `(pointer: coarse)`. It also reports the keyboard later than Chrome, and hides its toolbar when the page scrolls (see the layout tip).
- **Not handled yet:** pages that are pinch-zoomed.

## Help it work on your phone

Real phones are the test suite. The [test page](https://akdoescodes.github.io/keybry/) has a two-minute guided test. It records what your browser reports, saves it as a file, and opens a GitHub issue for you to attach it to. Each trace goes into [`traces/`](./traces) and runs in CI on every change from then on.

Traces that would help most right now:

- iPhone Safari (does it report the keyboard every frame, or only at the end?)
- Samsung Internet
- Firefox for Android
- iPad with and without a hardware keyboard

## How it's tested

Nothing in the core touches `window` directly. Everything comes through one `win` object, so the tests swap in a fake window that plays back a recorded trace, and the real engine runs on recorded phone behaviour. Every trace in `traces/` must pass two rules:

1. A docked bar is never hidden behind the keyboard for more than 3 frames.
2. When things go quiet, the bar sits exactly on the keyboard, or is down if nothing is focused.

The scenarios in [`test/engine.test.ts`](./test/engine.test.ts) cover the behaviours in this README. They're synthetic models of each browser for now, clearly marked as such, until real traces replace them.

```sh
npm test          # unit tests + trace replays
npm run size      # fails if the core grows past its budget
npm run demo      # build, then serve the test page on your Wi-Fi for your phone
```

## License

MIT © Arjun Kale
