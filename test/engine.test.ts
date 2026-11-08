import { describe, expect, it, vi } from 'vitest'
import { createKeyboard } from '../src/index'
import { kindOf } from '../src/focus'
import { element, fakeWindow, longestCovered, replay, reversals } from './env'
import type { Sample } from '../src/recorder'
import { BUTTON, DESKTOP, IPAD, IPHONE, NUMBER, OTHER, PIXEL, TEXT, trace } from './scenarios'

const KB = 300 // Android keyboard in these scenarios
const IOS_KB = 336 // iPhone keyboard + accessory bar in these scenarios

/** Height and phase at a moment, from the replayed state timeline. */
const at = (r: ReturnType<typeof replay>, ms: number) => {
  let s = r.states[0][1]
  for (const [t, state] of r.states) if (t <= ms) s = state
  return s
}

const opened = (device = PIXEL, px = KB) =>
  trace(device).at(100, 'focusin', {}, TEXT).keyboard(400, px)

describe('focus: which keyboard a field opens', () => {
  it.each([
    [{ tag: 'INPUT', type: 'text' }, 'text'],
    [{ tag: 'INPUT', type: 'search' }, 'text'],
    [{ tag: 'INPUT', type: 'password' }, 'text'],
    [{ tag: 'TEXTAREA' }, 'text'],
    [{ tag: 'DIV', editable: true }, 'text'],
    [{ tag: 'INPUT', type: 'number' }, 'number'],
    [{ tag: 'INPUT', type: 'text', mode: 'numeric' }, 'number'],
    [{ tag: 'INPUT', type: 'text', mode: 'decimal' }, 'number'],
    [{ tag: 'INPUT', type: 'tel' }, 'tel'],
    [{ tag: 'INPUT', type: 'email' }, 'email'],
    [{ tag: 'INPUT', type: 'url' }, 'email'],
  ] as const)('%o opens %s', (t, kind) => expect(kindOf(element(t))).toBe(kind))

  it.each([
    { tag: 'INPUT', type: 'checkbox' },
    { tag: 'INPUT', type: 'date' },
    { tag: 'INPUT', type: 'range' },
    { tag: 'INPUT', type: 'text', readOnly: true },
    { tag: 'INPUT', type: 'text', mode: 'none' },
    { tag: 'BUTTON', type: 'submit' },
    { tag: 'DIV' },
  ])('%o opens nothing', (t) => expect(kindOf(element(t))).toBe(0))

  it('handles nothing focused', () => expect(kindOf(null)).toBe(0))
})

describe('Android Chrome, measured from the visual viewport', () => {
  const run = (storage?: Map<string, string>) =>
    replay(opened().at(3000, 'focusout').keyboard(3300, 0).end(4000), { storage })

  it('moves on focus, before the keyboard reports anything', () => {
    const r = run()
    expect(at(r, 120)).toMatchObject({ phase: 'opening', source: 'predicted' })
    expect(at(r, 120).height).toBeGreaterThanOrEqual(KB) // guesses tall
  })

  it('corrects to the measured height, is never covered, and closes after focus leaves', () => {
    const r = run()
    expect(at(r, 600)).toMatchObject({ phase: 'open', height: KB, source: 'measured' })
    expect(longestCovered(r)).toBe(0)
    expect(at(r, 3000 + 150)).toMatchObject({ phase: 'closed', height: 0 })
    expect(r.final.phase).toBe('closed')
  })

  it('learns: the second time the prediction is exact and the bar moves once', () => {
    const storage = new Map<string, string>()
    run(storage)
    expect(JSON.parse(storage.get('keybry')!)).toEqual({ textP412x915: KB })
    const r = run(storage)
    expect(at(r, 120)).toMatchObject({ phase: 'opening', height: KB })
    expect(reversals(r.states)).toBe(1) // up once, down once
  })

  it('writes the CSS variable, and removes it on destroy', () => {
    vi.useFakeTimers({ now: 0 })
    const t = trace(PIXEL).trace
    const env = fakeWindow(t.meta, t.events[0][2])
    const kb = createKeyboard({ win: env.win })
    expect(env.css.get('--keyboard-height')).toBe('0px')
    env.doc.activeElement = element(TEXT)
    env.fire('focusin', TEXT)
    env.apply({ ...t.events[0][2], h: 839 - KB })
    env.fire('vv.resize')
    vi.advanceTimersByTime(500)
    expect(env.css.get('--keyboard-height')).toBe(`${KB}px`)
    kb.destroy()
    expect(env.css.has('--keyboard-height')).toBe(false)
    vi.useRealTimers()
  })

  it('saves heights per keyboard kind', () => {
    const storage = new Map<string, string>()
    replay(
      opened()
        .at(2000, 'focusout')
        .keyboard(2200, 0)
        .at(3000, 'focusin', {}, NUMBER)
        .keyboard(3300, 220)
        .end(4000),
      { storage },
    )
    expect(JSON.parse(storage.get('keybry')!)).toEqual({ textP412x915: KB, numberP412x915: 220 })
  })
})

