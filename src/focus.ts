/**
 * The keyboard a field asks for. It is part of the key heights are saved under,
 * because a number pad and a full keyboard are different heights.
 */
export type Kind = 'text' | 'number' | 'tel' | 'email'

/** Input types that bring up an on-screen keyboard. Everything else (checkbox, date, range...) does not. */
const TYPED = /^(text|search|email|url|tel|password|number)$/

/**
 * The earliest signal there is: a field has focus, so a keyboard is about to open.
 * Returns which keyboard it will be, or 0 when the element won't open one.
 */
export const kindOf = (el: any): Kind | 0 => {
  if (!el || el.readOnly || el.disabled) return 0
  const tag = el.tagName
  const type: string = tag == 'INPUT' ? el.type : tag == 'TEXTAREA' || el.isContentEditable ? 'text' : ''
  // inputmode wins over type: <input type="text" inputmode="numeric"> shows a number pad.
  const mode: string = el.inputMode || type
  return !TYPED.test(type) || mode == 'none'
    ? 0
    : /num|dec/.test(mode)
      ? 'number'
      : mode == 'tel'
        ? 'tel'
        : /email|url/.test(mode)
          ? 'email'
          : 'text'
}
