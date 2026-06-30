// =============================================================================
// VehiclesPage.jsx — Vehicle profiles, oil changes, tire tracking
// thrive UI
// =============================================================================
import { useState, useEffect, useCallback, useRef } from "react";

const API = "/api/vehicles";
function today() { return new Date().toISOString().slice(0, 10); }
const fmt = (n, dec = 0) => (n == null ? "—" : Number(n).toFixed(dec));

const POSITIONS = ["FL", "FR", "RL", "RR", "spare"];
const POSITION_LABELS = { FL: "Front Left", FR: "Front Right", RL: "Rear Left", RR: "Rear Right", spare: "Spare" };

// ── shared styles ──────────────────────────────────────────────────────────
const card  = { background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 };
const label = { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" };
const input = { fontFamily: "monospace", fontSize: 13, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "inherit", padding: "7px 10px", outline: "none", width: "100%", boxSizing: "border-box" };
const btnPrimary = { fontFamily: "monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--text-primary,#e8e6e0)", border: "none", borderRadius: 6, color: "var(--bg-primary,#0f0f0f)", fontWeight: 500, cursor: "pointer", padding: "8px 16px" };
const btnSecondary = { fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "var(--text-secondary,#aaa)", cursor: "pointer", padding: "6px 12px" };
const btnDanger = { ...btnSecondary, color: "var(--color-danger,#ef4444)", borderColor: "transparent" };
const sectionHead = { padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)", display: "flex", alignItems: "center", justifyContent: "space-between" };

function Badge({ status, text }) {
  const colors = {
    overdue: { bg: "var(--danger-muted)",  color: "var(--color-danger)" },
    soon:    { bg: "var(--warning-muted)", color: "var(--color-warning)" },
    ok:      { bg: "var(--success-muted)", color: "var(--color-success)" },
  };
  const c = colors[status] || colors.ok;
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.color, fontFamily: "monospace" }}>
      {text}
    </span>
  );
}

// ── field helper ───────────────────────────────────────────────────────────
function Field({ label: lbl, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
      <label style={label}>{lbl}</label>
      {children}
    </div>
  );
}

