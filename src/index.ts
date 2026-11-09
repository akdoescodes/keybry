import { kindOf, type Kind } from './focus.js'

export type { Kind }

/** `opening`: a field was tapped and the bar is already moving to the predicted height. `open`: the keyboard has been measured. */
export type Phase = 'closed' | 'opening' | 'open'

/**
 * Where `height` came from.
 * - `exact`: the browser's VirtualKeyboard API, on pages that turned its `overlaysContent` on themselves.
 *   (While something is docked, keybry asks Chromium and Firefox to resize the page instead: see `dock()`.)
 * - `measured`: worked out from the visual viewport.
 * - `predicted`: a guess made the moment a field was focused, before the keyboard reported anything.
 */
export type Source = 'predicted' | 'measured' | 'exact'

export interface KeyboardState {
  /** True while an on-screen keyboard is up, or predicted to be coming up. */
  open: boolean
  /**
   * How many pixels of the page the keyboard covers, so how far bottom-anchored UI must move up.
   * This is 0 in browsers that shrink the page themselves (Firefox, Brave), even though `open` is true.
   */
  height: number
  phase: Phase
  source: Source
}

export type Listener = (state: KeyboardState) => void

export interface Keyboard {
  /** The current state. A new object on every change, so comparing by reference is safe. */
  readonly state: KeyboardState
  /** Called on every change. Returns a function that stops listening. */
  subscribe(listener: Listener): () => void
  /**
   * Keeps an element above the keyboard. The element should be anchored to the bottom of the page, e.g.
   * `position: fixed; bottom: 0`. While anything is docked, keybry adds `interactive-widget=resizes-content` to
   * the page's viewport tag, so Chrome and Firefox on Android shrink the page for the keyboard and move the
   * element themselves. Where the browser doesn't (Safari), keybry moves it with a GPU transform (no layout,
   * no re-render). Returns a function that undocks it.
   */
  dock(el: HTMLElement): () => void
  /** Removes every listener and resets the CSS variable. */
  destroy(): void
}

export interface Options {
  /**
   * The window to read from. Everything the engine knows about the browser comes through here,
   * so tests pass a fake window that plays back a recorded trace.
   * @default window (when there is no window, as during server rendering, the keyboard stays closed and does nothing)
   */
  win?: Window
  /**
   * How long, in ms, to wait for an on-screen keyboard after a field is focused before deciding
   * there isn't one (a hardware keyboard, or the floating iPad keyboard).
   * @default 1000
   */
  wait?: number
  /**
   * How long, in ms, a keyboard must stay smaller before the UI follows it down. Switching fields
   * can close and reopen the keyboard within a few hundred ms; following that dip makes the bar bounce.
   * @default 300
   */
  settle?: number
}

/** The subset of the VirtualKeyboard API used here (Chromium only). */
interface VirtualKeyboard extends EventTarget {
  overlaysContent: boolean
  boundingRect: DOMRect
}

/** 0: jump. 1: slide in step with a keyboard that starts moving now. 2: catch up quickly with one that already has. */
type Motion = 0 | 1 | 2
type Inner = (state: KeyboardState, motion?: Motion) => void

const { abs, max, min, round } = Math

/** Written on <html>, for CSS: `transform: translateY(calc(-1 * var(--keyboard-height)))`. */
const VAR = '--keyboard-height'
const STORE = 'keybry'
/** A keyboard costs far more height than browser toolbars collapsing or expanding. */
const MIN = 120
/**
 * After focus leaves a field, wait this long (two frames) for another field to take it before closing.
 * Moving between fields, and an app refocusing in the same task or a timeout, all land within it.
 */
const BLUR = 32
/** A measurement below the prediction must hold this long before the bar corrects down to it. */
const CORRECT = 100
/**
 * A keyboard going away this soon after focus moved may come right back for the new field, so the bar
 * waits `settle` before following. Later than that (the Android Back button, the keyboard's own hide
 * key), it is really closing and the bar goes down with it.
 */
const DIP = 500
/** Close to the curve the iOS keyboard slides with. */
const CURVE = ' cubic-bezier(.38,.7,.125,1)'
/**
 * The built-in table: a first-time guess as a share of the screen height, for
 * [phone portrait, phone landscape, tablet portrait, tablet landscape].
 * Deliberately on the tall side. A bar that starts a little high and settles down looks fine;
 * a bar hidden behind the keyboard does not. Recorded traces replace these numbers over time,
 * and after the first real open, the saved height for the device is used instead.
 */
const GUESS = [0.42, 0.6, 0.34, 0.5]

