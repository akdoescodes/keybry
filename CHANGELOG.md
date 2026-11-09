# Changelog

## Unreleased

- Android: while something is docked, keybry adds `interactive-widget=resizes-content` to the viewport tag (as ChatGPT and claude.ai do) instead of turning on Chrome's VirtualKeyboard API. Chrome and Firefox then move the bar themselves, from Android's real keyboard position:
  - it lands exactly on the keyboard with Chrome's bottom toolbar (was 56px above it) and on pages drawn under the gesture bar (was 24px behind it), because Chrome's API measures the keyboard from the top of the navigation bar;
  - it drops within a frame or two of a close (was up to 0.3 s late, then a 0.25 s slide);
  - in Firefox it stays put when scrolling hides the toolbar (it slid behind the keyboard).

  keybry still lifts the bar the moment a field is tapped, by the keyboard height it saved, and hands over to the browser in the same frame, so the bar doesn't move twice.
- Firefox's hidden toolbars: while the keyboard is up, Firefox hides the navigation bar of its expanded toolbar and a tab bar at the bottom, but keeps their room below the page. The bar now moves down into that empty strip: 48px (navigation bar, address bar at the bottom), 60px (navigation bar, address bar at the top), 56px (tab bar at the bottom), or 104px and 116px (both). A tab bar at the top hides nothing, and the bar stays put. keybry tells the 12 toolbar layouts apart from Firefox's own sizes, using the room Firefox keeps for its toolbars (`100lvh - 100svh`) and where the page starts on the screen, both read on the tap. A layout it can't pin down is left alone, and when two layouts fit it uses the smaller strip, so the bar never ends up behind Firefox's address bar. Known problem: Firefox doesn't always draw inside the strip, so the moved bar can disappear (see `docs/design.md`).
- Pages that set `interactive-widget` themselves, or turn the VirtualKeyboard API's `overlaysContent` on, are left alone.
- Size: about 2.1 kB (was 1.7 kB).

## 0.1.0

First release.

- `dock(el)`, `keyboard()` and `createKeyboard()`: predict, measure, correct and learn the keyboard height.
- `--keyboard-height` CSS variable on `<html>`.
- `keybry/react`: `useKeyboard(select?)` and `<Dock>`.
- `keybry/recorder`: `record()` for device traces.
