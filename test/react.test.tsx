// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { Dock, useKeyboard } from '../src/react'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

// happy-dom has no visualViewport, which every real browser has had since 2019 (without it keybry
// stays inactive, like on the server). A still one is enough here.
Object.defineProperty(window, 'visualViewport', {
  value: Object.assign(new EventTarget(), { width: 390, height: 664, offsetTop: 0, scale: 1 }),
})

const mount = (ui: React.ReactNode) => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(ui))
  return { host, unmount: () => act(() => root.unmount()) }
}

afterEach(() => document.body.replaceChildren())

it('<Dock> docks its element and undocks on unmount', () => {
  const { host, unmount } = mount(
    <Dock as="footer" className="bar">
      hi
    </Dock>,
  )
  const el = host.querySelector('footer')!
  expect(el.className).toBe('bar')
  expect(el.style.willChange).toBe('transform')
  expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('0px')
  unmount()
  expect(el.style.willChange).toBe('')
})

it('useKeyboard() reads the state, with or without a selector', () => {
  let full: unknown
  let open: unknown
  function Probe() {
    full = useKeyboard()
    open = useKeyboard((s) => s.open)
    return null
  }
  mount(<Probe />)
  expect(full).toMatchObject({ open: false, height: 0, phase: 'closed' })
  expect(open).toBe(false)
})
