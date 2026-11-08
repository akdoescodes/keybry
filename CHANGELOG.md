# Changelog

## Unreleased

- Chrome on Android: the bar sits on the keyboard when the page doesn't end at the top of the navigation bar. Drawn under the gesture bar (`viewport-fit=cover`), it was hidden 24px behind the keyboard; above Chrome's bottom toolbar, it floated 56px above it. Chrome measures the keyboard from the top of the navigation bar, and keybry now corrects for where the page really ends, from the last tap's position on the screen.
- Size: about 1.8 kB (was 1.7 kB).

## 0.1.0

First release.

- `dock(el)`, `keyboard()` and `createKeyboard()`: predict, measure, correct and learn the keyboard height.
- `--keyboard-height` CSS variable on `<html>`.
- `keybry/react`: `useKeyboard(select?)` and `<Dock>`.
- `keybry/recorder`: `record()` for device traces.
