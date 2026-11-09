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

**Handing over to the browser.** Where the page itself shrinks for the keyboard (see below), the browser lifts the bar in the frame the page shrinks. keybry takes over in that same frame, without animating: a prediction is reduced by however much the page has shrunk since the tap, and a measurement then reads 0. Without this the bar was lifted twice: the guess plus the browser's resize put it 360px too high for 0.1 s on Chrome, until the 100 ms `CORRECT` wait and a 0.12 s slide brought it down.

Focus leaving a field closes after 32 ms (`BLUR`, two frames), unless another field takes focus first. Moving between fields, and an app refocusing in the same task or in a timeout, all land within it.

**How it moves.** Three speeds. Focus, blur and the exact API all come as the keyboard starts to move, so those moves slide in step with it (0.25 s). On the measured path the browser reports after the keyboard has finished moving (Firefox: about 0.3 s after a close starts), so there is nothing left to be in step with: the bar catches up in 0.12 s. Everything else (scrolling, toolbars, handing over to the browser) jumps instantly. The correction is not clamped at 0: scrolled to the end, Firefox lets the visible area reach up to its toolbar's height past the bottom a fixed bar sits at, so the bar has to move down.

**Prediction.** In order:

1. The height saved for this kind of keyboard, orientation and screen size.
2. Nothing, if the page turned the VirtualKeyboard API on. It answers within a frame, and a guess would only wobble.
3. The built-in table: a share of the screen height, deliberately tall.

A prediction that sees no keyboard within `wait` (1000 ms; Firefox reports the keyboard about 750 ms after focus on the emulator) is dropped, and 0 is saved, so a hardware keyboard or a floating iPad keyboard stops moving anything from the next tap on. If a keyboard turns up after that during the same focus, it was only slow (Gboard took several seconds on an Android emulator). The delay is saved, and from then on `wait` is 1.5× that delay, capped at 3 s. So a slow keyboard stops the bar bouncing after the first time.

**What gets saved.** The distance the bar had to move. Where the browser shrank the page itself, keybry moved it 0 and the browser moved it the keyboard's height, so that height is saved: the next prediction lifts the bar exactly as far as the page will shrink, and the hand-over is invisible. A hardware keyboard saves 0 (see above). The key is `kind + orientation + screen`, for example `textP390x844`. The platform isn't in the key, because localStorage already belongs to one browser on one device. Orientation comes from `screen.orientation`, not `innerWidth`: a page that overflows sideways widens `innerWidth` on mobile, and that once filed a portrait keyboard under landscape.

**Touch.** On-screen keyboards only exist on touch screens, so nothing is predicted or measured without one. Touch is `navigator.maxTouchPoints > 0`, not `(pointer: coarse)`: Firefox for Android reports a fine pointer on touch screens that also take a stylus, and the bar stayed under the keyboard there.

**Letting the browser resize the page (Android).** While something is docked, keybry adds `interactive-widget=resizes-content` to the page's viewport tag, as ChatGPT and claude.ai ship it, and gives the tag back when nothing is docked. Chrome (108+) and Firefox (132+) on Android then shrink the page for the keyboard, and a bar at the bottom of the page moves with it; keybry measures 0 and moves nothing. Safari ignores the setting, and keybry moves the bar as before. A page that sets `interactive-widget` itself, or turns the VirtualKeyboard API's `overlaysContent` on, is left alone, and a page without a viewport tag isn't given one (that would change its whole layout). Chrome applies the tag when it changes, not only at load.

Why not Chrome's VirtualKeyboard API, which keybry used before:

- **Where the keyboard is.** Chrome reports the keyboard's height minus the navigation bar's (`KeyboardUtils.calculateKeyboardHeightFromWindowInsets`: the IME inset minus the bottom system bar inset), as if every page ended at the top of the navigation bar. Its visual viewport shrinks by the same number. With Chrome's bottom toolbar the page ends higher, and the bar floated 56px above the keyboard; drawn under the gesture bar (`viewport-fit=cover`), it ends lower, and the bar sat 24px behind it. A correction from the tap's `screenY - clientY` and `env(safe-area-max-inset-bottom)` fixed both, but leaned on numbers Chrome doesn't promise (`screen.availHeight` was the whole screen on a real phone's Chrome 156). Resizing uses Android's own keyboard position: on the keyboard to the pixel in every layout.
- **When a close is reported.** The API reported a close up to 0.3 s after the keyboard started to slide, and the bar then slid for 0.25 s. Resizing starts within a frame or two.

Measured on the lab emulator (Android 16, Gboard), against when and where Android says the keyboard is (`ImeTracker` in logcat, `dumpsys window`), in ms after the keyboard starts to move:

| Chrome 133 | bar starts / done, opening | bar starts / done, closing | on the keyboard |
| --- | --- | --- | --- |
| VirtualKeyboard API | 23–282 / 211–459 | 54–76 / 241–257 | −1px |
| resizes-content, with the hand-over | 14–29 / 139–618 | 5–25 / 25–44 | 0px |

On a Chromium 159 snapshot (slower: it runs translated) the VirtualKeyboard API closed at 90–345 / 250–446 ms, and resizing at 44–199 ms in one step (one close at 481 ms), in both Chrome layouts.

