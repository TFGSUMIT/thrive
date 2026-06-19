// =============================================================================
// EmojiPicker.jsx — categorized popover emoji chooser (no deps)
// thrive UI — used for profile avatars; reusable for any emoji field.
//
// Click the swatch to open; pick a category tab, choose an emoji, or type any
// emoji in the "custom" box. Closes on outside click / selection. Opens upward
// when there isn't room below (so it isn't clipped by a card's overflow).
// =============================================================================
import { useEffect, useRef, useState } from 'react'

const CATEGORIES = [
  { key: 'faces', tab: '🙂', emoji:
    '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖' },
  { key: 'people', tab: '🧑', emoji:
    '👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 👷 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🏃 💃 🕺 👯 🧖 🧗 🤺 🏇 ⛷️ 🏂 🏌️ 🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🤸 🤼 🤽 🤾 🤹 🧘 👋 🤚 ✋ 🖖 👌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 👍 👎 ✊ 👊 👏 🙌 🙏 💪 🦵 🦶 👂 👃 🧠 👀 👁️ 👅 👄' },
  { key: 'animals', tab: '🐶', emoji:
    '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐀 🐿️ 🦔' },
  { key: 'nature', tab: '🌸', emoji:
    '🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🍄 🐚 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 🌎 🌍 🌏 ⭐ 🌟 💫 ✨ ☄️ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ 🌩️ ❄️ ⛄ 💧 🌊' },
  { key: 'food', tab: '🍔', emoji:
    '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🧀 🥚 🍳 🧇 🥞 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🥤 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🍾' },
  { key: 'activity', tab: '⚽', emoji:
    '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🏑 🥍 🏏 ⛳ 🪁 🏹 🎣 🥊 🥋 🎽 🛹 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚵 🚴 🏆 🥇 🥈 🥉 🏅 🎖️ 🏵️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩' },
  { key: 'travel', tab: '🚗', emoji:
    '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🚚 🚛 🚜 🛴 🚲 🛵 🏍️ 🛺 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🚁 🚀 🛸 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🚧 ⛽ 🚏 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🌃 🌆 🌇 🌉 🌌 🎆 🎇' },
  { key: 'objects', tab: '💡', emoji:
    '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📷 📸 📹 🎥 📞 ☎️ 📟 📺 📻 🧭 ⏰ ⏳ 🔋 🔌 💡 🔦 🕯️ 🧯 🛢️ 💸 💵 💰 💳 💎 ⚖️ 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🧰 🧲 🔫 💣 🧨 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🔮 📿 🧿 💈 🔭 🔬 🩺 💊 💉 🩹 🌡️ 🧹 🧺 🧻 🚽 🚿 🛁 🧼 🪒 🧽 🔑 🗝️ 🚪 🛋️ 🛏️ 🖼️ 🛍️ 🎁 🎈 🎏 🎀 🎉 🎊 🪔 ✉️ 📦 📫 📮 📝 ✏️ 🖊️ 🖌️ 🖍️ 📚 📖 🔖 🔗 📎 📐 📏 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔏' },
  { key: 'symbols', tab: '❤️', emoji:
    '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🉑 ☢️ ☣️ 📴 📳 ⭕ ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ ‼️ ⁉️ ❓ ❗ 〰️ 💱 💲 ⚜️ 🔱 📛 🔰 ⭐ 🌟 ✨ ⚡ 🔥 💥 💫 💯 🎵 🎶 ➰ ➿ ✔️ 🔠 🔡 🔢 🔣 🔤' },
]

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e', '#64748b', '#e8e6e0',
]