describe('Android Chrome, exact numbers from the VirtualKeyboard API', () => {
  const exact = () =>
    trace(PIXEL)
      .at(0, 'mark', { ov: true })
      .at(100, 'focusin', {}, TEXT)
      .exact(150, KB)
      .at(3000, 'focusout')
      .exact(3050, 0)
      .end(4000)

  it('does not guess when an exact answer is a frame away', () => {
    const r = replay(exact())
    expect(r.states.some(([, s]) => s.source == 'predicted')).toBe(false)
    expect(at(r, 200)).toMatchObject({ phase: 'open', height: KB, source: 'exact' })
    expect(longestCovered(r)).toBeLessThanOrEqual(20) // one frame
  })

  it('a page that turned overlaysContent on itself gets the exact numbers, and keeps its value', () => {
    vi.useFakeTimers({ now: 0 })
    const t = trace(PIXEL).trace
    const env = fakeWindow(t.meta, t.events[0][2])
    env.vk!.overlaysContent = true
    const kb = createKeyboard({ win: env.win })
    const undock = kb.dock({ style: {} } as HTMLElement)
    expect(env.viewport.content).toBe('width=device-width, initial-scale=1') // the page chose overlaysContent
    env.doc.activeElement = element(TEXT)
    env.fire('focusin', TEXT)
    env.apply({ ...t.events[0][2], kb: KB, ov: true })
    env.fire('geometrychange')
    vi.advanceTimersByTime(100)
    expect(kb.state).toMatchObject({ phase: 'open', height: KB, source: 'exact' })
    undock()
    kb.destroy()
    expect(env.vk!.overlaysContent).toBe(true)
    vi.useRealTimers()
  })
})

describe('docking asks the browser to resize the page (interactive-widget=resizes-content)', () => {
  it('only while something is docked, and gives the viewport tag back', () => {
    vi.useFakeTimers()
    const env = fakeWindow(trace(PIXEL).trace.meta, trace(PIXEL).trace.events[0][2])
    const kb = createKeyboard({ win: env.win })
    const before = env.viewport.content
    const undockA = kb.dock({ style: {} } as HTMLElement)
    const undockB = kb.dock({ style: {} } as HTMLElement)
    expect(env.viewport.content).toBe(before + ',interactive-widget=resizes-content')
    expect(env.vk!.overlaysContent).toBe(false) // the VirtualKeyboard API would stop the browser resizing
    undockA()
    undockA() // calling twice is harmless
    expect(env.viewport.content).toBe(before + ',interactive-widget=resizes-content')
    undockB()
    expect(env.viewport.content).toBe(before)
    kb.dock({ style: {} } as HTMLElement)
    kb.destroy() // destroying while docked gives it back too
    expect(env.viewport.content).toBe(before)
    vi.useRealTimers()
  })

  it("leaves a page's own interactive-widget alone", () => {
    vi.useFakeTimers()
    const env = fakeWindow(trace(PIXEL).trace.meta, trace(PIXEL).trace.events[0][2])
    env.viewport.content = 'width=device-width, interactive-widget=resizes-visual'
    const kb = createKeyboard({ win: env.win })
    kb.dock({ style: {} } as HTMLElement)
    expect(env.viewport.content).toBe('width=device-width, interactive-widget=resizes-visual')
    kb.destroy()
    vi.useRealTimers()
  })

  it('when the browser shrinks the page itself, the bar is left where the browser puts it', () => {
    // Chrome with resizes-content, measured in the lab: innerHeight and the visible height shrink together.
    const r = replay(
      trace({ ...PIXEL, ih: 811 })
        .at(100, 'focusin', {}, TEXT)
        .at(400, 'resize', { ih: 450, h: 450 })
        .at(401, 'vv.resize')
        .at(2000, 'focusout')
        .at(2300, 'resize', { ih: 811, h: 811 })
        .at(2301, 'vv.resize')
        .end(3000),
    )
    expect(at(r, 1000)).toMatchObject({ phase: 'open', height: 0 })
    expect(r.final).toMatchObject({ phase: 'closed', height: 0 })
  })
})