**Firefox.** With `resizes-content` the page's visible area can't slide under the keyboard. Before, a swipe on the page with the keyboard up hid Firefox's toolbar and slid the visible area, and the bar went 8px behind the keyboard (seen on a real phone and in the lab).

**Firefox's hidden toolbars.** While the keyboard is up, Firefox hides two of its bars: the navigation bar of the expanded toolbar (`BrowserNavigationBar(hideWhenKeyboardShown = true)`) and the tab bar when it's at the bottom (`TabStrip(hideWhenKeyboardShown = settings.shouldUseBottomTabStrip)`). It doesn't take them out of the room it keeps for its toolbars, though (`setDynamicToolbarMaxHeight(top + bottom)`, in `BaseBrowserFragment.kt`), so an empty strip stays below the page, and every number a page can read ends above it. Firefox's own sizes do tell it (`getBrowserToolbarHeight`, `getTopToolbarHeight`, `getBottomToolbarHeight`):

- the address bar is 64dp at the top, or at the bottom 64dp, 56dp with the navigation bar;
- the navigation bar is 60dp under an address bar at the top and 48dp under one at the bottom. It shows on windows over 480dp tall and up to 600dp wide;
- the tab bar (Settings › Customize › Show tab bar, then Top or Bottom) is 56dp, above the page or below it.

That makes 12 layouts. The room Firefox keeps, `100lvh - 100svh`, isn't enough to tell them apart. A tab bar above the page (nothing hides) and one below it (56px hides) add the same 56. The simple toolbar with a tab bar (120) is also 4px from the expanded one (124), and the first version of this took one for the other: the bar went 60px behind the keyboard with the tab bar on. So keybry also reads three numbers on the tap, with the keyboard down:

- where the page starts on the screen (`mozInnerScreenY`): the status bar, then whatever of Firefox is above the page;
- the screen less the page's window (`screen.height - outerHeight`): the status bar plus the system navigation bar;
- the bottom safe area. Firefox sets it to the system navigation bar, except with nothing above the page, where it's 0 (on 159).

It reads them only when Firefox's toolbars are all showing (the visible height is `100svh`); scrolled away, they move the page up. Each layout then implies a status bar height, from where the page starts. A layout fits if that leaves neither the status bar nor the system navigation bar negative, matches the safe area when that isn't 0, and adds up to the room. The room itself is read once per opening with the keyboard up, so a Firefox that fixes this, and stops keeping the room, no longer matches. Of the layouts that fit, the smallest strip wins. Two can fit when the safe area is 0 and a tab bar below the page (56px strip) looks like a tab bar above it with the address bar at the bottom (no strip, an 8px taller status bar). Then the bar may stay above a strip, but it never moves behind Firefox's address bar. When nothing fits (a tab-groups strip, a survey prompt, a Firefox that changed its sizes), there's no correction: the strip shows, which is never worse than before. The prediction still saves the keyboard's own height. The tap costs one style recalculation in Firefox, and an opening one more.

Measured in Firefox 159 on the lab emulator against Android's keyboard position: expanded with the address bar at the bottom, the bar went from 104px above the keyboard (address bar plus the 48px strip) to 56px (right on the address bar); at the top, from 60px to 0. Firefox draws the bar inside the strip. The simple toolbar is unchanged (0, or 64 on the address bar at the bottom).

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
- **The browser resizes the page on Android, instead of the VirtualKeyboard API.** From screenshots of a real phone (the bar 25px behind the keyboard with Chrome's toolbar at the top, 55px above it with the bottom bar), a slow close, and a comparison with ChatGPT and claude.ai. The first emulator runs used Chrome 133 on its default layout, the one layout where Chrome's number is right, and the lab checked the bar against Chrome's own number; the lab now checks it against the keyboard's position and timing from Android.

## Open questions (traces will answer)

- Does iOS Safari report the keyboard every frame, or only at the end? Either way is handled. Which one decides how visible the first-time correction is.
- Is 1000 ms the right starting `wait` on real phones? It grows by itself on slow devices; real Firefox traces will show how much margin it leaves.
- With its toolbar hidden, Firefox draws bottom-fixed elements away from where it reports, so the bar can slip under the keyboard while a whole-page scroll keeps the toolbar hidden. The README recommends scrolling only the message list, which avoids it. Is there a reading that reveals the offset?
- Is 32 ms the right `BLUR`? An app that blurs and refocuses over a longer gap would see a small bounce.
- **Known problem: Firefox doesn't always draw inside the strip.** It clips the page at the top of its bottom toolbars, and only draws below that when it has scrolled the focused field into view. On the lab emulator a bar moved into the strip was drawn when the focused field was inside it (the demo), with one exception: with the 116px strip (tab bar at the bottom, expanded toolbar, address bar at the top) it disappeared on a reopen and after a keyboard switch, twice in a row. When the focused field isn't inside the bar, the moved bar was never drawn, the 60px expanded-toolbar strip included. Then the bar is hidden, which is worse than the gap. Is there a reading that tells whether Firefox will draw there?
- Firefox's toolbar layouts were measured on one emulator (a 24dp status bar and gesture bar, 420 dpi). On real phones: does the bottom safe area follow the same rule, do 3-button navigation and taller status bars still leave one layout that fits, and do Firefox's CSS px stay within 4px of its dp sizes at other densities?
- How much does iOS pan the page when a docked input at the bottom gets focus, and how close is the saved height for the next time?
