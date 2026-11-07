// No window here, like a Next.js or Remix server render.
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { dock, keyboard } from '../src/index'
import { KeyboardDock, useKeyboard } from '../src/react'

it('core is inert on the server', () => {
  expect(typeof window).toBe('undefined')
  expect(keyboard().state).toMatchObject({ open: false, height: 0 })
  expect(() => dock({} as HTMLElement)()).not.toThrow()
})

it('React renders on the server', () => {
  function Status() {
    const open = useKeyboard((s) => s.open)
    return <b>{open ? 'open' : 'closed'}</b>
  }
  const html = renderToString(
    <KeyboardDock className="bar">
      <Status />
    </KeyboardDock>,
  )
  expect(html).toBe('<div class="bar"><b>closed</b></div>')
})