describe('iPhone Safari', () => {
  it('reports only at the end of the animation: the prediction covers the gap', () => {
    const r = replay(
      trace(IPHONE)
        .at(100, 'focusin', {}, TEXT)
        .slide(100, 0, IOS_KB, 300, 'frame') // the keyboard rises silently
        .keyboard(420, IOS_KB) // one event at the end
        .end(1500),
    )
    expect(longestCovered(r)).toBe(0)
    expect(r.final).toMatchObject({ phase: 'open', height: IOS_KB })
  })

  it('reports every frame: no wobble, the bar goes up once and corrects once', () => {
    const r = replay(trace(IPHONE).at(100, 'focusin', {}, TEXT).slide(110, 0, IOS_KB, 300).end(1500))
    expect(longestCovered(r)).toBe(0)
    expect(reversals(r.states)).toBeLessThanOrEqual(1)
    expect(r.final).toMatchObject({ phase: 'open', height: IOS_KB })
  })

  it('tracks the page panning under the keyboard instantly, without animating', () => {
    vi.useFakeTimers({ now: 0 })
    const t = trace(IPHONE).trace
    const env = fakeWindow(t.meta, t.events[0][2])
    const kb = createKeyboard({ win: env.win })
    const el = { style: {} as CSSStyleDeclaration } as HTMLElement
    kb.dock(el)
    env.doc.activeElement = element(TEXT)
    env.fire('focusin', TEXT)
    env.apply({ ...t.events[0][2], h: 664 - IOS_KB })
    env.fire('vv.resize')
    vi.advanceTimersByTime(200)
    expect(el.style.transform).toBe(`translateY(-${IOS_KB}px)`)
    expect(el.style.transition).toContain('transform')
    env.apply({ ...t.events[0][2], h: 664 - IOS_KB, top: 120 })
    env.fire('vv.scroll')
    vi.advanceTimersByTime(17)
    expect(kb.state.height).toBe(IOS_KB - 120)
    expect(el.style.transform).toBe(`translateY(-${IOS_KB - 120}px)`)
    expect(el.style.transition).toBe('none')
    kb.destroy()
    vi.useRealTimers()
  })
})