const make = (height: number, phase: Phase, source: Source): KeyboardState => ({
  open: phase != 'closed',
  height,
  phase,
  source,
})

const CLOSED = make(0, 'closed', 'measured')

/**
 * Creates a keyboard tracker. Most apps should use the shared one from `keyboard()` instead;
 * this is for tests (pass `win`) and for custom timings.
 */
export function createKeyboard({
  win = typeof window != 'undefined' ? window : undefined,
  wait = 1000,
  settle = 300,
}: Options = {}): Keyboard {
  let state = CLOSED
  const listeners = new Set<Inner>()
  const kb: Keyboard = {
    get state() {
      return state
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    dock: () => () => {},
    destroy() {},
  }
  // Server rendering: no window, so stay closed and do nothing.
  // Also without visualViewport (browsers before 2019): nothing to measure with, so nothing moves.
  if (!win || !win.visualViewport) return kb

  const doc = win.document
  const style = doc.documentElement.style
  const vv = win.visualViewport
  const vk = (win.navigator as { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard
  // A touch screen, so an on-screen keyboard is possible. Not matchMedia('(pointer: coarse)'): Firefox
  // for Android reports a fine pointer on phones (seen on 159), which left the bar under the keyboard.
  const touch = win.navigator.maxTouchPoints > 0
  const later = win.setTimeout.bind(win)
  const cancel = win.clearTimeout.bind(win)
  const raf = win.requestAnimationFrame.bind(win)
  const now = Date.now // read here, not at import, so a test's fake clock is the one used
  const appOverlay = !!vk && vk.overlaysContent

  // Saved heights, keyed by keyboard kind, orientation and screen size. localStorage first;
  // if that throws (private mode, sandboxed iframe) the object simply lives in memory.
  let saved: Record<string, number> = {}
  try {
    saved = Object(JSON.parse(win.localStorage.getItem(STORE)!))
  } catch {}

  /** The focused element, looking inside web components (their shadow roots hide the real <input>). */
  const active = () => {
    let el = doc.activeElement
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement
    return el
  }

  let kind = kindOf(active())
  let predicted = 0
  let docks = 0
  let baseW = 0
  let baseH = 0
  let lastIh = 0
  let lastKb = 0
  let frame = 0
  /** When the current prediction started, and whether it was given up on before a keyboard came. */
  let predictedAt = 0
  /** innerHeight when the prediction started: how much the page itself has shrunk since is the browser's share. */
  let focusIh = 0
  /** Firefox for Android: the empty room below the page while the keyboard is up (see firefoxStrip()). */
  let strip = 0
  /** When focus last left a field (moving between fields always passes through here). */
  let moved = 0
  let gaveUp = false
  let waitTimer: any
  let settleTimer: any
  let blurTimer: any

  /**
   * [short screen side, long screen side, landscape?]. Orientation comes from the device, not the
   * page: a page that overflows sideways widens innerWidth on mobile, which would file a portrait
   * keyboard under landscape. innerWidth is only the fallback for iOS before 16.4.
   */
  const screen = (): [number, number, boolean] => {
    const { width, height, orientation } = win.screen
    const a = min(width, height)
    return [a, max(width, height), orientation ? orientation.type[0] == 'l' : win.innerWidth > a]
  }

  const keyFor = (k: Kind) => {
    const [a, b, land] = screen()
    return k + (land ? 'L' : 'P') + a + 'x' + b
  }

  const save = (id: string, value: number) => {
    if (saved[id] !== value) {
      saved[id] = value
      try {
        win.localStorage.setItem(STORE, JSON.stringify(saved))
      } catch {}
    }
  }

  const learn = (height: number) => save(keyFor(kind as Kind), height)

  const exact = () => vk?.overlaysContent

  const firefox = touch && /Firefox/.test(win.navigator.userAgent)
  /**
   * Firefox for Android, read on a tap with the keyboard down (see focus()): where the page starts on the screen (NaN
   * unless all of Firefox's toolbars are showing), the screen's height less the page's window (the status bar and the
   * system navigation bar), and the bottom safe area.
   */
  let page = [NaN, 0, 0]
  /** Sizes a fixed element with `css` and reads it back: a style recalculation, so only on a tap or an opening. */
  const probe = (css: string) => {
    const el = doc.createElement('i')
    el.style.cssText = 'position:fixed;' + css
    doc.documentElement.append(el)
    const r = el.getBoundingClientRect()
    el.remove()
    return r
  }
  /**
   * Firefox for Android hides its navigation bar (the expanded toolbar) and a tab bar at the bottom while the keyboard
   * is up, but goes on leaving room for them below the page (it doesn't update setDynamicToolbarMaxHeight): an empty
   * strip between the bar and Firefox's address bar or the keyboard, which no number a page can read covers.
   *
   * Firefox's own sizes tell it. In dp, which its CSS px are give or take a few per cent (getBrowserToolbarHeight,
   * getTopToolbarHeight, getBottomToolbarHeight in Firefox's source): the address bar is 64 at the top, or at the
   * bottom 64, 56 with the navigation bar; the navigation bar is 60 under an address bar at the top, 48 under one at
   * the bottom; the tab bar is 56, above the page or below it. The room Firefox keeps for all of them is
   * 100lvh - 100svh, but that can't tell a tab bar above the page (nothing hides) from one below it, and the simple
   * toolbar with a tab bar is 4px from the expanded one. Where the page starts on the screen tells what's above
   * it, less the status bar. The status bar and the system navigation bar under the window add up to the screen less
   * the window, and neither can be negative. Firefox gives the system navigation bar as the bottom safe area, except
   * (on 159) with nothing above the page, where it's 0; when it isn't 0, it pins the status bar exactly.
   *
   * Every layout that fits all of that is a candidate, and the smallest strip wins: when two still fit, the bar may
   * stay above a strip, but never moves behind Firefox's address bar. Nothing fits (a survey prompt, toolbars
   * scrolled away, a Firefox that changed): no correction. The room is read once per opening, with the keyboard up, so
   * a Firefox that stops keeping it no longer matches. Until then a prediction uses the strip from the last opening.
   */
  const firefoxStrip = () => {
    const room = probe('height:calc(100lvh - 100svh)').height
    const [top, bars, inset] = page
    let strip = 1e3
    for (const url of [0, 64]) // the address bar: at the bottom (nothing above the page), or at the top
      for (const nav of [0, url ? 60 : 48]) // the navigation bar, below the page
        for (const tabs of [0, 56, -56]) {
          // The tab bar: none, above the page, or below it. If this is the layout, the status bar is:
          const status = top - url - max(tabs, 0)
          if (
            abs(room - url - (url ? 0 : nav ? 56 : 64) - nav - abs(tabs)) < 4 &&
            min(status, bars - status) > -4 &&
            (!inset || abs(bars - status - inset) < 4)
          )
            strip = min(strip, nav - min(tabs, 0)) // what hides: the navigation bar, and a tab bar below the page
        }
    return strip % 1e3
  }

  /** Reads the browser. `kb` is the keyboard's own height; `inset` is how much of the page it covers. */
  const measure = (): { open: boolean; inset: number; kb: number; turned?: boolean; jumped?: boolean } => {
    if (exact()) {
      // With overlaysContent nothing resizes: the keyboard simply covers its own height. (On Android, Chrome
      // measures it from the top of the navigation bar, so pages that don't end there are off by the difference:
      // one reason keybry asks for resizes-content instead. See docs/design.md.)
      const h = round(vk!.boundingRect.height)
      return { open: h > 0, inset: h, kb: h }
    }
    const ih = win.innerHeight
    const w = round(vv.width)
    const h = vv.height
    // Firefox reports a new innerHeight (its toolbar sliding in or out) a frame before the visible
    // height that goes with it. Until the second number arrives, the first can't be trusted.
    const jumped = ih != lastIh
    lastIh = ih
    // The baseline is the tallest viewport seen at this width, not innerHeight: Safari and Chrome
    // keep innerHeight fixed while the keyboard is up, but Brave and Firefox shrink it too.
    // Rotation or a split-screen resize changes the width, which starts a fresh baseline.
    const turned = w != baseW
    baseH = turned ? max(h, ih) : max(baseH, h)
    baseW = w
    const keyboard = round(baseH - h)
    // iOS pans the visual viewport (offsetTop) while the keyboard is up; fixed elements don't move with it.
    // Not clamped at 0: scrolled to the end, Firefox lets the visible area reach up to its toolbar's
    // height past the bottom a fixed bar sits at, and the bar has to move down to meet the keyboard.
    const inset = round(ih - h - vv.offsetTop)
    return {
      // A strip shorter than any keyboard (the iPad shortcut bar with a hardware keyboard, Chrome's
      // autofill bar) still covers a focused field's bar, so it counts once no prediction is pending.
      open: touch && (keyboard > MIN || (!!kind && !predicted && inset > 0)),
      inset,
      kb: keyboard,
      turned,
      jumped,
    }
  }

  const commit = (next: KeyboardState, motion: Motion, keyboard: number) => {
    lastKb = keyboard
    if (next.height == state.height && next.phase == state.phase && next.source == state.source) return
    // Save real heights, not iOS panning the page while the keyboard sits still. Where the browser lifted the bar
    // itself (0 left for keybry), save the keyboard's height: what the next prediction should lift it by.
    if (motion && kind && next.phase == 'open') learn(next.height + strip || keyboard)
    state = next
    style.setProperty(VAR, next.height + 'px')
    listeners.forEach((fn) => fn(next, motion))
  }

  /** Decides which number to trust, then moves now or after `settle`. */
  const decide = () => {
    frame = 0
    cancel(settleTimer)
    const m = measure()
    let next = CLOSED
    if (kind && m.open) {
      // A keyboard came after we gave up on it: it is just slow here. Wait longer from now on.
      // (A strip shorter than a keyboard may come first; it doesn't settle the question.)
      if (gaveUp && m.kb > MIN) {
        save('wait', min(3000, round((now() - predictedAt) * 1.5)))
        gaveUp = false
      }
      predicted = 0
      cancel(waitTimer)
      // Once per opening, with the keyboard up: when the strip is there to measure. A Firefox that stops keeping
      // the room no longer matches, and the bar stays where Firefox puts it.
      if (firefox && state.phase != 'open') strip = firefoxStrip()
      next = make(m.inset - strip, 'open', exact() ? 'exact' : 'measured')
    } else if (kind && predicted) {
      // The page may have got shorter for the keyboard already (see dock()): the browser has lifted the bar that
      // much, so keybry lifts it that much less.
      next = make(max(0, predicted - max(0, focusIh - win.innerHeight)) - strip, 'opening', 'predicted')
    }
    // The browser moved the bar this frame, by resizing the page: take over from it in the same frame, without
    // animating, or the bar is lifted twice (it sat a whole keyboard too high for 0.1 s on Chrome). Then save the
    // keyboard's own height: the next prediction lifts the bar exactly as far as the page will shrink, and the
    // browser takes over without a visible move.
    const handover = m.jumped && !exact() && kind && (next.phase == 'opening' || (m.open && !m.inset))
    if (handover && m.open) learn(m.kb)
    // Animate when the keyboard opens or closes, and when the exact API reports a new size (it does so
    // as the keyboard starts to move). Anything else tracks instantly: on the measured path, changes
    // while open are the browser scrolling or its toolbar sliding (Firefox hides the toolbar and
    // scrolls the visible area under an open keyboard; iOS pans the page), never worth waiting for.
    const animate = next.phase != state.phase || m.turned || (exact() && m.kb != lastKb)
    // How to move. The exact API reports as the keyboard starts to move, and focus and blur come
    // before it moves, so those slide in step with it. A measurement on the other path arrives once
    // the keyboard has finished moving (Firefox: ~0.3 s after closing starts), so catch up quickly.
    const motion: Motion = animate && !handover ? (!exact() && kind && next.phase != 'opening' ? 2 : 1) : 0
    // Growing applies at once so nothing is ever covered, and so do those instant changes and closing
    // after focus left. Opening, closing or resizing while a field is focused waits for the numbers
    // to stop changing:
    // - while opening, the browser may be reporting every frame of the keyboard sliding in, and
    //   following that would drag the bar down from the prediction and back up;
    // - right after focus moved, it may be the dip of the keyboard closing and reopening for the new
    //   field. With focus unchanged for longer (Android Back, the keyboard's hide key) it is really
    //   closing, so the bar goes down at once.
    // An instant change right after innerHeight jumped waits for the matching visible height too.
    if (
      handover ||
      (!animate && !m.jumped) ||
      next.height >= state.height ||
      m.turned ||
      !kind ||
      (animate && state.phase != 'opening' && now() - moved > DIP)
    ) {
      commit(next, motion, m.kb)
    } else {
      settleTimer = later(() => commit(next, motion, m.kb), state.phase == 'opening' || !animate ? CORRECT : settle)
    }
  }

  const sync = () => {
    frame ||= raf(decide)
  }

  const focus = (e: Event) => {
    // composedPath()[0] is the real field, even inside a shadow root (e.target would be the host).
    const k = kindOf(e.composedPath()[0])
    if (!k) return
    cancel(blurTimer)
    kind = k
    if (!state.open && touch) {
      if (firefox) {
        // For firefoxStrip(): read with the keyboard down, which takes the safe area while it's up. Where the page
        // starts only counts with all of Firefox's toolbars showing (the visible height is 100svh): scrolled away,
        // they move it up.
        const r = probe('height:100svh;width:env(safe-area-inset-bottom)')
        page = [
          abs(vv.height - r.height) < 1 ? (win as { mozInnerScreenY?: number }).mozInnerScreenY! : NaN,
          win.screen.height - win.outerHeight,
          r.width,
        ]
      }
      const id = keyFor(k)
      const [a, b, land] = screen()
      // 1. The height saved last time on this device. 2. When the exact API is on, it answers
      // within a frame, so don't guess. 3. The built-in table.
      const p =
        id in saved ? +saved[id] : exact() ? 0 : round((land ? a : b) * GUESS[(a >= 600 ? 2 : 0) + +land])
      if (p > 0) {
        predicted = p
        predictedAt = now()
        focusIh = win.innerHeight
        gaveUp = false
        cancel(waitTimer)
        waitTimer = later(
          () => {
            // Nothing showed up: a hardware keyboard or a floating one. Remember, so next time nothing
            // moves. If a keyboard turns up after all, it was only slow, and the wait grows instead.
            if (predicted) {
              predicted = 0
              gaveUp = true
              learn(0)
              decide()
            }
          },
          max(wait, +saved.wait || 0),
        )
      }
    }
    decide()
  }

  const blur = () => {
    moved = now()
    cancel(blurTimer)
    blurTimer = later(() => {
      kind = kindOf(active())
      if (!kind) predicted = 0
      decide()
    }, BLUR)
  }

  /**
   * While something is docked, ask the browser to resize the page for the keyboard
   * (`interactive-widget=resizes-content`, as ChatGPT and claude.ai do). Chrome and Firefox on Android then move
   * a bar at the bottom of the page themselves, as the keyboard starts to move, and from where Android says the
   * keyboard is: the bar drops within a frame or two of a close, and toolbars and the gesture bar don't matter.
   * keybry measures 0 there and moves nothing. Safari ignores the setting, and keybry moves the bar.
   * A page that chose its own interactive-widget, or turned the VirtualKeyboard API's overlaysContent on, is
   * left alone. Only an existing viewport tag is changed: adding one would change the page's whole layout.
   */
  const meta = doc.querySelector<HTMLMetaElement>('meta[name=viewport]')
  const own = meta ? meta.content : ''
  const overlay = (change: number) => {
    docks += change
    // No sync(): if the change resizes the page (the keyboard is up), the browser says so with a resize event.
    if (meta && !appOverlay && !/interactive-widget/.test(own))
      meta.content = docks > 0 ? own + ',interactive-widget=resizes-content' : own
  }

  const events: [EventTarget | null | undefined, string, (e: Event) => void][] = [
    [vv, 'resize', sync],
    [vv, 'scroll', sync],
    [win, 'resize', sync],
    [vk, 'geometrychange', sync],
    [win, 'focusin', focus],
    // Tapping a field that is already focused reopens a keyboard dismissed with the Android back button.
    [win, 'click', focus],
    [win, 'focusout', blur],
  ]
  const listen = (on: boolean) =>
    events.forEach(([target, type, fn]) => target && target[on ? 'addEventListener' : 'removeEventListener'](type, fn))

  kb.dock = (el) => {
    const s = el.style
    let docked = true
    const apply: Inner = (st, motion) => {
      s.transition = motion ? 'transform .' + (motion > 1 ? 12 : 25) + 's' + CURVE : 'none'
      s.transform = st.height ? `translateY(${-st.height}px)` : ''
    }
    s.willChange = 'transform'
    apply(state)
    listeners.add(apply)
    overlay(1)
    return () => {
      if (docked) {
        docked = false
        listeners.delete(apply)
        overlay(-1)
        s.transform = s.transition = s.willChange = ''
      }
    }
  }

  kb.destroy = () => {
    listen(false)
    ;[waitTimer, settleTimer, blurTimer].forEach(cancel)
    listeners.clear()
    if (docks) overlay(-docks)
    style.removeProperty(VAR)
  }

  style.setProperty(VAR, '0px')
  listen(true)
  sync()
  return kb
}

let shared: Keyboard | undefined

/** The shared keyboard tracker for this page, created on first use. */
export const keyboard = (): Keyboard => shared || (shared = createKeyboard())

/** Keeps an element above the keyboard. Shortcut for `keyboard().dock(el)`. Returns a function that undocks it. */
export const dock = (el: HTMLElement): (() => void) => keyboard().dock(el)
