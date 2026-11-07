# Traces

Each `.json` file here is a recording of what one browser on one device reported while a keyboard opened and closed. `test/replay.test.ts` plays every one of them through the real engine on every change, and checks two rules:

1. A docked bar is never hidden behind the keyboard for more than 3 frames (50 ms).
2. When things go quiet, the bar sits exactly on the keyboard, or is down if nothing is focused.

`example.synthetic.json` is hand-built (see `scripts/example-trace.ts`), to show the format. Every other file should be a real recording.

## Adding a trace

1. Download the trace file from the issue.
2. Save it as `traces/<platform>/<device>-<browser>.json`, for example `traces/ios/iphone-15-safari-18.1.json`.
3. Run `npm test`.
   - If it passes, commit it. That phone is now covered forever.
   - If it fails, the trace has found a real problem. Fix the engine until it passes, without breaking the other traces.

## Format

```jsonc
{
  "v": 1,
  "meta": { "ua": "…", "screen": [390, 844], "dpr": 3, "touch": 5, "coarse": true, "vk": false, "date": "…", "answers": [] },
  "events": [
    // [ms since start, type, sample, target or note]
    [0, "init", { "iw": 390, "ih": 664, "w": 390, "h": 664, "top": 0, "scale": 1 }],
    [812.4, "focusin", { … }, { "tag": "INPUT", "type": "text" }],
    [828.9, "frame", { … }],
    [1190.2, "vv.resize", { … }]
  ],
  "states": [[0, { "open": false, "height": 0, "phase": "closed", "source": "measured" }]]
}
```

- **Sample:** `iw`/`ih` are `innerWidth`/`innerHeight`. `w`/`h`/`top`/`scale` are the visual viewport. `kb`/`ov` are the VirtualKeyboard rect height and `overlaysContent`, where the API exists.
- **Event types:** `init`, `focusin`, `focusout`, `click`, `vv.resize`, `vv.scroll`, `resize`, `geometrychange`, `mark` (a guided-test step or answer), and `frame`.
- **`frame`** is not a browser event. After anything happens, the recorder checks every animation frame for a second and logs changes the browser didn't announce. This is how a trace shows what the keyboard did between events, for example whether iOS reports every frame or only at the end.
- **`states`** is what keybry itself decided during the recording, useful for comparing against the replay.

Traces hold no typed text: only sizes, timings, the element type that had focus, and the user agent.
