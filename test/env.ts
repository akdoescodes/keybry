/**
 * The test env: a fake window that plays back a recorded trace, so the real engine runs on
 * recorded phone behaviour with nothing but timers faked. Record once, replay forever.
 */
import { vi } from 'vitest'
import { createKeyboard, type KeyboardState, type Options } from '../src/index'
import type { EventType, Sample, Target, Trace } from '../src/recorder'

export const MIN_KEYBOARD = 120

class FakeVirtualKeyboard extends EventTarget {
  overlaysContent = false
  height = 0
  get boundingRect() {
    // Like Chrome: the rect is only reported while overlaysContent is on.
    return { height: this.overlaysContent ? this.height : 0 } as DOMRect
  }
}

export const element = (t: Target) => ({
  tagName: t.tag,
  type: t.type ?? (t.tag == 'INPUT' ? 'text' : undefined),
  inputMode: t.mode ?? '',
  readOnly: !!t.readOnly,
  isContentEditable: !!t.editable,
})

export function fakeWindow(meta: Trace['meta'], first: Sample, storage = new Map<string, string>()) {
  const win: any = new EventTarget()
  const vv: any = new EventTarget()
  const vk = meta.vk ? new FakeVirtualKeyboard() : undefined
  const css = new Map<string, string>()
  const viewport = { content: 'width=device-width, initial-scale=1' }
  const doc = {
    activeElement: null as unknown,
    documentElement: {
      style: {
        setProperty: (k: string, v: string) => void css.set(k, v),
        removeProperty: (k: string) => void css.delete(k),
      },
    },
    // The page's viewport tag, which keybry extends while something is docked.
    querySelector: (q: string) => (q == 'meta[name=viewport]' ? viewport : null),
  }
  Object.assign(win, {
    document: doc,
    visualViewport: vv,
    navigator: { virtualKeyboard: vk, userAgent: meta.ua, maxTouchPoints: meta.touch },
    screen: {
      width: meta.screen[0],
      height: meta.screen[1],
      // Device orientation, from the visual viewport (page overflow can widen innerWidth, not this).
      get orientation() {
        const landscape = vv.width * vv.scale > Math.min(...meta.screen)
        return { type: landscape ? 'landscape-primary' : 'portrait-primary' }
      },
    },
    devicePixelRatio: meta.dpr,
    matchMedia: (q: string) => ({ matches: q.includes('coarse') ? meta.coarse : false }),
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, String(v)),
    },
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    requestAnimationFrame: (fn: (t: number) => void) => setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id: any) => clearTimeout(id),
    performance: { now: () => Date.now() },
  })

  /** Sets what the browser reports, without firing anything (a `frame` sample). */
  const apply = (s: Sample) => {
    Object.assign(win, { innerWidth: s.iw, innerHeight: s.ih })
    Object.assign(vv, { width: s.w, height: s.h, offsetTop: s.top, scale: s.scale })
    if (vk) vk.height = s.kb ?? 0
  }

  /** Fires a recorded event at the right target, keeping document.activeElement in step. */
  const fire = (type: EventType, extra?: Target | string) => {
    const target = typeof extra == 'object' ? element(extra) : undefined
    if (type == 'focusin') doc.activeElement = target
    if (type == 'focusout') doc.activeElement = null
    const [name, on] =
      type == 'vv.resize'
        ? ['resize', vv]
        : type == 'vv.scroll'
          ? ['scroll', vv]
          : type == 'geometrychange'
            ? [type, vk]
            : [type, win]
    dispatch(on, name, target)
  }

  /** Dispatches with a given target and composed path, as if it came from a real element. */
  const dispatch = (on: EventTarget | undefined, name: string, target?: unknown, path = target ? [target] : []) => {
    const e = new Event(name)
    Object.defineProperty(e, 'target', { value: target ?? on })
    Object.defineProperty(e, 'composedPath', { value: () => path })
    on?.dispatchEvent(e)
  }

  apply(first)
  return { win: win as Window, vk, css, doc, storage, viewport, apply, fire, dispatch }
}

/** What a docked bar should be at: how far the keyboard really covers the page. */
export const truth = (s: Sample, overlay: boolean) =>
  overlay ? (s.kb ?? 0) : Math.max(0, Math.round(s.ih - s.h - s.top))

export interface Replay {
  /** Every state the engine produced, with the ms it happened at. */
  states: [t: number, state: KeyboardState][]
  /** Where the bar should be, from the trace: [ms, px the keyboard really covers, a field is focused]. */
  truths: [t: number, truth: number, focused: boolean][]
  final: KeyboardState
  /** Still focused at the end of the trace. */
  focused: boolean
  storage: Map<string, string>
  css: Map<string, string>
}

/** Plays a trace through the real engine. Docks an element when the trace was recorded with one docked. */
export function replay(trace: Trace, options: Omit<Options, 'win'> & { storage?: Map<string, string> } = {}): Replay {
  vi.useFakeTimers({ now: 0 })
  try {
    const [, , first, focusedAtStart] = trace.events[0]
    const env = fakeWindow(trace.meta, first, options.storage)
    if (typeof focusedAtStart == 'object') env.doc.activeElement = element(focusedAtStart)
    // Recorded with overlaysContent on: replay it as a page that turned it on (keybry no longer does).
    const overlay = trace.events.some((e) => e[2].ov)
    if (overlay) env.vk!.overlaysContent = true
    const kb = createKeyboard({ ...options, win: env.win })
    if (overlay) kb.dock({ style: {} } as HTMLElement)
    const states: Replay['states'] = [[0, kb.state]]
    kb.subscribe((s) => states.push([Date.now(), s]))
    const truths: Replay['truths'] = []

    let focused = !!env.doc.activeElement
    for (const [at, type, sample, extra] of trace.events) {
      if (at > Date.now()) vi.advanceTimersByTime(at - Date.now())
      env.apply(sample)
      if (type != 'init' && type != 'frame' && type != 'mark') env.fire(type, extra)
      if (type == 'focusin') focused = true
      if (type == 'focusout') focused = false
      truths.push([at, truth(sample, overlay), focused])
    }
    vi.advanceTimersByTime(2000)
    const final = kb.state
    kb.destroy()
    return { states, truths, final, focused, storage: env.storage, css: env.css }
  } finally {
    vi.useRealTimers()
  }
}

/**
 * The longest stretch, in ms, that the keyboard covered a docked bar (by more than 2px) while a
 * field was focused. This is the number users notice: the bar hiding behind the keyboard.
 */
export const longestCovered = (r: Replay) => {
  const points = [
    ...r.truths.map(([t, truth, focused]) => ({ t, truth, focused })),
    ...r.states.map(([t, s]) => ({ t, height: s.height })),
  ].sort((a, b) => a.t - b.t)
  let truth = 0
  let height = 0
  let focused = false
  let since = -1
  let longest = 0
  for (const p of points) {
    if ('truth' in p) {
      truth = p.truth!
      focused = p.focused!
    } else height = p.height!
    const covered = focused && truth > height + 2
    if (covered && since < 0) since = p.t
    if (!covered && since >= 0) {
      longest = Math.max(longest, p.t - since)
      since = -1
    }
  }
  return since >= 0 ? Infinity : longest
}

/** Counts how often the bar changes direction (up then down, or down then up). */
export const reversals = (states: Replay['states']) => {
  let dir = 0
  let count = 0
  for (let i = 1; i < states.length; i++) {
    const d = Math.sign(states[i][1].height - states[i - 1][1].height)
    if (d && dir && d != dir) count++
    if (d) dir = d
  }
  return count
}