describe('browsers that shrink the page themselves (resizes-content in Chrome and Firefox, older Firefox, Brave)', () => {
  const shrink = () =>
    trace(PIXEL)
      .at(100, 'focusin', {}, TEXT)
      .at(400, 'vv.resize', { h: 839 - KB, ih: 839 - KB })
      .at(401, 'resize')
      .end(1500)

  it('reports open with nothing left to move, and learns the keyboard height for the next prediction', () => {
    const storage = new Map<string, string>()
    const first = replay(shrink(), { storage })
    expect(first.final).toMatchObject({ open: true, phase: 'open', height: 0 })
    expect(JSON.parse(storage.get('keybry')!)).toEqual({ textP412x915: KB })
    const second = replay(shrink(), { storage })
    expect(at(second, 120)).toMatchObject({ phase: 'opening', height: KB }) // lifted at once
    expect(second.final).toMatchObject({ phase: 'open', height: 0 }) // then the browser's
  })

  /** Docks a bar with `saved` as the saved height, focuses a field, then plays `browser` frame by frame. */
  const handover = (saved: number | undefined, browser: (env: ReturnType<typeof fakeWindow>, first: Sample) => void) => {
    vi.useFakeTimers({ now: 0 })
    const storage = new Map<string, string>()
    if (saved) storage.set('keybry', JSON.stringify({ textP412x915: saved }))
    const t = trace(PIXEL).trace
    const env = fakeWindow(t.meta, t.events[0][2], storage)
    const kb = createKeyboard({ win: env.win })
    const el = { style: {} as CSSStyleDeclaration } as HTMLElement
    kb.dock(el)
    env.doc.activeElement = element(TEXT)
    env.fire('focusin', TEXT)
    const lifted = el.style.transform
    vi.advanceTimersByTime(200)
    browser(env, t.events[0][2])
    const result = { lifted, transform: el.style.transform, transition: el.style.transition, state: kb.state }
    kb.destroy()
    vi.useRealTimers()
    return result
  }
  const frame = () => vi.advanceTimersByTime(17)

  it('hands the lift over to the browser in the same frame, without animating', () => {
    // Chrome with resizes-content: the page and the visible area shrink together.
    const r = handover(KB, (env, s) => {
      env.apply({ ...s, ih: 839 - KB, h: 839 - KB })
      env.fire('resize')
      frame()
    })
    expect(r.lifted).toBe(`translateY(-${KB}px)`) // the moment the field was tapped
    expect(r).toMatchObject({ transform: '', transition: 'none', state: { phase: 'open', height: 0 } })
  })

  it('when innerHeight shrinks a frame before the visible height (Firefox), the bar is never lifted twice', () => {
    const r = handover(KB, (env, s) => {
      env.apply({ ...s, ih: 839 - KB }) // the visible height hasn't caught up yet
      env.fire('resize')
      frame()
    })
    expect(r).toMatchObject({ transform: '', transition: 'none', state: { phase: 'opening', height: 0 } })
  })

  it('the first time, the guess hands over the same way', () => {
    const r = handover(undefined, (env, s) => {
      env.apply({ ...s, ih: 839 - KB, h: 839 - KB })
      env.fire('resize')
      frame()
    })
    expect(r.lifted).toBe('translateY(-384px)') // 42% of the screen
    expect(r).toMatchObject({ transform: '', transition: 'none', state: { phase: 'open', height: 0 } })
  })
})

