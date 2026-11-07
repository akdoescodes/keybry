import { dock, keyboard } from './lib/index.js'
import { record } from './lib/recorder.js'

const REPO = 'akdoescodes/keybry'
const $ = (id) => document.getElementById(id)
const root = document.documentElement
const composer = $('composer')
const input = $('message')
const feed = $('feed')
const status = $('status')

// The whole integration: one line.
dock(composer)

// Everything below is the demo and the guided test.
const kb = keyboard()
const recorder = record({ keyboard: kb })

// Keep the last message visible above the composer (the CSS adds --keyboard-height on top).
new ResizeObserver(() => root.style.setProperty('--composer-height', composer.offsetHeight + 'px')).observe(composer)

const toBottom = () => window.scrollTo({ top: document.body.scrollHeight })

let wasOpen = false
kb.subscribe((s) => {
  status.textContent = s.phase == 'closed' ? 'closed · 0px' : `${s.phase} · ${s.height}px · ${s.source}`
  status.dataset.phase = s.phase
  root.dataset.keyboard = s.open ? 'open' : 'closed'
  if (s.open && !wasOpen) requestAnimationFrame(toBottom)
  wasOpen = s.open
  onState(s)
  redraw()
})

// Keyboard kinds: each one is a different keyboard, so a different saved height.
const KINDS = {
  text: { type: 'text', mode: '', placeholder: 'Message' },
  number: { type: 'text', mode: 'numeric', placeholder: 'A number' },
  email: { type: 'email', mode: '', placeholder: 'An email address' },
  tel: { type: 'tel', mode: '', placeholder: 'A phone number' },
}
let kind = 'text'
const kindButtons = document.querySelectorAll('[data-kind]')
const setKind = (k) => {
  kind = k
  kindButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind == k)))
  input.type = KINDS[k].type
  input.inputMode = KINDS[k].mode
  input.placeholder = KINDS[k].placeholder
  // Swap the keyboard that's showing. This closes and reopens it: a good bounce test.
  if (document.activeElement == input) {
    input.blur()
    input.focus()
  }
}
for (const b of kindButtons) {
  // Tapping a chip must not take focus from the field, or the keyboard would close.
  b.addEventListener('pointerdown', (e) => e.preventDefault())
  b.addEventListener('click', () => setKind(b.dataset.kind))
}

// Sending keeps the keyboard open, like a real chat app.
$('send').addEventListener('pointerdown', (e) => e.preventDefault())
composer.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  const bubble = document.createElement('p')
  bubble.className = 'bubble me'
  bubble.textContent = text
  feed.append(bubble)
  input.value = ''
  requestAnimationFrame(toBottom)
})

$('here').href = location.href

// ---------------------------------------------------------------- guided test

const STEPS = [
  {
    id: 'open',
    text: 'Tap the message box.',
    until: (s) => s.phase == 'open',
    ask: 'Did the bar ride up on top of the keyboard, without being covered?',
  },
  {
    id: 'close',
    text: 'Close the keyboard: tap the messages above it, or tap Done.',
    until: (s) => !s.open,
    ask: 'Did the bar come down with the keyboard, without bouncing?',
  },
  {
    id: 'again',
    text: 'Tap the message box again.',
    until: (s) => s.phase == 'open',
    ask: 'Did it go straight to the right place this time?',
  },
  {
    id: 'scroll',
    text: 'Keep the keyboard open and scroll the messages up and down.',
    ask: 'Did the bar stay on top of the keyboard while you scrolled?',
  },
  {
    id: 'number',
    text: 'Pick “Number” above the message box.',
    until: (s) => s.phase == 'open' && kind == 'number',
    ask: 'Did the bar sit right on top of the number pad?',
  },
  {
    id: 'sideways',
    text: 'Optional: turn your phone sideways, then tap the message box.',
    until: (s) => s.phase == 'open' && innerWidth > innerHeight,
    ask: 'Did the bar sit on top of the keyboard sideways too?',
  },
]

const guide = $('guide')
const ask = $('ask')
const answers = []
let step = -1
let askTimer = 0

const showStep = (i) => {
  step = i
  clearTimeout(askTimer)
  const s = STEPS[i]
  recorder.mark(`step:${s.id}`)
  $('step-count').textContent = `Step ${i + 1} of ${STEPS.length}`
  $('step-text').textContent = s.text
  $('ask-text').textContent = s.ask
  ask.hidden = !!s.until
  $('done').hidden = true
  guide.hidden = false
}

// Ask once the keyboard has settled, so the trace includes the whole movement.
function onState(s) {
  const current = STEPS[step]
  if (current && current.until && ask.hidden && current.until(s)) {
    clearTimeout(askTimer)
    askTimer = setTimeout(() => (ask.hidden = false), 700)
  }
}

for (const b of document.querySelectorAll('[data-answer]')) {
  b.addEventListener('pointerdown', (e) => e.preventDefault()) // answering must not move the keyboard
  b.addEventListener('click', () => {
    const s = STEPS[step]
    recorder.mark(`answer:${s.id}:${b.dataset.answer}`)
    answers.push([s.ask, b.dataset.answer])
    step + 1 < STEPS.length ? showStep(step + 1) : finish()
  })
}

$('test').addEventListener('click', () => {
  answers.length = 0
  showDetails(false)
  showStep(0)
})
$('guide-close').addEventListener('click', () => {
  clearTimeout(askTimer)
  guide.hidden = true
  step = -1
})

