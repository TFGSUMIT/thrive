// =============================================================================
// HomePage.jsx — Home module page (home base)
// thrive UI — reached via the 🏠 icon in the top bar
//
// Two parts:
//   • Home base — the primary property: address, geocoded map (Leaflet,
//     draggable pin), beds/baths/sqft, rental + landlord details. Editing is
//     admin-only (backend gates writes to admins).
//   • People — a read-only roster of household profiles (the `users` module).
//     Just who lives here (name + avatar/color); managed over in Users.
// =============================================================================
import { useState, useEffect, useCallback, useRef } from "react"
import { useAuth } from "@trunk/context/AuthContext"
import { api } from "@trunk/api"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

// ── shared styles ────────────────────────────────────────────────────────────
const card       = { background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 12 }
const labelStyle = { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" }
const inputStyle = { fontFamily: "monospace", fontSize: 13, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "inherit", padding: "7px 10px", outline: "none", width: "100%", boxSizing: "border-box" }
const btnPrimary = { fontFamily: "monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--text-primary,#e8e6e0)", border: "none", borderRadius: 6, color: "var(--bg-primary,#0f0f0f)", fontWeight: 500, cursor: "pointer", padding: "8px 16px" }
const btnSecondary = { fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "var(--text-secondary,#aaa)", cursor: "pointer", padding: "6px 12px" }
const sectionHead = { padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)", display: "flex", alignItems: "center", justifyContent: "space-between" }

function Field({ label: lbl, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
      <label style={labelStyle}>{lbl}</label>
      {children}
    </div>
  )
}

// ── Leaflet map ──────────────────────────────────────────────────────────────
function MiniMap({ lat, lng, draggable = false, onMove }) {
  const elRef  = useRef(null)
  const mapRef = useRef(null)
  useEffect(() => {
    const el = elRef.current
    if (!el || !Number.isFinite(lat) || !Number.isFinite(lng)) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    if (el._leaflet_id) { el._leaflet_id = null }
    let map
    try {
      map = L.map(el, { scrollWheelZoom: true }).setView([lat, lng], 17)
      mapRef.current = map
      const road = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" })
      const sat  = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery &copy; Esri" })
      road.addTo(map)
      L.control.layers({ Road: road, Satellite: sat }, null, { position: "topright" }).addTo(map)
      L.control.scale({ imperial: true, metric: true }).addTo(map)
      const marker = L.marker([lat, lng], { draggable: !!draggable }).addTo(map)
      if (draggable && onMove) {
        marker.on("dragend", () => { const p = marker.getLatLng(); onMove(p.lat, p.lng) })
      }
    } catch (err) { return }
    const t1 = setTimeout(() => { try { map.invalidateSize() } catch {} }, 100)
    const t2 = setTimeout(() => { try { map.invalidateSize() } catch {} }, 500)
    return () => { clearTimeout(t1); clearTimeout(t2); try { map.remove() } catch {} mapRef.current = null }
  }, [lat, lng])
  return <div ref={elRef} style={{ height: 440, minHeight: 440, width: "100%", background: "#1a1a1a" }} />
}

// ── home form ─────────────────────────────────────────────────────────────────
function HomeForm({ initial = {}, onSave, onCancel, saving }) {
  const [f, setF] = useState({ kind: "home", label: "", address: "", lat: null, lng: null, sqft: "", beds: "", baths: "", is_rental: true, landlord: "", landlord_notes: "", notes: "", ...initial })
  const [geocoding, setGeocoding] = useState(false)
  const [geoMsg, setGeoMsg] = useState(null)
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))
  const located = Number.isFinite(f.lat) && Number.isFinite(f.lng)

  const locate = async () => {
    if (!f.address || f.address.length < 3) { setGeoMsg("Enter an address first"); return }
    setGeocoding(true); setGeoMsg(null)
    try {
      const d = await api.get(`/properties/geocode?q=${encodeURIComponent(f.address)}`)
      if (d.found) { setF(p => ({ ...p, lat: d.lat, lng: d.lng })); setGeoMsg(`Pin set · ${d.display_name?.slice(0, 60) || ""}`) }
      else setGeoMsg("Couldn't find that address — check spelling")
    } catch { setGeoMsg("Lookup failed") }
    finally { setGeocoding(false) }
  }

  return (
    <div style={{ padding: 16 }}>
      <Field label="Label (optional)"><input style={inputStyle} value={f.label} onChange={set("label")} placeholder="e.g. Home, The Apartment" /></Field>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        <label style={labelStyle}>Address</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} value={f.address} onChange={set("address")} placeholder="123 Main St, City, ST 00000" />
          <button onClick={locate} disabled={geocoding} style={{ ...btnSecondary, whiteSpace: "nowrap", opacity: geocoding ? 0.5 : 1 }}>{geocoding ? "…" : "📍 Locate"}</button>
        </div>
        {geoMsg && <span style={{ fontSize: 10, color: located ? "var(--color-success,#22c55e)" : "#f59e0b" }}>{geoMsg}</span>}
      </div>
      {located && (
        <>
          <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-color,#2a2a2a)", marginBottom: 4 }}>
            <MiniMap lat={f.lat} lng={f.lng} draggable onMove={(lat, lng) => setF(p => ({ ...p, lat, lng }))} />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary,#777)", marginBottom: 12, textAlign: "center" }}>Drag the pin to fine-tune</div>
        </>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 12px" }}>
        <Field label="Beds"><input style={inputStyle} type="number" step="0.5" value={f.beds} onChange={set("beds")} placeholder="3" /></Field>
        <Field label="Baths"><input style={inputStyle} type="number" step="0.5" value={f.baths} onChange={set("baths")} placeholder="2" /></Field>
        <Field label="Sq ft"><input style={inputStyle} type="number" value={f.sqft} onChange={set("sqft")} placeholder="1450" /></Field>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input id="is_rental" type="checkbox" checked={!!f.is_rental} onChange={e => setF(p => ({ ...p, is_rental: e.target.checked }))} />
        <label htmlFor="is_rental" style={{ fontSize: 12, color: "var(--text-secondary,#aaa)", cursor: "pointer" }}>This is a rental</label>
      </div>
      {f.is_rental && (
        <div style={{ borderTop: "1px solid var(--border-color,#2a2a2a)", paddingTop: 12, marginBottom: 4 }}>
          <Field label="Landlord (name / contact)"><input style={inputStyle} value={f.landlord} onChange={set("landlord")} placeholder="Name, phone, or email" /></Field>
          <Field label="Landlord-involved items"><input style={inputStyle} value={f.landlord_notes} onChange={set("landlord_notes")} placeholder="e.g. repairs, lease renewal, deposit" /></Field>
        </div>
      )}
      <Field label="Notes"><input style={inputStyle} value={f.notes} onChange={set("notes")} placeholder="Anything else" /></Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        {onCancel && <button style={btnSecondary} onClick={onCancel}>Cancel</button>}
        <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={() => onSave(f)} disabled={saving}>{saving ? "Saving…" : "✦ Save home"}</button>
      </div>
    </div>
  )
}