describe('no on-screen keyboard', () => {
  it('iPad with a hardware keyboard: gives up after `wait`, then remembers', () => {
    const storage = new Map<string, string>()
    const run = () => replay(trace(IPAD).at(100, 'focusin', {}, TEXT).end(2000), { storage })
    const first = run()
    expect(at(first, 120).phase).toBe('opening')
    expect(at(first, 100 + 1000 + 150)).toMatchObject({ phase: 'closed', height: 0 })
    const second = run()
    expect(second.states).toHaveLength(1) // nothing ever moved
  })

  it('iPad with a hardware keyboard: the bar sits on the shortcut bar, and predicts it next time', () => {
    // The shortcut bar (or Chrome's autofill strip, seen on Android) is far shorter than a keyboard,
    // but it still covers a docked bar. It counts once the prediction is over.
    const storage = new Map<string, string>()
    const run = () =>
      replay(trace(IPAD).at(100, 'focusin', {}, TEXT).keyboard(150, 55).at(3000, 'focusout').end(4000), { storage })
    const first = run()
    expect(at(first, 300).phase).toBe('opening') // a 55px strip doesn't cancel the prediction early
    expect(at(first, 1300)).toMatchObject({ phase: 'open', height: 55 })
    expect(longestCovered(first)).toBe(0)
    const second = run()
    expect(at(second, 120)).toMatchObject({ height: 55 }) // learned: straight to the strip
    expect(reversals(second.states)).toBe(1)
    expect(JSON.parse(storage.get('keybry')!).wait).toBeUndefined() // a strip is not a slow keyboard
  })

  it('a slow keyboard is waited for longer next time, instead of bouncing every time', () => {
    // Seen on an Android emulator: Gboard can take longer than `wait` to show up. The first
    // time, the bar gives up and comes back down; after that it should wait long enough.
    const storage = new Map<string, string>()
    const slow = () =>
      replay(trace(PIXEL).at(100, 'focusin', {}, TEXT).keyboard(1700, KB).at(3500, 'focusout').end(4500), {
        storage,
      })
    const first = slow()
    expect(at(first, 1250).phase).toBe('closed') // gave up after 1000 ms
    expect(at(first, 1800)).toMatchObject({ phase: 'open', height: KB })
    const second = slow()
    const whileOpen = second.states.filter(([t]) => t > 100 && t < 2900).map(([, s]) => s.phase)
    expect(whileOpen).not.toContain('closed')
    expect(reversals(second.states)).toBe(1) // up once, down once at the end
  })

  it('a strip showing up before a slow keyboard still counts the keyboard as slow', () => {
    // Seen on the emulator with the visualViewport path: Chrome's 48px autofill bar appeared long
    // before Gboard. The strip must not hide that the keyboard was late.
    const storage = new Map<string, string>()
    replay(
      trace(PIXEL).at(100, 'focusin', {}, TEXT).keyboard(700, 48).keyboard(1500, KB).at(3000, 'focusout').end(4000),
      { storage },
    )
    expect(JSON.parse(storage.get('keybry')!).wait).toBeGreaterThan(500)
  })

  it('Firefox for Android: reports a fine pointer on a touch screen, and must still work', () => {
    // Recorded on Firefox 159 (Android 16): matchMedia('(pointer: coarse)') is false while
    // maxTouchPoints is 5. Trusting the media query left the bar under the keyboard.
    const firefox = { ...PIXEL, ua: 'Firefox for Android (synthetic)', vk: false }
    const t = trace(firefox).at(100, 'focusin', {}, TEXT).keyboard(400, 314).end(1500)
    t.meta.coarse = false
    t.meta.touch = 5
    const r = replay(t)
    expect(r.final).toMatchObject({ phase: 'open', height: 314 })
    expect(longestCovered(r)).toBe(0)
  })

  it('Firefox for Android: scrolling with the keyboard open hides the toolbar; the bar must stay on the keyboard', () => {
    // Real numbers from Firefox 159 on Android 16: scrolling hides the toolbar (innerHeight 807 -> 872)
    // and scrolls the visible area (offsetTop 0 -> 170) under a keyboard that never changes. The bar
    // used to float up to 164px above the keyboard for 900ms, waiting for a "shrinking keyboard" to settle.
    const firefox = { ...PIXEL, screen: [414, 920] as [number, number], iw: 414, ih: 807, ua: 'Firefox (synthetic)', vk: false }
    const b = trace(firefox).at(100, 'focusin', {}, TEXT).at(800, 'vv.resize', { h: 493 })
    const scroll: [number, number, number, number][] = [
      // [ms, innerHeight, visualViewport.height, offsetTop]
      [2000, 807, 493, 5], [2013, 807, 514, 57], [2047, 807, 520, 56], [2062, 807, 533, 57],
      [2137, 872, 557, 56], [2149, 872, 557, 58], [2213, 872, 557, 84], [2270, 872, 557, 101],
      [2338, 872, 557, 123], [2413, 872, 557, 152], [2493, 872, 557, 164], [2577, 872, 557, 170],
      // the toolbar comes back
      [5340, 807, 544, 170], [5358, 807, 522, 170], [5399, 807, 500, 170], [5458, 807, 493, 170],
    ]
    for (const [ms, ih, h, top] of scroll) b.at(ms, ih == 872 && ms == 2137 ? 'resize' : 'vv.scroll', { ih, h, top })
    const r = replay(b.end(6500))
    // A frame after each report (that isn't overtaken by another one first), the bar is where the keyboard is.
    scroll.forEach(([ms, ih, h, top], i) => {
      if (!scroll[i + 1] || scroll[i + 1][0] - ms > 20) expect(at(r, ms + 20).height, `at ${ms}ms`).toBe(ih - h - top)
    })
    expect(r.final).toMatchObject({ phase: 'open', height: 807 - 493 - 170 })
  })

  it('Firefox for Android: the toolbar coming back reports innerHeight a frame before the visible height; no flicker', () => {
    // Real numbers: innerHeight jumps 872 -> 807 while visualViewport.height still says 543.6, and
    // only 28ms later becomes 496. Following the first report moved the bar 48px down and back up.
    const firefox = { ...PIXEL, screen: [414, 920] as [number, number], iw: 414, ih: 807, ua: 'Firefox (synthetic)', vk: false }
    const r = replay(
      trace(firefox)
        .at(100, 'focusin', {}, TEXT)
        .at(800, 'vv.resize', { h: 493 })
        .at(2000, 'resize', { ih: 872, h: 557, top: 138.4 }) // toolbar hidden, scrolled
        .at(3000, 'resize', { ih: 807, h: 543.6 }) // toolbar back: innerHeight first...
        .at(3006, 'vv.resize')
        .at(3028, 'vv.resize', { h: 496 }) // ...the visible height a frame later
        .end(4000),
    )
    const heights = r.states.filter(([t]) => t >= 3000).map(([, s]) => s.height)
    expect(heights).not.toContain(Math.round(807 - 543.6 - 138.4)) // never the 125px glitch
    expect(at(r, 3060).height).toBe(Math.round(807 - 496 - 138.4))
  })

  it('Firefox for Android: scrolled to the end, the visible area reaches past the page bottom; the bar moves down', () => {
    // Real numbers: innerHeight 807, visible 493, offsetTop 378.7. The visible area ends 65px (Firefox's
    // toolbar height) below where a bottom:0 bar sits, so a plain fixed bar floats 65px above the keyboard.
    const firefox = { ...PIXEL, screen: [414, 920] as [number, number], iw: 414, ih: 807, ua: 'Firefox (synthetic)', vk: false }
    const r = replay(
      trace(firefox)
        .at(100, 'focusin', {}, TEXT)
        .at(800, 'vv.resize', { h: 493 })
        .at(2000, 'vv.scroll', { top: 179.5 })
        .at(3000, 'vv.scroll', { top: 378.7 })
        .end(4000),
    )
    expect(at(r, 2020).height).toBe(Math.round(807 - 493 - 179.5))
    expect(r.final).toMatchObject({ phase: 'open', height: -65 }) // 807 - 493 - 378.7, rounded
  })

  it('Firefox for Android: a keyboard that reports 750ms after focus does not make the bar bounce', () => {
    const storage = new Map<string, string>([['keybry', JSON.stringify({ textP412x915: KB })]])
    const r = replay(trace(PIXEL).at(100, 'focusin', {}, TEXT).keyboard(850, KB).end(2000), { storage })
    expect(r.states.map(([, s]) => s.phase)).toEqual(['closed', 'opening', 'open'])
    expect(reversals(r.states)).toBe(0)
  })

  it('desktop: focusing and resizing the window never opens', () => {
    const r = replay(
      trace(DESKTOP)
        .at(100, 'focusin', {}, TEXT)
        .at(400, 'resize', { h: 600, ih: 600 })
        .at(401, 'vv.resize')
        .end(1500),
    )
    expect(r.states).toHaveLength(1)
  })

  it('focusing a button does nothing', () => {
    const r = replay(trace(IPHONE).at(100, 'focusin', {}, BUTTON).end(1500))
    expect(r.states).toHaveLength(1)
  })
})