// ── vehicle form ───────────────────────────────────────────────────────────
function VehicleForm({ initial = {}, onSave, onCancel, saving }) {
  const [f, setF] = useState({
    nickname: "", year: "", make: "", model: "", trim: "", vin: "", plate: "", notes: "", color: "",
    status: "active", disposed_date: "", disposed_price: "", disposed_mileage: "", disposed_to: "", disposed_note: "",
    ...initial,
  });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  const isFormer = f.status === "former";
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Field label="Nickname"><input style={input} value={f.nickname} onChange={set("nickname")} placeholder="e.g. Daily Driver" /></Field>
        <Field label="Year"><input style={input} type="number" value={f.year} onChange={set("year")} placeholder="2019" /></Field>
        <Field label="Make"><input style={input} value={f.make} onChange={set("make")} placeholder="Toyota" /></Field>
        <Field label="Model"><input style={input} value={f.model} onChange={set("model")} placeholder="Camry" /></Field>
        <Field label="Trim"><input style={input} value={f.trim} onChange={set("trim")} placeholder="SE" /></Field>
        <Field label="License Plate"><input style={input} value={f.plate} onChange={set("plate")} placeholder="ABC-1234" /></Field>
      </div>
      <Field label="VIN"><input style={input} value={f.vin} onChange={set("vin")} placeholder="17-character VIN" /></Field>
      <Field label="Notes"><input style={input} value={f.notes} onChange={set("notes")} placeholder="Optional" /></Field>

      <Field label="Color">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="color" value={f.color || "#3b82f6"} onChange={set("color")}
            style={{ width: 42, height: 32, padding: 0, border: "1px solid var(--border-color,#333)", borderRadius: 6, background: "var(--bg-tertiary,#222)", cursor: "pointer" }} />
          <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-tertiary,#888)" }}>{f.color || "none"}</span>
          {f.color && <button style={{ ...btnSecondary, padding: "4px 10px" }} onClick={() => setF(p => ({ ...p, color: "" }))}>Clear</button>}
        </div>
      </Field>

      <Field label="Status">
        <select style={input} value={f.status} onChange={set("status")}>
          <option value="active">Active — in the fleet</option>
          <option value="former">Former — no longer owned</option>
        </select>
      </Field>

      {isFormer && (
        <div style={{ borderTop: "1px solid var(--border-color,#2a2a2a)", marginTop: 4, paddingTop: 12 }}>
          <div style={{ ...label, marginBottom: 10 }}>When it left the fleet</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <Field label="Date sold / disposed"><input style={input} type="date" value={f.disposed_date} onChange={set("disposed_date")} /></Field>
            <Field label="Sale price ($)"><input style={input} type="number" step="0.01" value={f.disposed_price} onChange={set("disposed_price")} placeholder="12500" /></Field>
            <Field label="Final mileage"><input style={input} type="number" value={f.disposed_mileage} onChange={set("disposed_mileage")} placeholder="142000" /></Field>
            <Field label="Sold / given to"><input style={input} value={f.disposed_to} onChange={set("disposed_to")} placeholder="e.g. CarMax, a friend" /></Field>
          </div>
          <Field label="Disposition note"><input style={input} value={f.disposed_note} onChange={set("disposed_note")} placeholder="Optional — why, condition, etc." /></Field>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
        <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={() => onSave(f)} disabled={saving}>
          {saving ? "Saving…" : "✦ Save vehicle"}
        </button>
      </div>
    </div>
  );
}

// ── oil change form ────────────────────────────────────────────────────────
function OilForm({ initial = {}, onSave, onCancel, saving }) {
  const [f, setF] = useState({ date: today(), odometer: "", oil_type: "", filter_brand: "", next_due_date: "", next_due_miles: "", notes: "", ...initial });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--border-color,#2a2a2a)" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginBottom: 12 }}>
        {initial.id ? "Edit oil change" : "Log oil change"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Field label="Date"><input style={input} type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="Odometer (mi)"><input style={input} type="number" value={f.odometer} onChange={set("odometer")} placeholder="56000" /></Field>
        <Field label="Oil type / viscosity"><input style={input} value={f.oil_type} onChange={set("oil_type")} placeholder="5W-30 Full Synthetic" /></Field>
        <Field label="Filter brand / part #"><input style={input} value={f.filter_brand} onChange={set("filter_brand")} placeholder="Wix 57356" /></Field>
        <Field label="Next due date"><input style={input} type="date" value={f.next_due_date} onChange={set("next_due_date")} /></Field>
        <Field label="Next due (mi)"><input style={input} type="number" value={f.next_due_miles} onChange={set("next_due_miles")} placeholder="61000" /></Field>
      </div>
      <Field label="Notes"><input style={input} value={f.notes} onChange={set("notes")} placeholder="Optional" /></Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
        <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={() => onSave(f)} disabled={saving}>
          {saving ? "Saving…" : "✦ Save"}
        </button>
      </div>
    </div>
  );
}

// ── tire form ──────────────────────────────────────────────────────────────
function TireForm({ initial = {}, onSave, onCancel, saving }) {
  const [f, setF] = useState({ position: "FL", brand: "", model: "", size: "", installed_date: today(), installed_miles: "", tread_depth: "", rotation_interval_miles: "", next_rotation_miles: "", notes: "", ...initial });
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }));
  return (
    <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--border-color,#2a2a2a)" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginBottom: 12 }}>
        {initial.id ? "Edit tire" : "Add tire"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        <Field label="Position">
          <select style={input} value={f.position} onChange={set("position")}>
            {POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}
          </select>
        </Field>
        <Field label="Size"><input style={input} value={f.size} onChange={set("size")} placeholder="225/45R17" /></Field>
        <Field label="Brand"><input style={input} value={f.brand} onChange={set("brand")} placeholder="Michelin" /></Field>
        <Field label="Model"><input style={input} value={f.model} onChange={set("model")} placeholder="Pilot Sport 4" /></Field>
        <Field label="Installed date"><input style={input} type="date" value={f.installed_date} onChange={set("installed_date")} /></Field>
        <Field label="Installed at (mi)"><input style={input} type="number" value={f.installed_miles} onChange={set("installed_miles")} placeholder="54000" /></Field>
        <Field label="Tread depth (32nds)"><input style={input} type="number" step="0.5" value={f.tread_depth} onChange={set("tread_depth")} placeholder="10/32" /></Field>
        <Field label="Rotation interval (mi)"><input style={input} type="number" value={f.rotation_interval_miles} onChange={set("rotation_interval_miles")} placeholder="7500" /></Field>
        <Field label="Next rotation due (mi)"><input style={input} type="number" value={f.next_rotation_miles} onChange={set("next_rotation_miles")} placeholder="61500" /></Field>
      </div>
      <Field label="Notes"><input style={input} value={f.notes} onChange={set("notes")} placeholder="Optional" /></Field>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
        <button style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }} onClick={() => onSave(f)} disabled={saving}>
          {saving ? "Saving…" : "✦ Save"}
        </button>
      </div>
    </div>
  );
}

