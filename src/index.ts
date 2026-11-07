import { kindOf, type Kind } from './focus.js'

export type { Kind }

/** `opening`: a field was tapped and the bar is already moving to the predicted height. `open`: the keyboard has been measured. */
export type Phase = 'closed' | 'opening' | 'open'

/**
 * Where `height` came from.
 * - `exact`: the browser's VirtualKeyboard API (Chrome, Edge, Samsung Internet while something is docked).
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
   * Keeps an element above the keyboard by moving it with a GPU transform (no layout, no re-render).
   * The element should be anchored to the bottom of the page, e.g. `position: fixed; bottom: 0`.
   * Returns a function that undocks it.
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
   * @default 500
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

type Inner = (state: KeyboardState, animate?: boolean) => void

const { max, min, round } = Math

/** Written on <html>, for CSS: `transform: translateY(calc(-1 * var(--keyboard-height)))`. */
const VAR = '--keyboard-height'
const STORE = 'keybry'
/** A keyboard costs far more height than browser toolbars collapsing or expanding. */
const MIN = 120
/** After focus leaves a field, wait this long for another field to take it before closing. */
const BLUR = 100
/** A measurement below the prediction must hold this long before the bar corrects down to it. */
const CORRECT = 100
/** Close to the curve the iOS keyboard slides with. */
const EASE = 'transform .25s cubic-bezier(.38,.7,.125,1)'
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
  wait = 500,
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
  if (!win) return kb

  const doc = win.document
  const style = doc.documentElement.style
  const vv = win.visualViewport
  const vk = (win.navigator as { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard
  const coarse = win.matchMedia('(pointer:coarse)')
  const later = win.setTimeout.bind(win)
  const cancel = win.clearTimeout.bind(win)
  const raf = win.requestAnimationFrame.bind(win)
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
  let lastKb = 0
  let frame = 0
  /** When the current prediction started, and whether it was given up on before a keyboard came. */
  let predictedAt = 0
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

  const exact = () => !!vk && vk.overlaysContent

  /** Reads the browser. `kb` is the keyboard's own height; `inset` is how much of the page it covers. */
  const measure = () => {
    if (exact()) {
      // With overlaysContent nothing resizes: the keyboard simply covers its own height.
      const h = round(vk!.boundingRect.height)
      return { open: h > 0, inset: h, kb: h, turned: false }
    }
    const ih = win.innerHeight
    const w = round(vv ? vv.width : win.innerWidth)
    const h = vv ? vv.height : ih
    // The baseline is the tallest viewport seen at this width, not innerHeight: Safari and Chrome
    // keep innerHeight fixed while the keyboard is up, but Brave and Firefox shrink it too.
    // Rotation or a split-screen resize changes the width, which starts a fresh baseline.
    const turned = w != baseW
    baseH = turned ? max(h, ih) : max(baseH, h)
    baseW = w
    const keyboard = round(baseH - h)
    // iOS pans the visual viewport (offsetTop) while the keyboard is up; fixed elements don't move with it.
    const inset = max(0, round(ih - h - (vv ? vv.offsetTop : 0)))
    return {
      // A strip shorter than any keyboard (the iPad shortcut bar with a hardware keyboard, Chrome's
      // autofill bar) still covers a focused field's bar, so it counts once no prediction is pending.
      open: coarse.matches && (keyboard > MIN || (!!kind && !predicted && inset > 0)),
      inset,
      kb: keyboard,
      turned,
    }
  }

  const commit = (next: KeyboardState, animate: boolean, keyboard: number) => {
    lastKb = keyboard
    if (next.height == state.height && next.phase == state.phase && next.source == state.source) return
    // Save real heights, not iOS panning the page while the keyboard sits still.
    if (animate && kind && next.phase == 'open') learn(next.height)
    state = next
    style.setProperty(VAR, next.height + 'px')
    listeners.forEach((fn) => fn(next, animate))
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
        save('wait', min(3000, round((Date.now() - predictedAt) * 1.5)))
        gaveUp = false
      }
      predicted = 0
      cancel(waitTimer)
      next = make(m.inset, 'open', exact() ? 'exact' : 'measured')
    } else if (kind && predicted) {
      next = make(predicted, 'opening', 'predicted')
    }
    // Only real keyboard changes animate. iOS panning the page (same keyboard, new offsetTop) tracks instantly.
    const animate = next.phase != state.phase || m.kb != lastKb
    // Growing applies at once so nothing is ever covered, and so do panning and closing after focus
    // left. Anything smaller while a field is focused waits for the numbers to stop changing:
    // - while opening, the browser may be reporting every frame of the keyboard sliding in, and
    //   following that would drag the bar down from the prediction and back up;
    // - once open, it may be the dip of the keyboard closing and reopening between two fields.
    if (!animate || next.height >= state.height || m.turned || !kind) {
      commit(next, animate, m.kb)
    } else {
      settleTimer = later(() => commit(next, animate, m.kb), state.phase == 'opening' ? CORRECT : settle)
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
    if (!state.open && coarse.matches) {
      const id = keyFor(k)
      const [a, b, land] = screen()
      // 1. The height saved last time on this device. 2. When the exact API is on, it answers
      // within a frame, so don't guess. 3. The built-in table.
      const p =
        id in saved ? +saved[id] : exact() ? 0 : round((land ? a : b) * GUESS[(a >= 600 ? 2 : 0) + +land])
      if (p > 0) {
        predicted = p
        predictedAt = Date.now()
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
    cancel(blurTimer)
    blurTimer = later(() => {
      kind = kindOf(active())
      if (!kind) predicted = 0
      decide()
    }, BLUR)
  }

  const overlay = (change: number) => {
    docks += change
    // The exact numbers need overlaysContent, which stops Chrome from shrinking the page when the
    // keyboard opens. Only switch it on while something is docked, and give back the app's own value.
    if (vk) {
      vk.overlaysContent = docks > 0 || appOverlay
      sync()
    }
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
    const apply: Inner = (st, animate) => {
      s.transition = animate ? EASE : 'none'
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
    if (vk) vk.overlaysContent = appOverlay
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
