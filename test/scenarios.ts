/**
 * Synthetic traces: hand-built models of how each browser is known (or feared) to behave.
 * They are NOT real recordings. They exist so every behaviour has a test before real phone
 * traces arrive, and they go through exactly the same replay path as real traces in /traces.
 */
import type { EventType, Sample, Target, Trace } from '../src/recorder'

export const TEXT: Target = { tag: 'INPUT', type: 'text' }
export const OTHER: Target = { tag: 'TEXTAREA' }
export const NUMBER: Target = { tag: 'INPUT', type: 'text', mode: 'numeric' }
export const BUTTON: Target = { tag: 'BUTTON', type: 'submit' }

interface Device {
  ua: string
  screen: [number, number]
  /** Layout viewport with no keyboard */
  iw: number
  ih: number
  coarse?: boolean
  vk?: boolean
}

export const IPHONE: Device = { ua: 'iPhone Safari (synthetic)', screen: [390, 844], iw: 390, ih: 664, vk: false }
export const PIXEL: Device = { ua: 'Android Chrome (synthetic)', screen: [412, 915], iw: 412, ih: 839, vk: true }
export const IPAD: Device = { ua: 'iPad Safari (synthetic)', screen: [820, 1180], iw: 820, ih: 1106, vk: false }
export const DESKTOP: Device = { ua: 'Desktop (synthetic)', screen: [1920, 1080], iw: 1280, ih: 900, coarse: false, vk: false }

/** Builds a trace one event at a time. Each event changes only what it names; the rest carries over. */
export function trace(device: Device) {
  let s: Sample = { iw: device.iw, ih: device.ih, w: device.iw, h: device.ih, top: 0, scale: 1 }
  if (device.vk) Object.assign(s, { kb: 0, ov: false })
  const t: Trace = {
    v: 1,
    meta: {
      ua: device.ua,
      screen: device.screen,
      dpr: 3,
      touch: device.coarse === false ? 0 : 5,
      coarse: device.coarse !== false,
      vk: !!device.vk,
      date: '2026-11-06T00:00:00.000Z',
      synthetic: true,
    },
    events: [[0, 'init', { ...s }]],
  }
  const b = {
    trace: t,
    at(ms: number, type: EventType, change: Partial<Sample> = {}, extra?: Target | string) {
      s = { ...s, ...change }
      t.events.push(extra === undefined ? [ms, type, { ...s }] : [ms, type, { ...s }, extra])
      return b
    },
    /** The keyboard is open at `px` (visual viewport shorter by px), reported by one event at `ms`. */
    keyboard(ms: number, px: number, type: EventType = 'vv.resize') {
      return b.at(ms, type, { h: device.ih - px })
    },
    /** The keyboard slides over `duration` ms, firing `type` (or silent `frame`s) every 16ms. */
    slide(ms: number, from: number, to: number, duration: number, type: EventType = 'vv.resize') {
      for (let dt = 16; dt < duration; dt += 16) {
        const p = 1 - (1 - dt / duration) ** 3
        b.at(ms + dt, type, { h: Math.round(device.ih - (from + (to - from) * p)) })
      }
      return b.at(ms + duration, type, { h: device.ih - to })
    },
    /** Chrome's VirtualKeyboard API reporting a keyboard rect (only seen while overlaysContent is on). */
    exact(ms: number, px: number) {
      return b.at(ms, 'geometrychange', { kb: px, ov: true })
    },
    end(ms: number) {
      return b.at(ms, 'mark', {}, 'end').trace
    },
  }
  return b
}