// ── oil change panel ───────────────────────────────────────────────────────
function OilPanel({ vehicleId, summary, showToast, showConfirm }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`${API}/${vehicleId}/oil`);
    setRecords(await r.json());
    setLoading(false);
  }, [vehicleId]);
  useEffect(() => { load(); }, [load]);

  const save = async (f) => {
    setSaving(true);
    try {
      const url  = editing ? `${API}/${vehicleId}/oil/${editing.id}` : `${API}/${vehicleId}/oil`;
      const meth = editing ? "PATCH" : "POST";
      const body = { ...f, odometer: parseFloat(f.odometer) || 0, next_due_miles: parseFloat(f.next_due_miles) || null, next_due_date: f.next_due_date || null };
      const res  = await fetch(url, { method: meth, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Save failed");
      showToast?.("Oil change saved", "success");
      setAdding(false); setEditing(null);
      load();
    } catch (e) { showToast?.(e.message, "error"); }
    finally { setSaving(false); }
  };

  const del = (id, dateStr) => {
    showConfirm?.(`Delete oil change on ${dateStr}?`, async () => {
      await fetch(`${API}/${vehicleId}/oil/${id}`, { method: "DELETE" });
      showToast?.("Deleted", "success"); load();
    });
  };

  const oilStatus = summary?.oil_status;
  const oilDetail = summary?.oil_detail;

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={sectionHead}>
        <span>
          Oil changes
          {oilStatus && <span style={{ marginLeft: 8 }}><Badge status={oilStatus} text={oilDetail} /></span>}
        </span>
        {!adding && !editing && (
          <button style={{ ...btnSecondary, padding: "4px 10px" }} onClick={() => setAdding(true)}>+ Log</button>
        )}
      </div>
      {adding && <OilForm onSave={save} onCancel={() => setAdding(false)} saving={saving} />}
      {loading ? (
        <div style={{ padding: "1rem", fontSize: 12, color: "var(--text-tertiary,#666)" }}>Loading…</div>
      ) : records.length === 0 && !adding ? (
        <div style={{ padding: "1rem", fontSize: 12, color: "var(--text-tertiary,#666)", textAlign: "center" }}>No oil changes logged yet.</div>
      ) : (
        records.map(r => (
          editing?.id === r.id ? (
            <OilForm key={r.id} initial={editing} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
          ) : (
            <div key={r.id} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500 }}>{r.date} <span style={{ fontWeight: 400, color: "var(--text-secondary,#aaa)" }}>@ {fmt(r.odometer)} mi</span></div>
                {r.oil_type    && <div style={{ fontSize: 11, color: "var(--text-tertiary,#888)", marginTop: 2 }}>{r.oil_type}{r.filter_brand ? ` · ${r.filter_brand}` : ""}</div>}
                {(r.next_due_date || r.next_due_miles) && (
                  <div style={{ fontSize: 11, color: "var(--text-tertiary,#888)", marginTop: 2 }}>
                    Next: {r.next_due_date || ""}
                    {r.next_due_date && r.next_due_miles ? " or " : ""}
                    {r.next_due_miles ? `${fmt(r.next_due_miles)} mi` : ""}
                  </div>
                )}
                {r.notes && <div style={{ fontSize: 11, color: "var(--text-tertiary,#666)", marginTop: 2 }}>{r.notes}</div>}
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button style={{ ...btnSecondary, padding: "3px 8px", fontSize: 10 }} onClick={() => setEditing(r)}>Edit</button>
                <button style={{ ...btnDanger, padding: "3px 8px", fontSize: 10 }} onClick={() => del(r.id, r.date)}>×</button>
              </div>
            </div>
          )
        ))
      )}
    </div>
  );
}

