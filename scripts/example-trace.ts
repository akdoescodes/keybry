// Writes traces/example.synthetic.json from a synthetic scenario, to show the trace format.
// Run: node --experimental-strip-types scripts/example-trace.ts
import { writeFileSync } from 'node:fs'
import { TEXT, trace, IPHONE } from '../test/scenarios.ts'

const t = trace(IPHONE)
  .at(100, 'focusin', {}, TEXT)
  .slide(100, 0, 336, 300, 'frame')
  .keyboard(420, 336)
  .at(2000, 'focusout')
  .slide(2000, 336, 0, 250, 'frame')
  .keyboard(2260, 0)
  .end(3000)
writeFileSync(new URL('../traces/example.synthetic.json', import.meta.url), JSON.stringify(t) + '\n')