// ── home card ────────────────────────────────────────────────────────────────
function HomeCard({ home, canEdit, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const hasGps = Number.isFinite(home.lat) && Number.isFinite(home.lng)
  return (
    <div style={{ ...card }}>
      <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--text-tertiary,#666)", letterSpacing: "0.06em" }}>🏠 {home.label || "Home"}</span>
        {canEdit && (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onEdit} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--text-tertiary,#444)", fontFamily: "monospace", padding: 0, letterSpacing: "0.04em", opacity: 0.6 }}>edit</button>
            {confirming ? (
              <>
                <button onClick={onDelete} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--color-danger,#ef4444)", fontFamily: "monospace", padding: 0, opacity: 0.7 }}>yes</button>
                <button onClick={() => setConfirming(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--text-tertiary,#444)", fontFamily: "monospace", padding: 0, opacity: 0.6 }}>no</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--text-tertiary,#333)", fontFamily: "monospace", padding: 0, opacity: 0.4, letterSpacing: "0.04em" }}>×</button>
            )}
          </div>
        )}
      </div>
      <div style={{ padding: "14px 16px" }}>
        {home.address && <div style={{ fontSize: 14, color: "var(--text-primary,#e8e6e0)", marginBottom: 8 }}>{home.address}</div>}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          {home.beds  != null && <span style={{ fontSize: 12, color: "var(--text-secondary,#aaa)" }}>{home.beds} bd</span>}
          {home.baths != null && <span style={{ fontSize: 12, color: "var(--text-secondary,#aaa)" }}>{home.baths} ba</span>}
          {home.sqft  != null && <span style={{ fontSize: 12, color: "var(--text-secondary,#aaa)" }}>{Number(home.sqft).toLocaleString()} sq ft</span>}
          {home.is_rental ? <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.12)", color: "#3b82f6", fontFamily: "monospace" }}>RENTAL</span> : null}
        </div>
        {home.is_rental && (home.landlord || home.landlord_notes) && (
          <div style={{ background: "var(--bg-tertiary,#1a1a1a)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 8, padding: "10px 12px", marginTop: 10 }}>
            <div style={{ ...labelStyle, marginBottom: 6 }}>Landlord</div>
            {home.landlord && <div style={{ fontSize: 12, color: "var(--text-secondary,#ccc)" }}>{home.landlord}</div>}
            {home.landlord_notes && <div style={{ fontSize: 11, color: "var(--text-tertiary,#999)", marginTop: 2 }}>{home.landlord_notes}</div>}
          </div>
        )}
      </div>

      {/* inline map — shown once the home location is defined */}
      {hasGps && (
        <div style={{ borderTop: "1px solid var(--border-color,#2a2a2a)" }}>
          <MiniMap lat={home.lat} lng={home.lng} />
        </div>
      )}
    </div>
  )
}

// ── people roster (read-only; profiles from the `users` module) ───────────────
function PersonChip({ p }) {
  const c = p.color || "#64748b"
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 12px 4px 5px", borderRadius: 16, background: "var(--bg-tertiary,#222)", border: `1px solid ${c}55` }}>
      <span style={{ width: 24, height: 24, borderRadius: "50%", background: `${c}22`, border: `1px solid ${c}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{p.avatar || (p.name ? p.name[0].toUpperCase() : "?")}</span>
      <span style={{ fontSize: 13, color: "var(--text-secondary,#ccc)" }}>{p.name}</span>
    </span>
  )
}

function PeopleRoster() {
  const [people,  setPeople]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get("/users")
      .then(p => setPeople(Array.isArray(p) ? p : []))
      .catch(() => setPeople([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ ...card }}>
      <div style={sectionHead}><span>Who lives here</span></div>
      {loading ? (
        <div style={{ padding: "1rem", fontSize: 12, color: "var(--text-tertiary,#666)" }}>Loading…</div>
      ) : people.length === 0 ? (
        <div style={{ padding: "1.25rem", fontSize: 12, color: "var(--text-tertiary,#666)", textAlign: "center", lineHeight: 1.7 }}>
          No profiles yet.<br /><span style={{ fontSize: 11 }}>Add people in the Users module.</span>
        </div>
      ) : (
        <div style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {people.map(p => <PersonChip key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { user }  = useAuth()
  const isAdmin   = user?.role === "admin"
  const [home,    setHome]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async () => {
    try { setHome(await api.get("/properties/home")) }
    catch { setHome(null) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const num = v => (v === "" || v == null ? null : parseFloat(v))
  const saveHome = async (f) => {
    setSaving(true)
    try {
      const payload = { kind: "home", label: f.label || null, address: f.address || null, lat: Number.isFinite(f.lat) ? f.lat : null, lng: Number.isFinite(f.lng) ? f.lng : null, sqft: num(f.sqft), beds: num(f.beds), baths: num(f.baths), is_rental: !!f.is_rental, landlord: f.is_rental ? (f.landlord || null) : null, landlord_notes: f.is_rental ? (f.landlord_notes || null) : null, notes: f.notes || null }
      if (home) await api.patch(`/properties/${home.id}`, payload)
      else      await api.post("/properties", payload)
      setEditing(false); load()
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }
  const removeHome = async () => {
    if (!home) return
    try { await api.del(`/properties/${home.id}`); setHome(null) }
    catch (e) { console.error(e) }
  }

  return (
    <div style={{ padding: "2.5rem 2rem 4rem" }}>
      {/* heading */}
      <div style={{ marginBottom: "2.5rem" }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "0.06em", fontFamily: "var(--font-mono,monospace)" }}>Home</div>
        <div style={{ fontSize: 13, color: "var(--text-tertiary,#888)", marginTop: 4 }}>your home base</div>
      </div>

      {/* home, then people stacked underneath */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* home */}
        <div>
          {loading ? <div style={{ fontSize: 13, color: "var(--text-secondary,#888)" }}>Loading…</div>
            : (isAdmin && (editing || !home)) ? (
              <div style={{ ...card }}>
                <div style={sectionHead}><span>{home ? "Edit home" : "Set up your home"}</span></div>
                <HomeForm initial={home || {}} onSave={saveHome} onCancel={home ? () => setEditing(false) : undefined} saving={saving} />
              </div>
            ) : home ? (
              <HomeCard home={home} canEdit={isAdmin} onEdit={() => setEditing(true)} onDelete={removeHome} />
            ) : (
              <div style={{ ...card }}>
                <div style={sectionHead}><span>Home base</span></div>
                <div style={{ padding: "1.5rem", fontSize: 12, color: "var(--text-tertiary,#666)", textAlign: "center" }}>No home set up yet.</div>
              </div>
            )}
        </div>
        {/* people */}
        <PeopleRoster />
      </div>
    </div>
  )
}