// When `onColor` is provided the popover also includes colour controls, so a
// single swatch edits both an emoji and its colour.
export default function EmojiPicker({ value, onChange, color, onColor, size = 48 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)   // {left, top|bottom} viewport coords (fixed)
  const [cat, setCat] = useState(0)
  const [custom, setCustom] = useState('')
  const ref = useRef(null)
  const btnRef = useRef(null)
  const W = 280, H = onColor ? 410 : 320

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (e.type === 'resize') { setOpen(false); return }
      // mousedown / scroll: ignore anything inside the picker (e.g. the grid's own scroll)
      if (ref.current && ref.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)   // popover is fixed -> close if page scrolls
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8))
      // open downward unless there isn't room (then anchor above the swatch)
      const pos = (r.bottom + H + 8 < window.innerHeight)
        ? { left, top: r.bottom + 6 }
        : { left, bottom: window.innerHeight - r.top + 6 }
      setPos(pos)
    }
    setOpen(o => !o)
  }
  const pick = (em) => { onChange(em); setOpen(false); setCustom('') }
  const list = CATEGORIES[cat].emoji.trim().split(/\s+/)

  return (
    <div ref={ref} style={{ position: 'relative', width: size }}>
      <button ref={btnRef} type="button" onClick={toggle} title="Change icon"
        style={{ width: size, height: size, borderRadius: size >= 44 ? 10 : 8, fontSize: Math.round(size * 0.5), cursor: 'pointer',
          background: (color || '#333') + '22', border: `1px solid ${(color || '#333')}66`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}>
        {value || '🙂'}
      </button>
      {open && pos && (
        <div style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 1000, width: W,
          background: 'var(--bg-secondary,#181818)', border: '1px solid var(--border-color,#333)',
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', padding: 8 }}>
          {/* category tabs */}
          <div style={{ display: 'flex', gap: 1, marginBottom: 6, borderBottom: '1px solid var(--border-color,#2a2a2a)', paddingBottom: 6 }}>
            {CATEGORIES.map((c, i) => (
              <button key={c.key} type="button" onClick={() => setCat(i)} title={c.key}
                style={{ flex: 1, fontSize: 16, padding: '4px 0', borderRadius: 6, cursor: 'pointer', lineHeight: 1,
                  background: i === cat ? 'var(--bg-tertiary,#222)' : 'none',
                  border: i === cat ? '1px solid var(--border-color,#333)' : '1px solid transparent',
                  color: 'inherit', opacity: i === cat ? 1 : 0.6 }}>
                {c.tab}
              </button>
            ))}
          </div>
          {/* emoji grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, height: 196, overflowY: 'auto', alignContent: 'start' }}>
            {list.map((em, i) => (
              <button key={em + i} type="button" onClick={() => pick(em)} title={em}
                style={{ fontSize: 18, padding: '4px 0', borderRadius: 6, cursor: 'pointer', lineHeight: 1,
                  background: value === em ? 'var(--bg-tertiary,#222)' : 'none', border: 'none', color: 'inherit' }}>
                {em}
              </button>
            ))}
          </div>
          {/* custom fallback */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
            <input placeholder="type any emoji…" value={custom} maxLength={8}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) pick(custom.trim()) }}
              style={{ flex: 1, fontFamily: 'inherit', fontSize: 16, textAlign: 'center',
                background: 'var(--bg-tertiary,#222)', border: '1px solid var(--border-color,#333)',
                borderRadius: 6, color: 'inherit', padding: '5px', outline: 'none', minWidth: 0 }} />
            <button type="button" onClick={() => custom.trim() && pick(custom.trim())}
              style={{ fontFamily: 'monospace', fontSize: 11, textTransform: 'uppercase', background: 'none',
                border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'var(--text-secondary,#aaa)',
                cursor: 'pointer', padding: '0 10px' }}>Set</button>
          </div>

          {/* colour section (only when an onColor handler is provided) */}
          {onColor && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-color,#2a2a2a)' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#666)', marginBottom: 6 }}>Color</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4 }}>
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => onColor(c)} title={c}
                    style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', justifySelf: 'center',
                      border: (color || '').toLowerCase() === c.toLowerCase() ? '2px solid var(--text-primary,#e8e6e0)' : '2px solid transparent' }} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <input type="color" value={color || '#666666'} onChange={e => onColor(e.target.value)}
                  style={{ width: 30, height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
                <input type="text" value={color || ''} maxLength={7} placeholder="#rrggbb"
                  onChange={e => onColor(e.target.value)}
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-tertiary,#222)',
                    border: '1px solid var(--border-color,#333)', borderRadius: 6, color: 'inherit', padding: '5px', outline: 'none', minWidth: 0 }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