describe('no bounce', () => {
  const storage = () => {
    const s = new Map<string, string>()
    replay(opened().end(1000), { storage: s })
    return s
  }

  it('moving between fields keeps the bar still', () => {
    const r = replay(
      opened().at(2000, 'focusout').at(2000, 'focusin', {}, OTHER).end(4000),
      { storage: storage() },
    )
    expect(r.states.slice(1).every(([, s]) => s.open)).toBe(true)
    expect(r.final).toMatchObject({ phase: 'open', height: KB })
  })

  it('the keyboard closing and reopening between two fields is ignored', () => {
    const r = replay(
      opened()
        .at(2000, 'focusout')
        .at(2030, 'focusin', {}, OTHER)
        .keyboard(2060, 0) // keyboard starts closing...
        .keyboard(2250, KB) // ...and comes back
        .end(4000),
      { storage: storage() },
    )
    expect(reversals(r.states)).toBe(0)
    expect(r.states.filter(([t]) => t > 500).every(([, s]) => s.height == KB)).toBe(true)
  })

  it('Android back button hides the keyboard with focus kept: the bar goes down at once, tap reopens', () => {
    // Focus hasn't moved for a while, so the keyboard is really closing, not dipping between fields.
    const r = replay(
      opened()
        .keyboard(2000, 0) // back button
        .at(4000, 'click', {}, TEXT)
        .keyboard(4300, KB)
        .end(5000),
      { storage: storage() },
    )
    expect(at(r, 2000 + 20)).toMatchObject({ phase: 'closed', height: 0 })
    expect(at(r, 4020)).toMatchObject({ phase: 'opening', height: KB }) // predicted on tap
    expect(r.final).toMatchObject({ phase: 'open', height: KB })
  })

  it('Back right after focus moved is treated as a possible dip and waits', () => {
    const r = replay(opened().at(2000, 'focusout').at(2000, 'focusin', {}, OTHER).keyboard(2200, 0).end(3500), {
      storage: storage(),
    })
    expect(at(r, 2200 + 100)).toMatchObject({ phase: 'open' })
    expect(r.final).toMatchObject({ phase: 'closed' })
  })

  it('tapping outside closes within a couple of frames, before the browser even reports it', () => {
    const r = replay(opened().at(2000, 'focusout').keyboard(2300, 0).end(3000))
    expect(at(r, 2000 + 50)).toMatchObject({ phase: 'closed', height: 0 })
  })
})