// ---------------------------------------------------------------- sending the trace

const ua = navigator.userAgent
let model = ''
navigator.userAgentData
  ?.getHighEntropyValues(['model', 'platformVersion'])
  .then((v) => (model = v.model || ''))
  .catch(() => {})

const device = () => {
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))
  const name = ios
    ? /iPhone|iPod/.test(ua)
      ? 'iPhone'
      : 'iPad'
    : model || (ua.match(/Android [\d.]+; ([^;)]+)/) || [])[1] || ''
  const os = ios
    ? `iOS ${(ua.match(/OS (\d+)_(\d+)/) || []).slice(1).join('.')}`.trim()
    : (ua.match(/Android [\d.]+/) || [''])[0] || 'Desktop'
  const browser = /SamsungBrowser/.test(ua)
    ? 'Samsung Internet'
    : /EdgA|EdgiOS|Edg\//.test(ua)
      ? 'Edge'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : navigator.brave
          ? 'Brave'
          : /CriOS|Chrome/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'Other browser'
  return [name, os, browser].filter((x) => x && x != 'K').join(' · ')
}

const traceFile = () => {
  const label = device()
  const trace = { ...recorder.trace, meta: { ...recorder.trace.meta, device: label, answers } }
  const name = `trace-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.json`
  return new File([JSON.stringify(trace)], name, { type: 'application/json' })
}

function finish() {
  recorder.mark('done')
  ask.hidden = true
  $('step-count').textContent = 'Done'
  $('step-text').textContent = 'All steps done.'
  $('done').hidden = false
  const label = device()
  const params = new URLSearchParams({
    template: 'trace.yml',
    title: `Trace: ${label}`,
    device: `${label}\n${ua}\nScreen ${screen.width}×${screen.height} @${devicePixelRatio}x`,
    answers: answers.map(([q, a]) => `- ${q} **${a}**`).join('\n'),
  })
  $('issue').href = `https://github.com/${REPO}/issues/new?${params}`
  const file = traceFile()
  $('share').hidden = !navigator.canShare?.({ files: [file] })
}

$('download').addEventListener('click', () => {
  const file = traceFile()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
})

$('share').addEventListener('click', () => {
  const file = traceFile()
  navigator.share({ files: [file], title: file.name }).catch(() => {})
})

// ---------------------------------------------------------------- details: what this browser reports

const details = $('details')
const STORE = 'keybry' // where the library saves heights

const savedHeights = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {}
  } catch {
    return {}
  }
}

const describeKey = (key) => {
  const m = key.match(/^(text|number|tel|email)([PL])\d+x\d+$/)
  return m ? `${m[1]} keyboard, ${m[2] == 'P' ? 'upright' : 'sideways'}` : key
}

const facts = () => {
  const vk = navigator.virtualKeyboard
  const vv = visualViewport
  const s = kb.state
  const saved = savedHeights()
  const heights = Object.entries(saved)
    .filter(([k]) => k != 'wait')
    .map(([k, v]) => `${describeKey(k)}: ${v ? `${v}px` : 'nothing moves'}`)
  const method =
    vk && vk.overlaysContent
      ? 'Exact: the browser reports the keyboard (VirtualKeyboard API)'
      : matchMedia('(pointer:coarse)').matches
        ? 'Measured from the visible area (visualViewport)'
        : 'None: no touch screen, so nothing moves'
  return [
    ['Browser', device()],
    ['Method', method],
    ['HTTPS', isSecureContext ? 'Yes' : 'No (Chrome only gives exact numbers over HTTPS)'],
    ['Keyboard', s.phase == 'closed' ? 'closed' : `${s.phase} · ${s.height}px · ${s.source}`],
    [
      'Viewport',
      `page ${innerWidth}×${innerHeight}, visible ${Math.round(vv.width)}×${Math.round(vv.height)}` +
        (vv.offsetTop ? `, panned ${Math.round(vv.offsetTop)}px` : ''),
    ],
    ['Saved', heights.length ? heights.join('; ') : 'nothing yet: tap the message box'],
    ...(saved.wait ? [['Slow keyboard', `waits up to ${saved.wait} ms for it`]] : []),
  ]
}

let drawFrame = 0
function redraw() {
  if (details.hidden || drawFrame) return
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0
    $('facts').replaceChildren(
      ...facts().flatMap(([k, v]) => {
        const dt = document.createElement('dt')
        const dd = document.createElement('dd')
        dt.textContent = k
        dd.textContent = v
        return [dt, dd]
      }),
    )
  })
}

function showDetails(show) {
  details.hidden = !show
  status.setAttribute('aria-expanded', String(show))
  if (show) {
    guide.hidden = true
    step = -1
    redraw()
  }
}

visualViewport.addEventListener('resize', redraw)
visualViewport.addEventListener('scroll', redraw)
addEventListener('resize', redraw)

for (const b of [status, $('details-close'), $('reset')]) {
  b.addEventListener('pointerdown', (e) => e.preventDefault()) // checking details must not close the keyboard
}
status.addEventListener('click', () => showDetails(details.hidden))
$('details-close').addEventListener('click', () => showDetails(false))
$('reset').addEventListener('click', () => {
  try {
    localStorage.removeItem(STORE)
  } catch {}
  location.reload()
})
