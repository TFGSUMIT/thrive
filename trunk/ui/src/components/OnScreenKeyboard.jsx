// =============================================================================
// OnScreenKeyboard — thrive's own touch keyboard (for kiosk/sapling walls with
// no physical keyboard). Rendered globally (above the Gate) so it covers every
// screen: onboarding, login, the profile-picker, and all module forms.
//
// Why in-app rather than a system OSK: the kiosk only ever displays thrive, and
// a system Wayland keyboard depends on chromium's flaky text-input protocol to
// know when to show. This component watches focus directly, so it's deterministic.
//
// Enable: localStorage `thrive:osk` = 'on' | 'off'; unset → auto (touch screens).
// Sized for a wall: keys scale with viewport height and span the full width; when
// open it adds bottom padding to the page and scrolls the focused field up so the
// keyboard never covers it. Typing goes in via the native value setter + an 'input'
// event so React's onChange fires without touching any existing form.
// =============================================================================
import { useState, useEffect, useRef } from 'react'

const TYPABLE = new Set(['text', 'password', 'email', 'search', 'url', 'tel', 'number', ''])
const isTypable = (el) =>
  !!el && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' &&
      TYPABLE.has((el.getAttribute('type') || 'text').toLowerCase()) &&
      !el.readOnly && !el.disabled))

export function oskEnabled() {
  const s = localStorage.getItem('thrive:osk')
  if (s === 'on') return true
  if (s === 'off') return false
  return (navigator.maxTouchPoints || 0) > 0      // auto: enable on touch screens
}

const ROWS_LOWER = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
]
const ROWS_SYM = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['@','#','$','&','-','_','+','(',')','/'],
  ['*','"',"'",':',';','!','?','.',','],
]

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function caret(el) {
  let s = el.selectionStart, e = el.selectionEnd
  if (s == null || e == null) { s = e = el.value.length }   // number/email expose no selection
  return [s, e]
}
function insertText(el, ch) {
  const [s, e] = caret(el)
  setNativeValue(el, el.value.slice(0, s) + ch + el.value.slice(e))
  try { el.setSelectionRange(s + ch.length, s + ch.length) } catch {}
}
function backspace(el) {
  let [s, e] = caret(el)
  if (s === e && s > 0) s -= 1
  setNativeValue(el, el.value.slice(0, s) + el.value.slice(e))
  try { el.setSelectionRange(s, s) } catch {}
}
function pressEnter(el) {
  for (const type of ['keydown', 'keyup'])
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
}
// caret navigation — synthetic arrow key events don't move the caret, so set the
// selection directly. number/email inputs expose no selection API (caret() falls
// back to end), so setSelectionRange is wrapped in try/catch.
function setCaretPos(el, pos) { try { el.setSelectionRange(pos, pos) } catch {} ; el.focus() }
function charMove(el, dir) {
  const [s, e] = caret(el)
  const pos = dir < 0 ? (s === e ? Math.max(0, s - 1) : s)
                      : (s === e ? Math.min(el.value.length, e + 1) : e)
  setCaretPos(el, pos)
}
// vertical move: line up/down keeping the column (textarea); collapses to
// home/end on single-line inputs (no newlines)
function lineMove(el, dir) {
  const v = el.value, [s] = caret(el)
  const lineStart = v.lastIndexOf('\n', s - 1) + 1
  const col = s - lineStart
  if (dir < 0) {
    if (lineStart === 0) return setCaretPos(el, 0)
    const prevStart = v.lastIndexOf('\n', lineStart - 2) + 1
    setCaretPos(el, prevStart + Math.min(col, lineStart - 1 - prevStart))
  } else {
    const lineEnd = v.indexOf('\n', s)
    if (lineEnd === -1) return setCaretPos(el, v.length)
    const nextStart = lineEnd + 1
    const ne = v.indexOf('\n', nextStart)
    setCaretPos(el, nextStart + Math.min(col, (ne === -1 ? v.length : ne) - nextStart))
  }
}

