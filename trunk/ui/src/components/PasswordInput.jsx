// =============================================================================
// PasswordInput.jsx — text field with a show/hide (eye) toggle beside the box.
// Drop-in for <input type="password" …>: pass the same style/className/props and
// the reveal button sits OUTSIDE the field so it doesn't eat input width. Used
// everywhere a password or secret is entered so every one of them can be shown.
//   wrapStyle — style for the flex wrapper (e.g. { flex: 1 } when the field is a
//               flex child in a row); eyeStyle — override the toggle button.
// =============================================================================
import { useState } from 'react'

const eyeBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '0 6px',
  color: 'var(--text-tertiary,#888)', fontSize: 15, lineHeight: 1, flexShrink: 0,
}

export default function PasswordInput({ style, eyeStyle, wrapStyle, ...props }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, ...wrapStyle }}>
      <input {...props} type={show ? 'text' : 'password'}
        style={{ ...style, flex: 1, minWidth: 0 }} />
      <button type="button" tabIndex={-1} onClick={() => setShow(s => !s)}
        title={show ? 'Hide' : 'Show'} style={{ ...eyeBtn, ...eyeStyle }}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
}