describe('rotation', () => {
  it('starts a fresh baseline and measures the landscape keyboard', () => {
    const storage = new Map<string, string>()
    const r = replay(
      opened()
        .at(2000, 'resize', { iw: 915, ih: 340, w: 915, h: 140 })
        .at(2001, 'vv.resize')
        .end(3000),
      { storage },
    )
    expect(r.final).toMatchObject({ phase: 'open', height: 200 })
    expect(JSON.parse(storage.get('keybry')!)).toMatchObject({ textL412x915: 200 })
  })

  it('a page wider than the screen does not count as landscape', () => {
    // Found on the demo page: a header overflowing by 9px widened innerWidth from 412 to 421 on
    // Chrome Android, and the portrait keyboard got saved under landscape.
    const storage = new Map<string, string>()
    replay(trace(PIXEL).at(100, 'focusin', { iw: 421 }, TEXT).keyboard(400, KB).end(1500), { storage })
    expect(JSON.parse(storage.get('keybry')!)).toEqual({ textP412x915: KB })
  })

  it('a shorter landscape viewport is not mistaken for a keyboard', () => {
    const r = replay(
      opened()
        .keyboard(2000, 0) // back button: keyboard hidden, field still focused
        .at(3000, 'resize', { iw: 915, ih: 340, w: 915, h: 340 })
        .at(3001, 'vv.resize')
        .end(4000),
    )
    expect(r.final).toMatchObject({ open: false, phase: 'closed' })
  })
})

