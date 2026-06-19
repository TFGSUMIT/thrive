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
// Typing goes into the focused field via the native value setter + an 'input'
// event, so React's onChange fires without touching any existing form.
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

const keyStyle = (flex = 1, accent = false) => ({
  flex, minWidth: 0, height: 46, margin: 3, borderRadius: 7,
  background: accent ? 'var(--bg-secondary,#181818)' : 'var(--bg-tertiary,#2a2a2a)',
  border: '1px solid var(--border-color,#333)', color: 'var(--text-primary,#e8e6e0)',
  fontFamily: 'var(--font-mono,monospace)', fontSize: 16, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none',
})

export default function OnScreenKeyboard() {
  const [enabled, setEnabled] = useState(oskEnabled)
  const [target, setTarget]   = useState(null)
  const [shift, setShift]     = useState(false)
  const [sym, setSym]         = useState(false)
  const targetRef = useRef(null)

  useEffect(() => {
    const onSetting = () => setEnabled(oskEnabled())
    window.addEventListener('thrive:osk-changed', onSetting)
    return () => window.removeEventListener('thrive:osk-changed', onSetting)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onIn = (e) => {
      if (isTypable(e.target)) {
        targetRef.current = e.target; setTarget(e.target)
        setTimeout(() => e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 50)
      }
    }
    const onOut = (e) => { if (e.target === targetRef.current) { targetRef.current = null; setTarget(null) } }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    if (isTypable(document.activeElement)) { targetRef.current = document.activeElement; setTarget(document.activeElement) }
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut) }
  }, [enabled])

  if (!enabled || !target) return null

  // keys keep the field focused by preventing the default focus-steal on press
  const press = (fn) => (e) => { e.preventDefault(); const el = targetRef.current; if (el) fn(el) }
  const key = (label, fn, opts = {}) => (
    <button key={label + (opts.k || '')} style={keyStyle(opts.flex, opts.accent)} onPointerDown={press(fn)}>{label}</button>
  )
  const letter = (ch) => key(shift ? ch.toUpperCase() : ch, (el) => {
    insertText(el, shift ? ch.toUpperCase() : ch); if (shift) setShift(false)
  }, { k: ch })

  const rows = sym ? ROWS_SYM : ROWS_LOWER

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000,
      background: 'var(--bg-primary,#0f0f0f)', borderTop: '1px solid var(--border-color,#2a2a2a)',
      padding: '8px 6px calc(8px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -8px 24px rgba(0,0,0,.4)' }}
      onPointerDown={(e) => e.preventDefault()}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'center', padding: i === 1 ? '0 16px' : 0 }}>
            {i === 2 && !sym && key('⇧', () => setShift(s => !s) || true, { flex: 1.4, accent: true, k: 'shift' })}
            {row.map(ch => (sym ? key(ch, (el) => insertText(el, ch), { k: ch }) : letter(ch)))}
            {i === 2 && key('⌫', backspace, { flex: 1.4, accent: true, k: 'bsp' })}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {key(sym ? 'abc' : '?123', () => setSym(s => !s) || true, { flex: 1.6, accent: true, k: 'sym' })}
          {key('space', (el) => insertText(el, ' '), { flex: 5, k: 'space' })}
          {key('⏎', pressEnter, { flex: 1.6, accent: true, k: 'enter' })}
          {key('▾', () => { targetRef.current?.blur(); setTarget(null) }, { flex: 1.2, accent: true, k: 'hide' })}
        </div>
      </div>
    </div>
  )
}