// ── tire panel ─────────────────────────────────────────────────────────────
function TirePanel({ vehicleId, summary, showToast, showConfirm }) {
  const [tires,   setTires]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding,  setAdding]  = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`${API}/${vehicleId}/tires`);
    setTires(await r.json());
    setLoading(false);
  }, [vehicleId]);
  useEffect(() => { load(); }, [load]);

  const save = async (f) => {
    setSaving(true);
    try {
      const url  = editing ? `${API}/${vehicleId}/tires/${editing.id}` : `${API}/${vehicleId}/tires`;
      const meth = editing ? "PATCH" : "POST";
      const body = {
        ...f,
        installed_miles:         parseFloat(f.installed_miles)         || null,
        tread_depth:             parseFloat(f.tread_depth)             || null,
        rotation_interval_miles: parseFloat(f.rotation_interval_miles) || null,
        next_rotation_miles:     parseFloat(f.next_rotation_miles)     || null,
        installed_date:          f.installed_date || null,
      };
      const res = await fetch(url, { method: meth, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Save failed");
      showToast?.("Tire saved", "success");
      setAdding(false); setEditing(null);
      load();
    } catch (e) { showToast?.(e.message, "error"); }
    finally { setSaving(false); }
  };

  const del = (id, pos) => {
    showConfirm?.(`Delete ${POSITION_LABELS[pos] || pos} tire?`, async () => {
      await fetch(`${API}/${vehicleId}/tires/${id}`, { method: "DELETE" });
      showToast?.("Deleted", "success"); load();
    });
  };

  const tireMap = {};
  tires.forEach(t => { tireMap[t.position] = t; });
  const rotStatus = summary?.rotation_status;
  const rotDetail = summary?.rotation_detail;

  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={sectionHead}>
        <span>
          Tires
          {rotStatus && <span style={{ marginLeft: 8 }}><Badge status={rotStatus} text={rotDetail} /></span>}
        </span>
        {!adding && !editing && (
          <button style={{ ...btnSecondary, padding: "4px 10px" }} onClick={() => setAdding(true)}>+ Add</button>
        )}
      </div>

      {adding && <TireForm onSave={save} onCancel={() => setAdding(false)} saving={saving} />}

      {loading ? (
        <div style={{ padding: "1rem", fontSize: 12, color: "var(--text-tertiary,#666)" }}>Loading…</div>
      ) : (
        <>
          {/* axle diagram */}
          <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {["FL","FR","RL","RR"].map(pos => {
              const t = tireMap[pos];
              return (
                <div key={pos} style={{ background: "var(--bg-tertiary,#1a1a1a)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 8, padding: "10px 12px", minHeight: 72 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" }}>{POSITION_LABELS[pos]}</span>
                    {t ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button style={{ ...btnSecondary, padding: "2px 6px", fontSize: 9 }} onClick={() => setEditing(t)}>Edit</button>
                        <button style={{ ...btnDanger, padding: "2px 6px", fontSize: 9 }} onClick={() => del(t.id, pos)}>×</button>
                      </div>
                    ) : (
                      <button style={{ ...btnSecondary, padding: "2px 6px", fontSize: 9 }} onClick={() => { setAdding(false); setEditing(null); setAdding(pos); }}>+ Add</button>
                    )}
                  </div>
                  {t ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{t.brand || "—"} {t.model || ""}</div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary,#888)" }}>{t.size || "no size"}{t.tread_depth != null ? ` · ${t.tread_depth}/32"` : ""}</div>
                      {t.next_rotation_miles && (
                        <div style={{ fontSize: 10, color: "var(--text-tertiary,#666)", marginTop: 2 }}>Rotation @ {fmt(t.next_rotation_miles)} mi</div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: "var(--text-tertiary,#555)" }}>No tire logged</div>
                  )}
                </div>
              );
            })}
          </div>
          {/* spare row */}
          {tireMap["spare"] ? (
            <div style={{ margin: "0 16px 12px", background: "var(--bg-tertiary,#1a1a1a)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" }}>Spare</span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button style={{ ...btnSecondary, padding: "2px 6px", fontSize: 9 }} onClick={() => setEditing(tireMap["spare"])}>Edit</button>
                  <button style={{ ...btnDanger, padding: "2px 6px", fontSize: 9 }} onClick={() => del(tireMap["spare"].id, "spare")}>×</button>
                </div>
              </div>
              <div style={{ fontSize: 12 }}>{tireMap["spare"].brand || "—"} {tireMap["spare"].model || ""} <span style={{ color: "var(--text-tertiary,#888)", fontSize: 11 }}>{tireMap["spare"].size || ""}</span></div>
            </div>
          ) : null}
        </>
      )}

      {editing && <TireForm initial={editing} onSave={save} onCancel={() => setEditing(null)} saving={saving} />}
    </div>
  );
}

