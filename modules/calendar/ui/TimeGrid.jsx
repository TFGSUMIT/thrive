// =============================================================================
// TimeGrid.jsx — hourly timeline for the calendar's Week and Day views.
// Renders N day-columns (1 for Day, 7 for Week) over a 24h grid: an all-day strip
// on top, hour lines down the side, timed events placed + sized by their actual
// time with side-by-side lane packing for overlaps, and a "now" line on today.
// Tap an empty slot to add at that hour; tap an event to edit. Reuses the page's
// byDay map + calendar colors (cross-cut by props, not imports).
// =============================================================================
import { useRef, useLayoutEffect } from 'react'

const HOUR_H = 52          // px per hour
const GUTTER = 56          // px hour-label column
const DAY_MIN = 24 * 60
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const BORDER = 'var(--border-color,#2a2a2a)'
const FAINT  = 'var(--border-color,#1c1c1c)'

const pad   = (n) => String(n).padStart(2, '0')
const dkey  = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DOW   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hourLabel = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`)

// a timed event's minute span clamped to [0,1440] within the given day (null if
// it doesn't touch the day or is all-day)
function spanForDay(ev, dayStart, dayEnd) {
  if (ev.all_day) return null
  const s = new Date(ev.start), e = new Date(ev.end)
  if (e <= dayStart || s >= dayEnd) return null
  const startMin = Math.max(0, (s - dayStart) / 60000)
  const endMin = Math.min(DAY_MIN, (e - dayStart) / 60000)
  return { startMin, endMin: Math.max(endMin, startMin + 18) }   // floor height so titles fit
}

// greedy column layout: cluster transitively-overlapping events, assign lanes
// within each cluster, width = 1 / columns-in-cluster
function layout(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const out = []
  let cluster = [], clusterEnd = -1
  const flush = () => {
    const laneEnds = []
    for (const it of cluster) {
      let lane = laneEnds.findIndex(end => end <= it.startMin)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endMin) } else laneEnds[lane] = it.endMin
      it.lane = lane
    }
    for (const it of cluster) { it.cols = laneEnds.length; out.push(it) }
    cluster = []; clusterEnd = -1
  }
  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  if (cluster.length) flush()
  return out
}

function DayColumn({ day, byDay, calById, accent, onOpenEvent, onNewAt, todayKey, now, first }) {
  const k = dkey(day)
  const dayStart = new Date(`${k}T00:00:00`)
  const dayEnd = new Date(dayStart.getTime() + DAY_MIN * 60000)
  const evts = byDay[k] || []
  const timed = layout(evts.map(ev => ({ ev, ...(spanForDay(ev, dayStart, dayEnd) || {}) })).filter(x => x.startMin != null))
  const isToday = k === todayKey
  return (
    <div style={{ position: 'relative', height: 24 * HOUR_H, borderLeft: first ? 'none' : `1px solid ${BORDER}` }}>
      {HOURS.map(h => (
        <div key={h} onClick={() => onNewAt(k, h)}
          style={{ position: 'absolute', top: h * HOUR_H, left: 0, right: 0, height: HOUR_H, borderTop: h ? `1px solid ${FAINT}` : 'none', boxSizing: 'border-box', cursor: 'pointer' }} />
      ))}
      {isToday && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: (now.getHours() * 60 + now.getMinutes()) * (HOUR_H / 60), height: 0, borderTop: '2px solid var(--color-danger,#ef4444)', zIndex: 4 }}>
          <span style={{ position: 'absolute', left: 0, top: -4, width: 8, height: 8, borderRadius: '50%', background: 'var(--color-danger,#ef4444)' }} />
        </div>
      )}
      {timed.map(({ ev, startMin, endMin, lane, cols }) => {
        const color = calById[ev.calendar_id]?.color || accent
        return (
          <div key={`${ev.calendar_id}:${ev.id}:${k}`} onClick={(e) => { e.stopPropagation(); onOpenEvent(ev) }}
            title={`${ev.title} · ${pad(new Date(ev.start).getHours())}:${pad(new Date(ev.start).getMinutes())}`}
            style={{ position: 'absolute', top: startMin * (HOUR_H / 60), height: Math.max((endMin - startMin) * (HOUR_H / 60) - 2, 16),
              left: `calc(${(lane / cols) * 100}% + 2px)`, width: `calc(${(1 / cols) * 100}% - 4px)`,
              background: `${color}2e`, borderLeft: `3px solid ${color}`, borderRadius: 4, padding: '2px 6px', overflow: 'hidden',
              cursor: 'pointer', zIndex: 2, boxSizing: 'border-box' }}>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary,#999)', lineHeight: '13px' }}>
              {pad(new Date(ev.start).getHours())}:{pad(new Date(ev.start).getMinutes())}
            </div>
            <div style={{ fontSize: 11, lineHeight: '14px', color: 'var(--text-primary,#e8e6e0)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function TimeGrid({ days, byDay, calById, accent, onOpenEvent, onNewAt, todayKey }) {
  const scrollRef = useRef(null)
  const now = new Date()
  // open near the working day; if today is shown, center on now
  useLayoutEffect(() => {
    const c = scrollRef.current; if (!c) return
    const showsToday = days.some(d => dkey(d) === todayKey)
    const h = showsToday ? Math.max(now.getHours() - 2, 0) : 7
    c.scrollTop = h * HOUR_H
  }, [days, todayKey])  // eslint-disable-line

  const cols = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <div />
        {days.map(d => {
          const isToday = dkey(d) === todayKey
          return (
            <div key={dkey(d)} style={{ textAlign: 'center', padding: '6px 0', borderLeft: `1px solid ${BORDER}` }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary,#888)' }}>{DOW[d.getDay()]}</div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: isToday ? 'var(--accent,#f97316)' : 'var(--text-primary,#e8e6e0)' }}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      {/* all-day strip */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, borderBottom: `1px solid ${BORDER}`, flexShrink: 0, maxHeight: 96, overflowY: 'auto' }}>
        <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary,#666)', padding: '6px 4px', textAlign: 'right' }}>all-day</div>
        {days.map(d => {
          const k = dkey(d)
          const allday = (byDay[k] || []).filter(ev => ev.all_day)
          return (
            <div key={k} style={{ borderLeft: `1px solid ${BORDER}`, padding: 3, minHeight: 24 }}>
              {allday.map(ev => {
                const color = calById[ev.calendar_id]?.color || accent
                return (
                  <div key={`${ev.calendar_id}:${ev.id}:${k}`} onClick={(e) => { e.stopPropagation(); onOpenEvent(ev) }} title={ev.title}
                    style={{ fontSize: 11, lineHeight: '16px', padding: '1px 6px', marginBottom: 2, borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', background: `${color}33`, borderLeft: `2px solid ${color}` }}>
                    {ev.title}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* scrollable hour grid */}
      <style>{`.tg-scroll::-webkit-scrollbar{display:none}.tg-scroll{scrollbar-width:none;-ms-overflow-style:none}`}</style>
      <div ref={scrollRef} className="tg-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols }}>
          {/* hour-label gutter */}
          <div style={{ position: 'relative', height: 24 * HOUR_H }}>
            {HOURS.map(h => (
              <div key={h} style={{ position: 'absolute', top: h * HOUR_H - 6, right: 6, fontSize: 9, fontFamily: 'monospace', color: 'var(--text-tertiary,#666)' }}>{h ? hourLabel(h) : ''}</div>
            ))}
          </div>
          {days.map((d, i) => (
            <DayColumn key={dkey(d)} day={d} byDay={byDay} calById={calById} accent={accent}
              onOpenEvent={onOpenEvent} onNewAt={onNewAt} todayKey={todayKey} now={now} first={i === 0} />
          ))}
        </div>
      </div>
    </div>
  )
}
