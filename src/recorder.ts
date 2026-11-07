import type { Keyboard, KeyboardState } from './index.js'

/** What the browser reported at one moment. */
export interface Sample {
  /** window.innerWidth / innerHeight */
  iw: number
  ih: number
  /** visualViewport width / height / offsetTop / scale (innerWidth/innerHeight when there is no visualViewport) */
  w: number
  h: number
  top: number
  scale: number
  /** VirtualKeyboard boundingRect height, where the API exists */
  kb?: number
  /** VirtualKeyboard overlaysContent at that moment */
  ov?: boolean
}

/** The element an event happened on, enough to tell which keyboard it asks for. */
export interface Target {
  tag: string
  type?: string
  mode?: string
  readOnly?: boolean
  editable?: boolean
}

export type EventType =
  | 'init'
  | 'frame'
  | 'vv.resize'
  | 'vv.scroll'
  | 'resize'
  | 'geometrychange'
  | 'focusin'
  | 'focusout'
  | 'click'
  | 'mark'

/**
 * `[ms since start, type, sample, target or note]`. `frame` events are not browser events: the recorder
 * polls every animation frame after something happens and logs any change the browser did not announce.
 * That is how a trace shows what the keyboard did between events, for example on iOS.
 */
export type TraceEvent = [t: number, type: EventType, sample: Sample, extra?: Target | string]

export interface Trace {
  v: 1
  meta: {
    ua: string
    /** screen.width, screen.height */
    screen: [number, number]
    dpr: number
    touch: number
    coarse: boolean
    /** Whether navigator.virtualKeyboard exists */
    vk: boolean
    date: string
    [extra: string]: unknown
  }
  events: TraceEvent[]
  /** The keyboard-dock states during the run, when a keyboard was passed to `record()`. */
  states?: [t: number, state: KeyboardState][]
}

export interface Recorder {
  /** The trace so far. Grows until `stop()`. */
  trace: Trace
  /** Adds a labelled marker, e.g. the step of a guided test. */
  mark(note: string): void
  /** Stops recording and returns the trace. */
  stop(): Trace
}

/** How long to keep polling frames after the last event. Longer than any keyboard animation. */
const WATCH_MS = 1000

/**
 * Records every keyboard-related browser event, plus per-frame changes in between, as a trace.
 * Traces replay in tests through a fake window, so one recording on a real phone becomes a
 * regression test forever.
 */
export function record({ win = window, keyboard }: { win?: Window; keyboard?: Keyboard } = {}): Recorder {
  const vv = win.visualViewport
  const vk = (win.navigator as any).virtualKeyboard as { boundingRect: DOMRect; overlaysContent: boolean } | undefined
  const perf = win.performance
  const t0 = perf.now()
  const now = () => Math.round((perf.now() - t0) * 10) / 10
  const trace: Trace = {
    v: 1,
    meta: {
      ua: win.navigator.userAgent,
      screen: [win.screen.width, win.screen.height],
      dpr: win.devicePixelRatio,
      touch: win.navigator.maxTouchPoints,
      coarse: win.matchMedia('(pointer:coarse)').matches,
      vk: !!vk,
      date: new Date().toISOString(),
    },
    events: [],
  }

  const sample = (): Sample => {
    const s: Sample = {
      iw: win.innerWidth,
      ih: win.innerHeight,
      w: vv ? vv.width : win.innerWidth,
      h: vv ? vv.height : win.innerHeight,
      top: vv ? vv.offsetTop : 0,
      scale: vv ? vv.scale : 1,
    }
    if (vk) {
      s.kb = vk.boundingRect.height
      s.ov = vk.overlaysContent
    }
    return s
  }

  let last = ''
  let until = 0
  let frame = 0

  const push = (type: EventType, extra?: Target | string) => {
    const s = sample()
    last = JSON.stringify(s)
    trace.events.push(extra === undefined ? [now(), type, s] : [now(), type, s, extra])
  }

  const poll = () => {
    frame = 0
    if (JSON.stringify(sample()) != last) push('frame')
    if (perf.now() < until) frame = win.requestAnimationFrame(poll)
  }

  const watch = () => {
    until = perf.now() + WATCH_MS
    if (!frame) frame = win.requestAnimationFrame(poll)
  }

  const describe = (el: any): Target | undefined =>
    el && el.tagName
      ? {
          tag: el.tagName,
          ...(el.type && { type: el.type }),
          ...(el.inputMode && { mode: el.inputMode }),
          ...((el.readOnly || el.disabled) && { readOnly: true }),
          ...(el.isContentEditable && { editable: true }),
        }
      : undefined

  const on = (type: EventType) => (e: Event) => {
    push(type, type == 'focusin' || type == 'focusout' || type == 'click' ? describe(e.composedPath()[0]) : undefined)
    watch()
  }

  const events: [EventTarget | null | undefined, string, (e: Event) => void][] = [
    [vv, 'resize', on('vv.resize')],
    [vv, 'scroll', on('vv.scroll')],
    [win, 'resize', on('resize')],
    [vk as EventTarget | undefined, 'geometrychange', on('geometrychange')],
    [win, 'focusin', on('focusin')],
    [win, 'focusout', on('focusout')],
    [win, 'click', on('click')],
  ]
  events.forEach(([t, type, fn]) => t && t.addEventListener(type, fn))

  let off = () => {}
  if (keyboard) {
    const states: [number, KeyboardState][] = [[now(), keyboard.state]]
    trace.states = states
    off = keyboard.subscribe((s) => states.push([now(), s]))
  }

  push('init', describe(win.document.activeElement))

  return {
    trace,
    mark: (note) => push('mark', note),
    stop() {
      events.forEach(([t, type, fn]) => t && t.removeEventListener(type, fn))
      win.cancelAnimationFrame(frame)
      off()
      return trace
    },
  }
}