// ── vehicle card ───────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onDeleted, showToast, showConfirm }) {
  const [expanded, setExpanded] = useState(false);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [summary,  setSummary]  = useState(null);

  const loadSummary = useCallback(async () => {
    const r = await fetch(`${API}/${vehicle.id}/summary`);
    if (r.ok) setSummary(await r.json());
  }, [vehicle.id]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const saveVehicle = async (f) => {
    setSaving(true);
    try {
      const former = f.status === "former";
      const payload = {
        ...f,
        year: parseInt(f.year) || null,
        status: f.status || "active",
        // only persist disposition fields when the car is former; null them out otherwise
        disposed_date:    former ? (f.disposed_date || null) : null,
        disposed_price:   former ? (parseFloat(f.disposed_price)   || null) : null,
        disposed_mileage: former ? (parseFloat(f.disposed_mileage) || null) : null,
        disposed_to:      former ? (f.disposed_to || null) : null,
        disposed_note:    former ? (f.disposed_note || null) : null,
      };
      const res = await fetch(`${API}/${vehicle.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      showToast?.("Vehicle updated", "success");
      setEditing(false);
      onDeleted(); // triggers parent reload
    } catch (e) { showToast?.(e.message, "error"); }
    finally { setSaving(false); }
  };

  const del = () => {
    showConfirm?.(`Delete ${vehicle.nickname || vehicle.make || "this vehicle"}? All fill-up records will be unlinked.`, async () => {
      await fetch(`${API}/${vehicle.id}`, { method: "DELETE" });
      showToast?.("Vehicle deleted", "success");
      onDeleted();
    });
  };

  const displayName = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.nickname || "Unnamed vehicle";
  const oilStatus  = summary?.oil_status;
  const rotStatus  = summary?.rotation_status;
  const isFormer   = vehicle.status === "former";

  return (
    <div style={{ ...card, marginBottom: 12, opacity: isFormer ? 0.62 : 1, borderLeft: vehicle.color ? `3px solid ${vehicle.color}` : card.border }}>
      {/* header row */}
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => !editing && setExpanded(e => !e)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {vehicle.nickname && <span style={{ color: "var(--text-primary,#e8e6e0)" }}>{vehicle.nickname}</span>}
            {vehicle.nickname && <span style={{ color: "var(--text-tertiary,#666)", fontSize: 12 }}>·</span>}
            <span style={{ color: vehicle.nickname ? "var(--text-secondary,#aaa)" : "var(--text-primary,#e8e6e0)" }}>{displayName}</span>
            {isFormer && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "var(--bg-tertiary,#222)", color: "var(--text-tertiary,#888)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>Former</span>}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
            {vehicle.plate && <span style={{ fontSize: 10, color: "var(--text-tertiary,#666)", fontFamily: "monospace" }}>{vehicle.plate}</span>}
            {summary?.current_miles != null && <span style={{ fontSize: 10, color: "var(--text-tertiary,#666)" }}>{Math.round(summary.current_miles).toLocaleString()} mi</span>}
            {/* maintenance badges only matter for active cars */}
            {!isFormer && oilStatus  && <Badge status={oilStatus}  text={`Oil: ${summary.oil_detail}`} />}
            {!isFormer && rotStatus  && <Badge status={rotStatus}  text={`Rotation: ${summary.rotation_detail}`} />}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button style={{ ...btnSecondary, padding: "4px 10px" }} onClick={() => { setEditing(e => !e); setExpanded(true); }}>
            {editing ? "Cancel" : "Edit"}
          </button>
          <button style={{ ...btnDanger, padding: "4px 8px" }} onClick={del}>×</button>
        </div>
        <span style={{ color: "var(--text-tertiary,#555)", fontSize: 12, userSelect: "none" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {editing && (
        <div style={{ borderTop: "1px solid var(--border-color,#2a2a2a)" }}>
          <VehicleForm initial={vehicle} onSave={saveVehicle} onCancel={() => setEditing(false)} saving={saving} />
        </div>
      )}

      {expanded && !editing && (
        <div style={{ borderTop: "1px solid var(--border-color,#2a2a2a)", padding: "12px 16px" }}>
          {!isFormer && vehicle.vin && (
            <div style={{ marginBottom: 12 }}>
              <span style={{ ...label, marginRight: 8 }}>VIN</span>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary,#aaa)" }}>{vehicle.vin}</span>
            </div>
          )}

          {/* former cars hide maintenance (#38) — still show the car's basic
              details so the record isn't just a disposition (#61) */}
          {isFormer && (
            <div style={{ ...card, marginBottom: 12 }}>
              <div style={sectionHead}><span>Vehicle</span></div>
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "10px 14px" }}>
                {[
                  { k: "Year",  v: vehicle.year  || "—" },
                  { k: "Make",  v: vehicle.make  || "—" },
                  { k: "Model", v: vehicle.model || "—" },
                  { k: "Trim",  v: vehicle.trim  || "—" },
                  { k: "Plate", v: vehicle.plate || "—" },
                  { k: "VIN",   v: vehicle.vin   || "—" },
                ].map(s => (
                  <div key={s.k}>
                    <div style={{ ...label, marginBottom: 2 }}>{s.k}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary,#ccc)", fontFamily: s.k === "VIN" ? "monospace" : undefined, wordBreak: "break-all" }}>{s.v}</div>
                  </div>
                ))}
                {vehicle.notes && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ ...label, marginBottom: 2 }}>Notes</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary,#999)" }}>{vehicle.notes}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isFormer && (
            <div style={{ ...card, marginBottom: 12, background: "var(--bg-tertiary,#1a1a1a)" }}>
              <div style={sectionHead}><span>No longer owned</span></div>
              <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "10px 14px" }}>
                {[
                  { k: "Date sold/disposed", v: vehicle.disposed_date || "—" },
                  { k: "Sale price",         v: vehicle.disposed_price != null ? "$" + Number(vehicle.disposed_price).toLocaleString() : "—" },
                  { k: "Final mileage",      v: vehicle.disposed_mileage != null ? Math.round(vehicle.disposed_mileage).toLocaleString() + " mi" : "—" },
                  { k: "Sold/given to",      v: vehicle.disposed_to || "—" },
                ].map(s => (
                  <div key={s.k}>
                    <div style={{ ...label, marginBottom: 2 }}>{s.k}</div>
                    <div style={{ fontSize: 13, color: "var(--text-secondary,#ccc)" }}>{s.v}</div>
                  </div>
                ))}
                {vehicle.disposed_note && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ ...label, marginBottom: 2 }}>Note</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary,#999)" }}>{vehicle.disposed_note}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* maintenance is hidden for former vehicles — only the disposition
              summary above is shown for a car you no longer own (#38) */}
          {!isFormer && (
            <>
              <OilPanel vehicleId={vehicle.id} summary={summary} showToast={showToast} showConfirm={showConfirm} />
              <TirePanel vehicleId={vehicle.id} summary={summary} showToast={showToast} showConfirm={showConfirm} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────
// thrive has no toast/confirm context, so fall back to lightweight
// defaults: toasts become no-ops, confirms use the native dialog. These resolved
// helpers are threaded down to every child (cards, panels, the MPG tab).
export default function VehiclesPage({ showToast: _showToast, showConfirm: _showConfirm }) {
  const showToast   = _showToast   || (() => {});
  const showConfirm = _showConfirm || ((msg, onYes) => { if (window.confirm(msg)) onYes(); });
  const [vehicles, setVehicles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [adding,   setAdding]   = useState(false);
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(API);
      setVehicles(await r.json());
    } catch { showToast?.("Failed to load vehicles", "error"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const addVehicle = async (f) => {
    setSaving(true);
    try {
      const former = f.status === "former";
      const res = await fetch(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...f,
          year: parseInt(f.year) || null,
          status: f.status || "active",
          disposed_date:    former ? (f.disposed_date || null) : null,
          disposed_price:   former ? (parseFloat(f.disposed_price)   || null) : null,
          disposed_mileage: former ? (parseFloat(f.disposed_mileage) || null) : null,
          disposed_to:      former ? (f.disposed_to || null) : null,
          disposed_note:    former ? (f.disposed_note || null) : null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      showToast?.("Vehicle added", "success");
      setAdding(false);
      load();
    } catch (e) { showToast?.(e.message, "error"); }
    finally { setSaving(false); }
  };

  // drag-to-reorder (#37): the order is your ownership order. Reorder within a
  // group (active / former); persist the new order to the server.
  const dragIndex = useRef(null);
  const onDrop = (toIdx) => (e) => {
    e.preventDefault();
    const from = dragIndex.current;
    dragIndex.current = null;
    if (from == null || from === toIdx) return;
    if (vehicles[from]?.status !== vehicles[toIdx]?.status) return;   // within a group only
    const next = [...vehicles];
    const [moved] = next.splice(from, 1);
    next.splice(toIdx, 0, moved);
    setVehicles(next);
    fetch(`${API}/order`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: next.map(x => x.id) }),
    }).catch(() => showToast?.("Couldn't save order", "error"));
  };

  return (
    <div style={{ padding: "1.5rem 1.5rem 3rem", maxWidth: 700, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>Garage</h1>
          <p style={{ fontSize: 12, color: "var(--text-tertiary,#888)", marginTop: 4 }}>Oil changes, tires, maintenance — active & former</p>
        </div>
        {!adding && (
          <button style={btnPrimary} onClick={() => setAdding(true)}>+ Add vehicle</button>
        )}
      </div>

      {adding && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={sectionHead}><span>New vehicle</span></div>
          <VehicleForm onSave={addVehicle} onCancel={() => setAdding(false)} saving={saving} />
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary,#888)" }}>Loading…</div>
      ) : vehicles.length === 0 && !adding ? (
        <div style={{ textAlign: "center", padding: "3rem 0", fontSize: 13, color: "var(--text-tertiary,#666)", lineHeight: 1.8 }}>
          No vehicles yet.<br />Add one to start tracking oil changes and tires.
        </div>
      ) : (
        vehicles.map((v, i) => {
          // insert a divider header when transitioning from active to former
          const prev = vehicles[i - 1];
          const showFormerHeader = v.status === "former" && (!prev || prev.status !== "former");
          return (
            <div key={v.id} onDragOver={(e) => e.preventDefault()} onDrop={onDrop(i)}>
              {showFormerHeader && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 2px 12px" }}>
                  <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-tertiary,#666)" }}>Former vehicles</span>
                  <div style={{ flex: 1, height: 1, background: "var(--border-color,#2a2a2a)" }} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                <div draggable
                  onDragStart={() => { dragIndex.current = i; }}
                  onDragEnd={() => { dragIndex.current = null; }}
                  title="Drag to reorder (your ownership order)"
                  style={{ cursor: "grab", color: "var(--text-tertiary,#555)", fontSize: 16, lineHeight: 1, padding: "14px 2px 0", userSelect: "none", flexShrink: 0 }}>⠿</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <VehicleCard vehicle={v} onDeleted={load} showToast={showToast} showConfirm={showConfirm} />
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}