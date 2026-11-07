import {
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ElementType,
  type HTMLAttributes,
} from 'react'
import { keyboard, type KeyboardState } from './index.js'

export type { KeyboardState, Phase, Source } from './index.js'

// useLayoutEffect warns during server rendering in React 18; it only matters in the browser.
const useIsoLayoutEffect = typeof window != 'undefined' ? useLayoutEffect : useEffect

/**
 * Reads the keyboard state. Pass a selector to re-render only when that value changes:
 *
 *     const open = useKeyboard((s) => s.open)
 *
 * The selector must return a primitive or a stable value. For moving things, use
 * `<Dock>` or the `--keyboard-height` CSS variable instead; they never re-render.
 */
export function useKeyboard(): KeyboardState
export function useKeyboard<T>(select: (state: KeyboardState) => T): T
export function useKeyboard<T>(select?: (state: KeyboardState) => T): T | KeyboardState {
  const kb = keyboard()
  const read = () => (select ? select(kb.state) : kb.state)
  return useSyncExternalStore(kb.subscribe, read, read)
}

export type DockProps = HTMLAttributes<HTMLElement> & {
  /** The element to render. @default 'div' */
  as?: ElementType
}

/**
 * Keeps its contents above the on-screen keyboard. Moves with a GPU transform and never re-renders.
 * Position it at the bottom yourself, e.g. `style={{ position: 'fixed', bottom: 0, left: 0, right: 0 }}`.
 */
export function Dock({ as = 'div', ...props }: DockProps) {
  const ref = useRef<HTMLElement>(null)
  useIsoLayoutEffect(() => keyboard().dock(ref.current!), [])
  return createElement(as, { ...props, ref })
}