// big, touch-friendly keys that grow with the screen height
const keyStyle = (flex = 1, accent = false) => ({
  flex, minWidth: 0, height: 'clamp(54px, 8.6vh, 92px)', margin: 4, borderRadius: 9,
  background: accent ? 'var(--bg-secondary,#181818)' : 'var(--bg-tertiary,#2a2a2a)',
  border: '1px solid var(--border-color,#333)', color: 'var(--text-primary,#e8e6e0)',
  fontFamily: 'var(--font-mono,monospace)', fontSize: 'clamp(18px, 3.3vh, 30px)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none',
  touchAction: 'manipulation',
  transition: 'background .07s, color .07s, transform .07s, box-shadow .07s',
})
// a tapped key lights up: inverts to a bright key + a soft glow, briefly
const PRESSED = {
  background: 'var(--text-primary,#e8e6e0)', color: 'var(--bg-primary,#0f0f0f)',
  borderColor: 'var(--text-primary,#e8e6e0)', transform: 'scale(0.95)',
  boxShadow: '0 0 14px rgba(232,230,224,.45)',
}

export default function OnScreenKeyboard() {
  const [enabled, setEnabled] = useState(oskEnabled)
  const [target, setTarget]   = useState(null)
  const [shift, setShift]     = useState(false)
  const [page, setPage]       = useState('abc')  // 'abc' (letters) | 'sym' (?123) | 'nav' (numbers + arrows)
  const [pressed, setPressed] = useState(null)   // key currently lit on tap
  const targetRef = useRef(null)
  const panelRef  = useRef(null)
  const hideTimer = useRef(null)

  useEffect(() => {
    const onSetting = () => setEnabled(oskEnabled())
    window.addEventListener('thrive:osk-changed', onSetting)
    return () => window.removeEventListener('thrive:osk-changed', onSetting)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onIn  = (e) => { if (isTypable(e.target)) { clearTimeout(hideTimer.current); targetRef.current = e.target; setTarget(e.target) } }
    // delay the hide so a tap on a Back/submit button completes (and fires its
    // click) BEFORE the keyboard drops and the layout shifts — otherwise the first
    // tap only dismisses the keyboard. A refocus within the window cancels it.
    const onOut = (e) => {
      if (e.target === targetRef.current) {
        clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => { targetRef.current = null; setTarget(null) }, 220)
      }
    }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    if (isTypable(document.activeElement)) { targetRef.current = document.activeElement; setTarget(document.activeElement) }
    return () => { clearTimeout(hideTimer.current); document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut) }
  }, [enabled])

  // make room for the (tall) keyboard: publish its height as --osk-height (centered
  // screens like login/onboarding subtract it so they recenter ABOVE the keyboard),
  // pad the body for scrollable pages, and lift a still-covered field into view.
  useEffect(() => {
    const root = document.documentElement
    if (!target) { document.body.style.paddingBottom = ''; root.style.setProperty('--osk-height', '0px'); return }
    const h = panelRef.current ? panelRef.current.offsetHeight : Math.round(window.innerHeight * 0.42)
    document.body.style.paddingBottom = h + 'px'
    root.style.setProperty('--osk-height', h + 'px')
    const id = requestAnimationFrame(() => {
      const el = targetRef.current; if (!el) return
      const r = el.getBoundingClientRect()
      const kbTop = window.innerHeight - h
      if (r.bottom > kbTop - 16 || r.top < 56) window.scrollBy({ top: r.top - 110, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [target])

  useEffect(() => () => {
    document.body.style.paddingBottom = ''
    document.documentElement.style.setProperty('--osk-height', '0px')
  }, [])

  if (!enabled) return null
  const visible = !!target           // hidden = still mounted, slid off-screen (animates)

  // keys keep the field focused by preventing the default focus-steal on press, and
  // light up for ~130ms so a tap is visibly registered on a touch screen
  const flash = (id) => { setPressed(id); setTimeout(() => setPressed(p => (p === id ? null : p)), 130) }
  const key = (label, fn, opts = {}) => {
    const id = label + (opts.k || '')
    return (
      <button key={id}
        style={{ ...keyStyle(opts.flex, opts.accent), ...(opts.style || {}), ...(pressed === id ? PRESSED : null) }}
        onPointerDown={(e) => { e.preventDefault(); flash(id); const el = targetRef.current; if (el) fn(el) }}>
        {label}
      </button>
    )
  }
  const letter = (ch) => key(shift ? ch.toUpperCase() : ch, (el) => {
    insertText(el, shift ? ch.toUpperCase() : ch); if (shift) setShift(false)
  }, { k: ch })

  // Tab → advance focus to the next typable field on the page (wraps around);
  // synthetic key events don't move focus, so do it directly. The OSK stays open
  // because the new field is itself typable (focusin re-targets it).
  const focusNextTypable = (el) => {
    const all = [...document.querySelectorAll('input, textarea')]
      .filter(n => isTypable(n) && n.offsetParent !== null && !panelRef.current?.contains(n))
    if (!all.length) return
    const idx = all.indexOf(el)
    const next = all[(idx + 1) % all.length] || all[0]
    next.focus(); try { next.select() } catch {}
  }

  const rows = page === 'sym' ? ROWS_SYM : ROWS_LOWER
  // page cycle: letters → symbols → numbers+arrows → letters
  const NEXT_PAGE  = { abc: 'sym', sym: 'nav', nav: 'abc' }
  const PAGE_LABEL = { abc: '#+=', sym: '123', nav: 'abc' }

  return (
    <div ref={panelRef} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000,
      background: 'var(--bg-primary,#0f0f0f)', borderTop: '1px solid var(--border-color,#2a2a2a)',
      padding: '10px 10px calc(10px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -10px 30px rgba(0,0,0,.5)',
      transform: visible ? 'translateY(0)' : 'translateY(110%)',
      transition: 'transform 0.24s cubic-bezier(.2,.8,.2,1)',
      pointerEvents: visible ? 'auto' : 'none', willChange: 'transform' }}
      onPointerDown={(e) => e.preventDefault()}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {page === 'nav' ? (
          <div style={{ display: 'flex', gap: 'clamp(20px, 5vw, 72px)', justifyContent: 'center', alignItems: 'center', padding: '4px 0' }}>
            {/* numbers stacked like a keypad — 9 down to 1, then a wide pill zero */}
            <div style={{ flex: '0 1 340px', maxWidth: 340 }}>
              {[['7', '8', '9'], ['4', '5', '6'], ['1', '2', '3']].map((r, ri) => (
                <div key={ri} style={{ display: 'flex' }}>
                  {r.map(d => key(d, (el) => insertText(el, d), { k: d }))}
                </div>
              ))}
              <div style={{ display: 'flex' }}>
                {key('0', (el) => insertText(el, '0'), { k: 'zero', style: { borderRadius: 999, letterSpacing: '0.2em' } })}
              </div>
            </div>
            {/* a directional cross — arrows sit where they point (↑ top, ←·→ sides,
                ↓ bottom), backspace dead-centre, Home/End tucked in the corners */}
            <div style={{ flex: '0 1 320px', maxWidth: 320 }}>
              <div style={{ display: 'flex' }}>
                {key('Hm', (el) => setCaretPos(el, 0), { accent: true, k: 'home', style: { fontSize: 'clamp(14px,2.4vh,22px)' } })}
                {key('↑', (el) => lineMove(el, -1), { accent: true, k: 'aU' })}
                {key('End', (el) => setCaretPos(el, el.value.length), { accent: true, k: 'end', style: { fontSize: 'clamp(13px,2.2vh,20px)' } })}
              </div>
              <div style={{ display: 'flex' }}>
                {key('←', (el) => charMove(el, -1), { accent: true, k: 'aL' })}
                {key('⌫', backspace, { k: 'bsp2' })}
                {key('→', (el) => charMove(el, 1), { accent: true, k: 'aR' })}
              </div>
              <div style={{ display: 'flex' }}>
                <div style={{ flex: 1, margin: 4 }} />
                {key('↓', (el) => lineMove(el, 1), { accent: true, k: 'aD' })}
                <div style={{ flex: 1, margin: 4 }} />
              </div>
            </div>
          </div>
        ) : (
          rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'center', padding: i === 1 ? '0 5%' : 0 }}>
              {i === 2 && page === 'abc' && key('⇧', () => setShift(s => !s), { flex: 1.5, accent: true, k: 'shift' })}
              {row.map(ch => (page === 'sym' ? key(ch, (el) => insertText(el, ch), { k: ch }) : letter(ch)))}
              {i === 2 && key('⌫', backspace, { flex: 1.5, accent: true, k: 'bsp' })}
            </div>
          ))
        )}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {key(PAGE_LABEL[page], () => setPage(NEXT_PAGE[page]), { flex: 1.8, accent: true, k: 'page' })}
          {key('⇥', (el) => focusNextTypable(el), { flex: 1.3, accent: true, k: 'tab' })}
          {key('space', (el) => insertText(el, ' '), { flex: 4.5, k: 'space' })}
          {key('⏎', pressEnter, { flex: 1.8, accent: true, k: 'enter' })}
          {key('▾', () => { targetRef.current?.blur(); setTarget(null) }, { flex: 1.3, accent: true, k: 'hide' })}
        </div>
      </div>
    </div>
  )
}
