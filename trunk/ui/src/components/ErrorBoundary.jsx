// =============================================================================
// ErrorBoundary — contains a render crash to its subtree so one bad component
// (e.g. a just-enabled module page whose API still 404s) can't blank the whole
// kiosk. React unmounts the entire root on an uncaught render error, so without
// this a single `.map` on a non-array would black out everything.
//
//   resetKey  — when it changes (usually the route path), the error clears so
//               navigating away recovers without a reload.
//   silent    — render nothing on error (for ambient/overlay slots that must
//               never show chrome).
// =============================================================================
import { Component } from 'react'

const btn = {
  fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
  background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)',
  borderRadius: 8, color: 'var(--text-primary,#e8e6e0)', padding: '9px 16px', cursor: 'pointer',
}

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    // surface for debugging; the boundary keeps the rest of the app alive
    console.error('[thrive] ErrorBoundary caught:', error, info && info.componentStack)
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.silent) return null
    return (
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
        fontFamily: 'var(--font-mono,monospace)', color: 'var(--text-secondary,#aaa)' }}>
        <div style={{ fontSize: 30 }}>😬</div>
        <div style={{ fontSize: 15, color: 'var(--text-primary,#e8e6e0)' }}>This page hit an error.</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary,#666)', maxWidth: 440, lineHeight: 1.6 }}>
          The rest of thrive is fine — head back or reload. If you just enabled a module, give its
          backend a moment to come up.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn} onClick={() => this.setState({ error: null })}>Try again</button>
          <button style={btn} onClick={() => { window.location.href = '/' }}>Home</button>
        </div>
      </div>
    )
  }
}
