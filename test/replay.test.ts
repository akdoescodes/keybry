/**
 * Every trace in /traces is a regression test. Drop a recorded trace in, and these rules must
 * hold for it forever:
 * 1. A docked bar is never hidden behind the keyboard for more than a few frames.
 * 2. When things go quiet, the bar sits exactly on the keyboard (or is down, if nothing is focused).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Trace } from '../src/recorder'
import { longestCovered, replay } from './env'

// TRACES=some/folder replays a different folder, e.g. fresh recordings before adding them here.
const dir = process.env.TRACES ? resolve(process.env.TRACES) : join(import.meta.dirname, '..', 'traces')
const files = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : [],
  )

const traces = files(dir)
  .map((f) => [f.slice(dir.length + 1), JSON.parse(readFileSync(f, 'utf8')) as Trace] as const)
  .filter(([, t]) => t.v === 1 && Array.isArray(t.events)) // other JSON (reports) is not a trace

describe.each(traces)('trace %s', (_, trace) => {
  const r = replay(trace)
  const [, last, focused] = r.truths[r.truths.length - 1]

  it('never hides the bar behind the keyboard for more than 3 frames', () => {
    expect(longestCovered(r)).toBeLessThanOrEqual(50)
  })

  it('ends on the keyboard, or closed', () => {
    if (focused) expect(Math.abs(r.final.height - last)).toBeLessThanOrEqual(1)
    else expect(r.final.phase).toBe('closed')
  })
})

it('has traces to replay', () => expect(traces.length).toBeGreaterThan(0))
