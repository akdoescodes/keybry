# Design

How keybry decides where the keyboard is, and why. Read this before changing `src/index.ts`.

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

**When to move.** Moving up applies at once, so the input is never covered. The keyboard opening, closing or changing size (on the exact path) animates. On the measured path, changes while the keyboard stays open are the browser scrolling or its toolbar sliding, so they apply at once, without animating and without waiting. One exception: right after `innerHeight` changed, a move down waits for the next report, because Firefox reports a new `innerHeight` a frame before the visible height that goes with it.

Moving down because the keyboard is opening or closing while a field is focused waits for the numbers to stop changing:

- while opening: 100 ms (`CORRECT`). The browser may be reporting every frame of the keyboard sliding in. Following that would drag the bar down from the prediction and back up.
- once open, within half a second (`DIP`) of focus moving: `settle`, 300 ms by default. Switching fields can close and reopen the keyboard, and following that dip makes the bar bounce. Later than that, nothing is waited for: the keyboard is really closing (the Android Back button, the keyboard's own hide key, which keep focus in the field). Waiting there made the bar hang in the air for 0.3 s after the keyboard had gone.

Focus leaving a field closes after 32 ms (`BLUR`, two frames), unless another field takes focus first. Moving between fields, and an app refocusing in the same task or in a timeout, all land within it.

**How it moves.** Three speeds. Focus, blur and the exact API all come as the keyboard starts to move, so those moves slide in step with it (0.25 s). On the measured path the browser reports after the keyboard has finished moving (Firefox: about 0.3 s after a close starts), so there is nothing left to be in step with: the bar catches up in 0.12 s. Everything else (scrolling, toolbars) jumps instantly. The correction is not clamped at 0: scrolled to the end, Firefox lets the visible area reach up to its toolbar's height past the bottom a fixed bar sits at, so the bar has to move down.

**Prediction.** In order:

1. The height saved for this kind of keyboard, orientation and screen size.
2. Nothing, if the VirtualKeyboard API is on. It answers within a frame, and a guess would only wobble.
3. The built-in table: a share of the screen height, deliberately tall.

A prediction that sees no keyboard within `wait` (1000 ms; Firefox reports the keyboard about 750 ms after focus on the emulator) is dropped, and 0 is saved, so a hardware keyboard or a floating iPad keyboard stops moving anything from the next tap on. If a keyboard turns up after that during the same focus, it was only slow (Gboard took several seconds on an Android emulator). The delay is saved, and from then on `wait` is 1.5× that delay, capped at 3 s. So a slow keyboard stops the bar bouncing after the first time.

**What gets saved.** The distance the bar had to move, not the keyboard's own size. In browsers that shrink the page themselves, that's 0, and saving 0 means they're never predicted for again. The key is `kind + orientation + screen`, for example `textP390x844`. The platform isn't in the key, because localStorage already belongs to one browser on one device. Orientation comes from `screen.orientation`, not `innerWidth`: a page that overflows sideways widens `innerWidth` on mobile, and that once filed a portrait keyboard under landscape.

**Touch.** On-screen keyboards only exist on touch screens, so nothing is predicted or measured without one. Touch is `navigator.maxTouchPoints > 0`, not `(pointer: coarse)`: Firefox for Android reports a fine pointer on touch screens that also take a stylus, and the bar stayed under the keyboard there.

**Chrome's exact numbers.** `overlaysContent = true` is required, and it stops Chrome from shrinking the page. It's switched on only while at least one element is docked, and the app's own value is restored after.

**Where the page ends (Chrome on Android).** Chrome reports the keyboard's height minus the navigation bar's (`KeyboardUtils.calculateKeyboardHeightFromWindowInsets`: the IME inset minus the bottom system bar inset), as if every page ended at the top of the navigation bar. Its visual viewport shrinks by the same number, so the measured path has the same error and switching paths doesn't help. Two common layouts end elsewhere:

- Drawn under the gesture bar (`viewport-fit=cover`, edge-to-edge Chrome): the page ends lower, and the keyboard covers the gesture bar's height more than reported. The bar sat 24px behind the keyboard.
- Above a toolbar at the bottom of the screen (Chrome's bottom bar): the page ends higher, and the keyboard covers the toolbar's height less. The bar floated 56px above the keyboard.

So the exact height gets `edge()` added: where the page ends on the screen minus where the navigation bar starts. The page's top on the screen is `screenY - clientY` of the last tap (every keyboard open starts with one), plus `innerHeight` for its bottom. The navigation bar starts `env(safe-area-max-inset-bottom)` above the bottom of the screen (`screen.height`): Chrome 135+ reports the bar's height there whether or not the page is drawn under it. It's read on the tap, with a probe element, because it costs a style recalculation, and only while the keyboard is down: Chrome reports it as 0 while the keyboard is up (a tap on a chip above the keyboard lost the correction in the lab). Where it's 0 (Chrome before 135, 3-button navigation, which Chrome never draws under, and every other browser), 0 can't be told from no bar, so there's no correction: with 3-button navigation the page ends at the bar and Chrome's number is right, and Chrome 133 stops drawing under the gesture bar while the keyboard is up. Anything over 200px is ignored (not a toolbar or a gesture bar).

The first version read the navigation bar from `screen.availTop + availHeight`. That worked on the Chromium 159 snapshot in the lab, but a real phone's Chrome 156 and 158 reported the whole screen as available, so nothing was corrected there.

Checked on the lab emulator (Android 16, Gboard) against where Android itself says the keyboard is (`dumpsys window`), in Chrome 133 and a Chromium 159 snapshot: on the keyboard within 2px in all four layouts, from 24px behind and 56px above before.

**Speed.** `dock()` writes `transform` on the element directly: no layout, no style recalculation for the rest of the page, no framework. React hears about state changes only through `useSyncExternalStore`, and a selector limits re-renders to the value a component uses.

**Testability.** Everything the engine knows comes through `win`. Tests pass a fake window built from a trace, so recorded phone behaviour runs through the real engine.

## Changes from the first plan

- **One package with subpath imports** (`keybry`, `/react`, `/recorder`) instead of three packages. It's one install and one version, and the React wrapper always shares the core's instance.
- **`win` instead of a separate env module.** Passing in a window-shaped object gives the same "record once, replay forever" with no extra code in the bundle.
- **No `closing` phase.** Closing is a single move to 0. A separate phase would cost one more React render per close and tell an app nothing it can act on.
- **The built-in table is ratios, not a device list.** It needs no maintenance, and the first real open on a device replaces it anyway.
- **Smaller-than-predicted measurements wait for the numbers to stop changing.** This came from the scenario where iOS reports every frame of the animation.
- **Firefox, from a real-keyboard run on Firefox 159.** The touch check, a 1000 ms `wait`, instant tracking on the measured path, no clamp at 0, and waiting out the `innerHeight` report that runs ahead. Before, the bar floated up to 164 px above the keyboard for most of a second whenever the page scrolled.
- **Shadow DOM.** Focus is read through `composedPath()` and into `shadowRoot.activeElement`, so inputs inside web components work.
- **Chrome on Android, corrected for where the page ends**, from screenshots of a real phone: the bar 25px behind the keyboard with Chrome's toolbar at the top, 55px above it with the bottom bar. The first emulator runs used Chrome 133 on its default layout, the one layout where Chrome's number is right, and the lab checked the bar against Chrome's own number. The lab now checks it against the keyboard's position from Android.

## Open questions (traces will answer)

- Does iOS Safari report the keyboard every frame, or only at the end? Either way is handled. Which one decides how visible the first-time correction is.
- Is 1000 ms the right starting `wait` on real phones? It grows by itself on slow devices; real Firefox traces will show how much margin it leaves.
- With its toolbar hidden, Firefox draws bottom-fixed elements away from where it reports, so the bar can slip under the keyboard while a whole-page scroll keeps the toolbar hidden. The README recommends scrolling only the message list, which avoids it. Is there a reading that reveals the offset?
- Is 32 ms the right `BLUR`? An app that blurs and refocuses over a longer gap would see a small bounce.
- How much does iOS pan the page when a docked input at the bottom gets focus, and how close is the saved height for the next time?
