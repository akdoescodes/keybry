# Design

How keyboard-dock decides where the keyboard is, and why. Read this before changing `src/index.ts`.

## Three layers, one closure

```
 LISTEN                         DECIDE                                   MOVE
 focusin / click ─┐   ┌──────────────────────────────────┐   ┌──────────────────────────────┐
 focusout ────────┤──▶│ predict → measure → correct      │──▶│ --keyboard-height on <html>  │
 visualViewport ──┤   │   → learn (localStorage)         │   │ transform on docked elements │
 geometrychange ──┘   └──────────────────────────────────┘   │ subscribers (React)          │
                                                             └──────────────────────────────┘
```

The whole engine is one closure in `src/index.ts`. Viewport events are coalesced to one decision per animation frame, and each decision reads first and writes after, so it never forces an extra layout.

## Decisions

**Which number wins.** While a field is focused: a measured keyboard beats a prediction, and a prediction beats nothing. When nothing is focused, the bar is down, whatever a stale measurement says.

**When to move.** Moving up applies at once, so the input is never covered. Moving down while a field is focused waits for the numbers to stop changing:

- while opening: 100 ms (`CORRECT`). The browser may be reporting every frame of the keyboard sliding in. Following that would drag the bar down from the prediction and back up.
- once open: `settle`, 300 ms by default. Switching fields can close and reopen the keyboard, and following the dip makes the bar bounce.

Focus leaving a field closes after 100 ms (`BLUR`), unless another field takes focus first. Panning (iOS scrolling the page under an open keyboard) always applies at once and doesn't animate.

**Prediction.** In order:

1. The height saved for this kind of keyboard, orientation and screen size.
2. Nothing, if the VirtualKeyboard API is on. It answers within a frame, and a guess would only wobble.
3. The built-in table: a share of the screen height, deliberately tall.

A prediction that sees no keyboard within `wait` (500 ms) is dropped, and 0 is saved, so a hardware keyboard or a floating iPad keyboard stops moving anything from the next tap on. If a keyboard turns up after that during the same focus, it was only slow (Gboard took several seconds on an Android emulator). The delay is saved, and from then on `wait` is 1.5× that delay, capped at 3 s. So a slow keyboard stops the bar bouncing after the first time.

**What gets saved.** The distance the bar had to move, not the keyboard's own size. In browsers that shrink the page themselves (Firefox, Brave), that's 0, and saving 0 means they're never predicted for again. The key is `kind + orientation + screen`, for example `textP390x844`. The platform isn't in the key, because localStorage already belongs to one browser on one device. Orientation comes from `screen.orientation`, not `innerWidth`: a page that overflows sideways widens `innerWidth` on mobile, and that once filed a portrait keyboard under landscape.

**Chrome's exact numbers.** `overlaysContent = true` is required, and it stops Chrome from shrinking the page. It's switched on only while at least one element is docked, and the app's own value is restored after.

**Speed.** `dock()` writes `transform` on the element directly: no layout, no style recalculation for the rest of the page, no framework. React hears about state changes only through `useSyncExternalStore`, and a selector limits re-renders to the value a component uses.

**Testability.** Everything the engine knows comes through `win`. Tests pass a fake window built from a trace, so recorded phone behaviour runs through the real engine.

## Changes from the first plan

- **One package with subpath imports** (`keyboard-dock`, `/react`, `/recorder`) instead of three packages. It's one install and one version, and the React wrapper always shares the core's instance.
- **`win` instead of a separate env module.** Passing in a window-shaped object gives the same "record once, replay forever" with no extra code in the bundle.
- **No `closing` phase.** Closing is a single move to 0. A separate phase would cost one more React render per close and tell an app nothing it can act on.
- **The built-in table is ratios, not a device list.** It needs no maintenance, and the first real open on a device replaces it anyway.
- **Smaller-than-predicted measurements wait for the numbers to stop changing.** This came from the scenario where iOS reports every frame of the animation.
- **Shadow DOM.** Focus is read through `composedPath()` and into `shadowRoot.activeElement`, so inputs inside web components work.

## Open questions (traces will answer)

- Does iOS Safari report the keyboard every frame, or only at the end? Either way is handled. Which one decides how visible the first-time correction is.
- Is 500 ms the right starting `wait`? It now grows by itself on devices with slow keyboards, but a better starting value would spare those devices their first bounce.
- Is 100 ms the right `BLUR`? Apps that blur and refocus over a longer gap would see a small bounce.
- How much does iOS pan the page when a docked input at the bottom gets focus, and how close is the saved height for the next time?
