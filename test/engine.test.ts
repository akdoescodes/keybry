import { describe, expect, it, vi } from 'vitest'
import { createKeyboard } from '../src/index'
import { kindOf } from '../src/focus'
import { element, fakeWindow, longestCovered, replay, reversals } from './env'
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
    expect(JSON.parse(storage.get('keyboard-dock')!)).toEqual({ textP412x915: KB })
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
    expect(JSON.parse(storage.get('keyboard-dock')!)).toEqual({ textP412x915: KB, numberP412x915: 220 })
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

  it('switches overlaysContent on only while something is docked, and restores it', () => {
    vi.useFakeTimers()
    const env = fakeWindow(trace(PIXEL).trace.meta, trace(PIXEL).trace.events[0][2])
    const kb = createKeyboard({ win: env.win })
    expect(env.vk!.overlaysContent).toBe(false)
    const undockA = kb.dock({ style: {} } as HTMLElement)
    const undockB = kb.dock({ style: {} } as HTMLElement)
    expect(env.vk!.overlaysContent).toBe(true)
    undockA()
    undockA() // calling twice is harmless
    expect(env.vk!.overlaysContent).toBe(true)
    undockB()
    expect(env.vk!.overlaysContent).toBe(false)
    kb.destroy()
    vi.useRealTimers()
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

describe('browsers that shrink the page themselves (Firefox, Brave)', () => {
  const shrink = () =>
    trace(PIXEL)
      .at(100, 'focusin', {}, TEXT)
      .at(400, 'vv.resize', { h: 839 - KB, ih: 839 - KB })
      .at(401, 'resize')
      .end(1500)

  it('reports open with nothing to move, and learns not to predict', () => {
    const storage = new Map<string, string>()
    const first = replay(shrink(), { storage })
    expect(first.final).toMatchObject({ open: true, phase: 'open', height: 0 })
    const second = replay(shrink(), { storage })
    expect(second.states.every(([, s]) => s.height == 0)).toBe(true)
  })
})

describe('no on-screen keyboard', () => {
  it('iPad with a hardware keyboard: gives up after `wait`, then remembers', () => {
    const storage = new Map<string, string>()
    const run = () => replay(trace(IPAD).at(100, 'focusin', {}, TEXT).end(2000), { storage })
    const first = run()
    expect(at(first, 120).phase).toBe('opening')
    expect(at(first, 100 + 500 + 150)).toMatchObject({ phase: 'closed', height: 0 })
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
    expect(at(first, 1000)).toMatchObject({ phase: 'open', height: 55 })
    expect(longestCovered(first)).toBe(0)
    const second = run()
    expect(at(second, 120)).toMatchObject({ height: 55 }) // learned: straight to the strip
    expect(reversals(second.states)).toBe(1)
    expect(JSON.parse(storage.get('keyboard-dock')!).wait).toBeUndefined() // a strip is not a slow keyboard
  })

  it('a slow keyboard is waited for longer next time, instead of bouncing every time', () => {
    // Seen on an Android emulator: Gboard can take longer than `wait` to show up. The first
    // time, the bar gives up and comes back down; after that it should wait long enough.
    const storage = new Map<string, string>()
    const slow = () =>
      replay(trace(PIXEL).at(100, 'focusin', {}, TEXT).keyboard(1000, KB).at(3000, 'focusout').end(4000), {
        storage,
      })
    const first = slow()
    expect(at(first, 700).phase).toBe('closed') // gave up after 500 ms
    expect(at(first, 1100)).toMatchObject({ phase: 'open', height: KB })
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
    expect(JSON.parse(storage.get('keyboard-dock')!).wait).toBeGreaterThan(500)
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

  it('Android back button hides the keyboard with focus kept: closes after settle, tap reopens', () => {
    const r = replay(
      opened()
        .keyboard(2000, 0) // back button
        .at(4000, 'click', {}, TEXT)
        .keyboard(4300, KB)
        .end(5000),
      { storage: storage() },
    )
    expect(at(r, 2000 + 100)).toMatchObject({ phase: 'open' }) // waiting out a possible dip
    expect(at(r, 2000 + 400)).toMatchObject({ phase: 'closed', height: 0 })
    expect(at(r, 4020)).toMatchObject({ phase: 'opening', height: KB }) // predicted on tap
    expect(r.final).toMatchObject({ phase: 'open', height: KB })
  })

  it('tapping outside closes within a frame of the blur grace', () => {
    const r = replay(opened().at(2000, 'focusout').keyboard(2300, 0).end(3000))
    expect(at(r, 2000 + 120)).toMatchObject({ phase: 'closed', height: 0 })
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
    expect(JSON.parse(storage.get('keyboard-dock')!)).toMatchObject({ textL412x915: 200 })
  })

  it('a page wider than the screen does not count as landscape', () => {
    // Found on the demo page: a header overflowing by 9px widened innerWidth from 412 to 421 on
    // Chrome Android, and the portrait keyboard got saved under landscape.
    const storage = new Map<string, string>()
    replay(trace(PIXEL).at(100, 'focusin', { iw: 421 }, TEXT).keyboard(400, KB).end(1500), { storage })
    expect(JSON.parse(storage.get('keyboard-dock')!)).toEqual({ textP412x915: KB })
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