describe('how the bar moves when the keyboard closes', () => {
  /** Opens the keyboard on a fake window, then closes it with `close`; returns the docked element's transition. */
  const closeWith = (device: typeof PIXEL, close: (env: ReturnType<typeof fakeWindow>) => void) => {
    vi.useFakeTimers({ now: 0 })
    const t = trace(device).trace
    const env = fakeWindow(t.meta, t.events[0][2])
    if (env.vk) env.vk.overlaysContent = true // the exact path: a page that turned the API on
    const kb = createKeyboard({ win: env.win })
    const el = { style: {} as CSSStyleDeclaration } as HTMLElement
    kb.dock(el)
    env.doc.activeElement = element(TEXT)
    env.fire('focusin', TEXT)
    vi.advanceTimersByTime(100)
    if (device.vk) env.apply({ ...t.events[0][2], kb: KB, ov: true }), env.fire('geometrychange')
    else env.apply({ ...t.events[0][2], h: device.ih - KB }), env.fire('vv.resize')
    vi.advanceTimersByTime(2000)
    close(env)
    vi.advanceTimersByTime(40)
    const result = { phase: kb.state.phase, transition: String(el.style.transition) }
    kb.destroy()
    vi.useRealTimers()
    return result
  }
  // PIXEL has Chrome's VirtualKeyboard API (exact path); IPHONE has none (measured path, like Safari and Firefox).
  const back = (device: typeof PIXEL) => (env: ReturnType<typeof fakeWindow>) => {
    const s = { iw: device.iw, ih: device.ih, w: device.iw, h: device.ih, top: 0, scale: 1 }
    if (device.vk) env.apply({ ...s, kb: 0, ov: true }), env.fire('geometrychange')
    else env.apply(s), env.fire('vv.resize')
  }

  it('Back with the exact API (reported as the keyboard starts to close): down at once, sliding in step', () => {
    expect(closeWith(PIXEL, back(PIXEL))).toMatchObject({ phase: 'closed', transition: expect.stringContaining('.25s') })
  })

  it('Back on the measured path (reported once the keyboard is gone): down at once, catching up quickly', () => {
    expect(closeWith(IPHONE, back(IPHONE))).toMatchObject({ phase: 'closed', transition: expect.stringContaining('.12s') })
  })

  it('tapping outside (known before the keyboard moves): slides down in step with it', () => {
    const tapOut = (env: ReturnType<typeof fakeWindow>) => {
      env.doc.activeElement = null
      env.fire('focusout', TEXT)
    }
    expect(closeWith(IPHONE, tapOut)).toMatchObject({ phase: 'closed', transition: expect.stringContaining('.25s') })
  })
})

describe('web components', () => {
  it('sees a field inside a shadow root, on focus and after blur', () => {
    vi.useFakeTimers({ now: 0 })
    const t = trace(IPHONE).trace
    const env = fakeWindow(t.meta, t.events[0][2])
    const kb = createKeyboard({ win: env.win })
    const input = element(TEXT)
    // e.target is retargeted to the host; only composedPath()[0] is the real <input>.
    const host = { tagName: 'MY-INPUT', shadowRoot: { activeElement: input } }
    env.doc.activeElement = host
    env.dispatch(env.win as unknown as EventTarget, 'focusin', host, [input, host])
    expect(kb.state.phase).toBe('opening')
    // Focus moves between two fields inside the same component: the document only sees the host.
    env.dispatch(env.win as unknown as EventTarget, 'focusout', host, [input, host])
    vi.advanceTimersByTime(200)
    expect(kb.state.phase).toBe('opening') // still focused, so no close
    kb.destroy()
    vi.useRealTimers()
  })
})

describe('server rendering', () => {
  it('does nothing without a window', () => {
    const kb = createKeyboard({ win: undefined })
    expect(kb.state).toMatchObject({ open: false, height: 0, phase: 'closed' })
    const off = kb.subscribe(() => {})
    off()
    kb.dock({} as HTMLElement)()
    kb.destroy()
  })
})
