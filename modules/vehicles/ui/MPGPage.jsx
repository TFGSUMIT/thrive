import { useState, useEffect, useRef, useCallback } from "react";
import ReactCrop, { centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import exifr from "exifr";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API     = "/api/mpg";
const VEH_API = "/api/vehicles";
const LM      = "/api/lmstudio";   // vision lives in the LM Studio module now

// Domain prompts sent to the generic /api/lmstudio/vision endpoint. They tell the
// model exactly what JSON to return; the response comes back as { result, ... }.
const ODOMETER_PROMPT =
  "This image shows a car's dashboard with the odometer mileage display.\n" +
  "Read the exact total mileage number shown, including any leading zeros.\n" +
  "Many dashboards also show the current date and/or time — if a date is " +
  "visible anywhere in the image, read it too and return it in YYYY-MM-DD format.\n" +
  "Respond ONLY with a JSON object. No markdown, no explanation.\n" +
  'Example: {"odometer_miles": 56197, "date": "2026-05-28", "confidence": "high"}\n' +
  "confidence is high, medium, or low based on how clearly you can read the mileage.\n" +
  "If no date is visible, set date to null.\n" +
  'If you cannot read the mileage, return: {"odometer_miles": null, "date": null, "confidence": "low"}';

function numberPrompt(kind) {
  const [desc, ex] =
    kind === "money"  ? ["a total fuel SALE amount in dollars (the dollars charged)", '{"value": 78.14, "confidence": "high"}']
    : kind === "volume" ? ["a fuel volume in GALLONS, usually with up to 3 decimal places", '{"value": 16.015, "confidence": "high"}']
    : ["a single number", '{"value": 123.45, "confidence": "high"}'];
  return (
    `This cropped image shows ${desc} on a seven-segment LCD display.\n` +
    "There is only ONE number in this crop. Read every digit carefully, " +
    "including any digits after the decimal point. The display may have glare.\n" +
    "Respond ONLY with a JSON object. No markdown, no explanation.\n" +
    `Example: ${ex}\n` +
    "confidence is high, medium, or low based on how clearly you can read it.\n" +
    'If you cannot read it, return: {"value": null, "confidence": "low"}'
  );
}

const fmt = (n, dec = 1) => (n == null ? "—" : Number(n).toFixed(dec));
const fmtDollar = (n, dec = 2) => (n == null ? "—" : "$" + Number(n).toFixed(dec));
function today() { return new Date().toISOString().slice(0, 10); }

const GLOBAL_STYLES = `@keyframes spin { to { transform: rotate(360deg); } }`;

// Real Leaflet map rendered into the page (not an iframe), so tiles load in the
// normal page context. Zoom + scroll, a road/satellite layer switcher, and a
// scale bar so you can gauge distance. Uses a circleMarker to dodge Leaflet's
// broken default-icon paths under bundlers.
function MiniMap({ lat, lng }) {
  const elRef  = useRef(null);
  const mapRef = useRef(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    if (el._leaflet_id) { el._leaflet_id = null; }

    let map;
    try {
      map = L.map(el, { scrollWheelZoom: true }).setView([lat, lng], 16);
      mapRef.current = map;
      const road = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
      const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Imagery &copy; Esri" });
      road.addTo(map);
      L.control.layers({ Road: road, Satellite: sat }, null, { position: "topright" }).addTo(map);
      L.control.scale({ imperial: true, metric: true }).addTo(map);
      L.circleMarker([lat, lng], { radius: 7, color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.9, weight: 2 }).addTo(map);
      console.log("[MPG] MiniMap initialized at", lat, lng);
    } catch (err) {
      console.error("[MPG] MiniMap init failed:", err);
      return;
    }

    // invalidateSize twice — the container often has 0 height on first paint
    // inside a flex column, which is the classic "Leaflet renders blank" cause
    const t1 = setTimeout(() => { try { map.invalidateSize(); } catch {} }, 100);
    const t2 = setTimeout(() => { try { map.invalidateSize(); } catch {} }, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); try { map.remove(); } catch {} mapRef.current = null; };
  }, [lat, lng]);
  return <div ref={elRef} style={{ height: 200, minHeight: 200, width: "100%", background: "#1a1a1a" }} />;
}

function cropToBase64(imgEl, cropPx, maxDim = 1024) {
  const scaleX = imgEl.naturalWidth  / imgEl.width;
  const scaleY = imgEl.naturalHeight / imgEl.height;
  let cw = cropPx.width  * scaleX;
  let ch = cropPx.height * scaleY;
  const sx = cropPx.x * scaleX;
  const sy = cropPx.y * scaleY;
  let tw = cw, th = ch;
  if (Math.max(cw, ch) > maxDim) {
    const r = maxDim / Math.max(cw, ch);
    tw = Math.round(cw * r); th = Math.round(ch * r);
  }
  const canvas = document.createElement("canvas");
  canvas.width = tw; canvas.height = th;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(imgEl, sx, sy, cw, ch, 0, 0, tw, th);
  return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
}

// ── crop modal ─────────────────────────────────────────────────────────────
function CropModal({ title, instruction, accent = "#e8e6e0", confirmLabel, src, onCancel, onConfirm }) {
  const imgRef = useRef(null);
  const [crop, setCrop]           = useState();
  const [completed, setCompleted] = useState(null);

  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    setCrop(centerCrop(makeAspectCrop({ unit: "%", width: 45 }, 16 / 6, width, height), width, height));
  };

  const confirm = () => {
    if (!imgRef.current || !completed?.width) return;
    onConfirm(cropToBase64(imgRef.current, completed));
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
         onClick={onCancel}>
      {/* tint the crop selection box + handles with the step's accent color */}
      <style>{`
        .rc-active .ReactCrop__crop-selection { border: 2px solid ${accent}; box-shadow: 0 0 0 9999em rgba(0,0,0,0.55); }
        .rc-active .ReactCrop__drag-handle::after { background-color: ${accent}; border: 1px solid #fff; }
      `}</style>
      <div style={{ background: "var(--bg-secondary,#181818)", border: `1px solid var(--border-color,#2a2a2a)`, borderTop: `3px solid ${accent}`, borderRadius: 12, padding: 16, maxWidth: 720, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
           onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: accent, marginBottom: 4, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary,#aaa)", marginBottom: 12 }}>{instruction || "Drag a box around just the numbers, then extract."}</div>
        <div style={{ overflow: "auto", flex: 1, display: "flex", justifyContent: "center", background: "#0a0a0a", borderRadius: 8 }}>
          <ReactCrop className="rc-active" crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompleted(c)}>
            <img ref={imgRef} src={src} onLoad={onImageLoad} alt="crop" style={{ maxHeight: "60vh", display: "block" }} />
          </ReactCrop>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button onClick={onCancel}
            style={{ padding: "8px 16px", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "var(--text-secondary,#aaa)", cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={confirm} disabled={!completed?.width}
            style={{ padding: "8px 16px", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: accent, border: "none", borderRadius: 6, color: "#0f0f0f", fontWeight: 600, cursor: completed?.width ? "pointer" : "not-allowed", opacity: completed?.width ? 1 : 0.5 }}>
            {completed?.width ? (confirmLabel || "✦ Extract this area") : "Draw a box first"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── chart ──────────────────────────────────────────────────────────────────
export function MpgChart({ entries }) {
  const canvasRef = useRef(null);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.parentElement.clientWidth;
    const H   = 140;
    canvas.width  = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, W, H);
    const valid = entries.filter(e => e.mpg != null);
    if (valid.length < 2) {
      ctx.fillStyle = "var(--text-tertiary,#888)"; ctx.font = "12px monospace"; ctx.textAlign = "center";
      ctx.fillText("Add 2+ fill-ups to see chart", W / 2, H / 2 + 4); return;
    }
    const vals = valid.map(e => e.mpg);
    const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
    const minV = Math.min(...vals); const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const pad = { l: 38, r: 12, t: 14, b: 24 };
    const cw = W - pad.l - pad.r; const ch = H - pad.t - pad.b; const mg = ch * 0.08;
    const s = getComputedStyle(document.documentElement);
    const green = s.getPropertyValue("--color-success") || "#22c55e";
    const red   = s.getPropertyValue("--color-danger")  || "#ef4444";
    const blue  = s.getPropertyValue("--color-info")    || "#3b82f6";
    const muted = s.getPropertyValue("--text-tertiary") || "#666";
    const grid  = s.getPropertyValue("--border-color")  || "#2a2a2a";
    ctx.strokeStyle = grid; ctx.lineWidth = 0.5;
    [0, 0.5, 1].forEach(f => { const y = pad.t + f * ch; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke(); });
    const ay = pad.t + ch - ((avg - minV) / range) * (ch - mg * 2) - mg;
    ctx.setLineDash([3, 4]); ctx.strokeStyle = green; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, ay); ctx.lineTo(pad.l + cw, ay); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = green; ctx.font = "10px monospace"; ctx.textAlign = "left";
    ctx.fillText("avg " + avg.toFixed(1), pad.l + 4, ay - 3);
    const pts = vals.map((v, i) => ({ x: pad.l + (i / Math.max(vals.length - 1, 1)) * cw, y: pad.t + ch - ((v - minV) / range) * (ch - mg * 2) - mg }));
    ctx.fillStyle = "rgba(59,130,246,0.07)";
    ctx.beginPath(); ctx.moveTo(pts[0].x, pad.t + ch);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, pad.t + ch); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = blue; ctx.lineWidth = 1.5; ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))); ctx.stroke();
    pts.forEach((p, i) => { ctx.fillStyle = vals[i] >= avg ? green : red; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = muted; ctx.font = "10px monospace"; ctx.textAlign = "right";
    ctx.fillText(maxV.toFixed(0), pad.l - 5, pad.t + mg + 4);
    ctx.fillText(minV.toFixed(0), pad.l - 5, pad.t + ch - mg + 4);
    ctx.textAlign = "center";
    const idxs = valid.length <= 3 ? valid.map((_, i) => i) : [0, Math.floor((valid.length - 1) / 2), valid.length - 1];
    idxs.forEach(i => ctx.fillText(valid[i].date.slice(5), pts[i].x, H - 4));
  }, [entries]);
  useEffect(() => { draw(); window.addEventListener("resize", draw); return () => window.removeEventListener("resize", draw); }, [draw]);
  return <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />;
}

// ── photo button ───────────────────────────────────────────────────────────
function PhotoButton({ label, hint, thumb, busy, status, statusType, onPick, canRetry, onRetry }) {
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const color = statusType === "ok" ? "var(--color-success,#22c55e)"
    : statusType === "warn" ? "#f59e0b"
    : statusType === "err" ? "var(--color-danger,#ef4444)"
    : "var(--text-tertiary,#888)";
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" }}>{label}</span>
        {canRetry && !busy && (
          <button
            onClick={onRetry}
            title="Re-run extraction with the current model"
            style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 5, color: "var(--text-secondary,#aaa)", padding: "2px 8px", cursor: "pointer" }}>
            ↻ Retry
          </button>
        )}
      </div>
      <div
        onClick={() => !busy && fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && e.dataTransfer.files[0]) onPick(e.dataTransfer.files[0]); }}
        style={{ position: "relative", border: `1px dashed var(--border-color,${dragging ? "#666" : "#333"})`, borderRadius: 6, padding: "12px", textAlign: "center", cursor: busy ? "wait" : "pointer", marginBottom: status ? 4 : 0, background: dragging ? "var(--bg-tertiary,#222)" : "transparent" }}>
        {thumb
          ? <img src={thumb} alt="" style={{ width: "100%", maxHeight: 90, objectFit: "contain", borderRadius: 4, opacity: busy ? 0.4 : 1 }} />
          : <><div style={{ fontSize: 18, marginBottom: 4, opacity: 0.3 }}>📷</div>
              <p style={{ fontSize: 11, color: "var(--text-secondary,#aaa)", margin: "0 0 1px" }}>Drop or click</p>
              <small style={{ fontSize: 10, color: "var(--text-tertiary,#666)" }}>{hint}</small></>}
        {busy && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 16, height: 16, border: "2px solid #555", borderTopColor: "#ccc", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
            <span style={{ fontSize: 11, color: "var(--text-secondary,#aaa)" }}>Reading…</span>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) onPick(e.target.files[0]); e.target.value = ""; }} />
      {status && <div style={{ fontSize: 10, textAlign: "center", color, marginTop: 4 }}>{status}</div>}
    </div>
  );
}

// ── main page ──────────────────────────────────────────────────────────────
export default function MPGPage({ showToast, showConfirm }) {
  const [entries,   setEntries]   = useState([]);
  const [stats,     setStats]     = useState({});
  const [loading,   setLoading]   = useState(true);
  const [submitting,setSubmitting]= useState(false);

  const [expandedId, setExpandedId] = useState(null);  // which history row is open
  const [editing,    setEditing]    = useState(null);  // {id, ...fields} when editing a row
  const [savingEdit, setSavingEdit] = useState(false);

  const [vehicles,       setVehicles]       = useState([]);
  const [activeVehicle,  setActiveVehicle]  = useState("");   // "" = all / unlinked

  const [form, setForm] = useState({ date: today(), odometer: "", gallons: "", total: "", ppg: "", station: "", notes: "" });
  const [gps,  setGps]  = useState(null);

  const [cropStep, setCropStep] = useState(null);  // null | "odometer" | "pump-sale" | "pump-gallons"
  const [cropSrc,  setCropSrc]  = useState(null);

  const [visionModels, setVisionModels] = useState([]);
  const [activeModel,  setActiveModel]  = useState("");
  const [modelHost,    setModelHost]    = useState("");
  const [modelLoading, setModelLoading] = useState(false);  // loading a model on the host
  const [modelStats,   setModelStats]   = useState({});  // { [model]: {success, fail, total, rate} }
  const [entryImages,  setEntryImages]  = useState({});  // { [entryId]: [{kind, b64}] } — lazy-loaded on expand

  const [odoThumb,   setOdoThumb]   = useState(null); const [odoBusy,   setOdoBusy]   = useState(false);
  const [odoStatus,  setOdoStatus]  = useState("");   const [odoType,   setOdoType]   = useState("");
  const [pumpThumb,  setPumpThumb]  = useState(null); const [pumpBusy,  setPumpBusy]  = useState(false);
  const [pumpStatus, setPumpStatus] = useState("");   const [pumpType,  setPumpType]  = useState("");

  // cached cropped base64, so we can re-run extraction (e.g. after a model switch)
  // without re-uploading / re-cropping. Pump now caches two crops (sale + gallons).
  const [odoB64,         setOdoB64]         = useState(null);
  const [pumpSaleB64,    setPumpSaleB64]    = useState(null);
  const [pumpGallonsB64, setPumpGallonsB64] = useState(null);

  const [nearby,    setNearby]    = useState([]);   // [{name, brand, dist_m, ...}]
  const [nearbyBusy,setNearbyBusy]= useState(false);
  const [nearbyErr, setNearbyErr] = useState(null);

  // fetch vehicles once
  useEffect(() => {
    fetch(VEH_API).then(r => r.json()).then(v => setVehicles(Array.isArray(v) ? v : [])).catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const vq = activeVehicle ? `?vehicle_id=${activeVehicle}` : "";
      const [eRes, sRes] = await Promise.all([fetch(API + vq), fetch(API + "/stats" + vq)]);
      const e = await eRes.json();
      setEntries(Array.isArray(e) ? e : []);
      setStats(await sRes.json());
    } catch { showToast?.("Failed to load MPG data", "error"); }
    finally { setLoading(false); }
  }, [showToast, activeVehicle]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // when GPS is captured from a photo, look up nearby fuel stations
  useEffect(() => {
    if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) {
      setNearby([]); setNearbyErr(null); return;
    }
    let cancelled = false;
    setNearbyBusy(true); setNearbyErr(null);
    fetch(`${API}/nearby?lat=${gps.lat}&lng=${gps.lng}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setNearby(Array.isArray(d.stations) ? d.stations : []);
        setNearbyErr(d.error || null);
      })
      .catch(() => { if (!cancelled) setNearbyErr("request failed"); })
      .finally(() => { if (!cancelled) setNearbyBusy(false); });
    return () => { cancelled = true; };
  }, [gps]);

  const loadModels = useCallback(async () => {
    try {
      // /status (and /config) 404 when the LM Studio module isn't installed/enabled
      const [stRes, cfgRes] = await Promise.all([fetch(LM + "/status"), fetch(LM + "/config")]);
      if (!stRes.ok) { setVisionModels([]); setModelHost(""); return; }
      const st  = await stRes.json();
      const cfg = cfgRes.ok ? await cfgRes.json() : {};
      setModelHost("LM Studio");
      setVisionModels((st.models || []).filter(m => m.vision));
      setActiveModel(cfg.vision_model || st.vision_model || "");
    } catch { setVisionModels([]); setModelHost(""); }
  }, []);
  useEffect(() => { loadModels(); }, [loadModels]);

  // Make a model resident on the host. No-op if it's already loaded; otherwise
  // loads it via the LM Studio module (now that /lmstudio/load exists) and
  // re-probes so the ● loaded marker updates. Big models take a few seconds.
  const ensureLoaded = useCallback(async (id, models) => {
    const m = (models || visionModels).find(v => v.id === id);
    if (!id || !m || m.state === "loaded") return;
    setModelLoading(true);
    try {
      const r = await fetch(LM + "/load", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id, type: m.type }),
      });
      if (!r.ok) { let t = await r.text(); try { t = JSON.parse(t).detail || t; } catch {} throw new Error((t || "").slice(0, 160)); }
      showToast?.(`Loaded ${id}`, "success");
      await loadModels();
    } catch (e) {
      showToast?.(`Couldn't load model: ${e.message}`, "error");
    } finally {
      setModelLoading(false);
    }
  }, [visionModels, loadModels, showToast]);

  // On arrival, if LM Studio is connected with a chosen model but nothing is
  // loaded yet, warm up the default so OCR is ready without a manual step.
  const autoWarmed = useRef(false);
  useEffect(() => {
    if (autoWarmed.current || modelLoading) return;
    if (visionModels.length === 0 || !activeModel) return;
    if (visionModels.some(m => m.state === "loaded")) { autoWarmed.current = true; return; }
    autoWarmed.current = true;
    ensureLoaded(activeModel, visionModels);
  }, [visionModels, activeModel, modelLoading, ensureLoaded]);

  const loadModelStats = useCallback(async () => {
    try {
      const r = await fetch(LM + "/model-stats");
      const d = await r.json();
      const m = {};
      (Array.isArray(d) ? d : []).forEach(s => { m[s.model] = s; });
      setModelStats(m);
    } catch {}
  }, []);
  useEffect(() => { loadModelStats(); }, [loadModelStats]);

  const loadEntryImages = useCallback(async (id) => {
    try {
      const r = await fetch(`${API}/${id}/images`);
      const d = await r.json();
      setEntryImages(m => ({ ...m, [id]: Array.isArray(d) ? d : [] }));
    } catch { setEntryImages(m => ({ ...m, [id]: [] })); }
  }, []);

  const selectModel = async (id) => {
    setActiveModel(id);
    try { await fetch(LM + "/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "vision_model", value: id }) }); } catch {}
    if (id) ensureLoaded(id, visionModels);   // load it on the host if it isn't already
  };

  const pickPhoto = async (zone, file) => {
    // pull EXIF once: GPS (odometer → map) and the capture timestamp (either photo
    // → fill-up date). The photo's own timestamp is far more reliable than OCR'ing
    // a dashboard clock, so this is the primary date source.
    try {
    // run GPS and date extraction in parallel — use the dedicated GPS parser
    // (exifr.gps) which reliably computes lat/lng across all photo formats,
    // and the general parser for the capture timestamp
    const [gpsData, exif] = await Promise.all([
      exifr.gps(file).catch(() => null),
      exifr.parse(file).catch(() => null),
    ]);
    console.log("[MPG] exifr.gps result:", gpsData);
    if (gpsData && Number.isFinite(gpsData.latitude) && Number.isFinite(gpsData.longitude)) {
      setGps({ lat: gpsData.latitude, lng: gpsData.longitude });
    }
    const dt = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) {
      const pad = n => String(n).padStart(2, "0");
      setForm(f => ({ ...f, date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` }));
    }
    } catch {}
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      if (zone === "odometer") setOdoThumb(dataUrl); else setPumpThumb(dataUrl);
      // No vision model? Don't crop/OCR — just keep the photo with the fill-up as
      // a record; the numbers get entered by hand in the form below.
      if (visionModels.length === 0) {
        const b64 = dataUrl.split(",")[1];
        if (zone === "odometer") { pendingImg.current.odometer = b64; setOdoStatus("Photo attached — enter the mileage below"); setOdoType("ok"); }
        else { pendingImg.current.pump = b64; setPumpStatus("Photo attached — enter sale & gallons below"); setPumpType("ok"); }
        return;
      }
      setCropSrc(dataUrl);
      // odometer = single crop; pump = two crops (sale first, then gallons)
      setCropStep(zone === "odometer" ? "odometer" : "pump-sale");
    };
    reader.readAsDataURL(file);
  };

  const cancelCrop = () => { setCropStep(null); setCropSrc(null); };

  const onCropConfirm = async (b64) => {
    const step = cropStep;
    if (step === "odometer") {
      setCropStep(null); setCropSrc(null);
      setOdoB64(b64);
      runOdometer(b64);
    } else if (step === "pump-sale") {
      // kick off the sale read, then advance to the gallons crop on the same image
      setPumpSaleB64(b64);
      setCropStep("pump-gallons");
      runPumpNumber(b64, "money");
    } else if (step === "pump-gallons") {
      setCropStep(null); setCropSrc(null);
      setPumpGallonsB64(b64);
      runPumpNumber(b64, "volume");
    }
  };

  // re-run extraction from cached crops (used by the retry button after a model swap)
  const retryExtract = (zone) => {
    if (zone === "odometer") { if (odoB64) runOdometer(odoB64); return; }
    if (pumpSaleB64)    runPumpNumber(pumpSaleB64, "money");
    if (pumpGallonsB64) runPumpNumber(pumpGallonsB64, "volume");
  };

  // ── per-model scoring (deferred) ───────────────────────────────────────────
  // A read that returns a value is "pending": the model is only credited a
  // success once the user keeps it (logs the fill-up). Re-extracting a field or
  // hand-editing its value reports a fail for the model that produced the prior
  // read. Hard errors / null reads are failed server-side at extraction time.
  const pending = useRef({});   // { odometer|total|gallons : modelId }
  const pendingImg = useRef({}); // { odometer|total|gallons : enhanced b64 } — kept on log

  const reportResult = (model, ok) => {
    if (!model) return;
    fetch(LM + "/model-result", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, ok }),
    }).then(() => loadModelStats()).catch(() => {});
  };
  // a fresh read or a hand-edit supersedes the prior pending read of that field
  const failPending = (field) => {
    const m = pending.current[field];
    if (m) { reportResult(m, false); delete pending.current[field]; }
    // note: the crop itself is NOT dropped here — the photo is a record of what
    // you captured regardless of whether the model read it right. A re-extract
    // overwrites it with the newer crop; a hand-edit keeps it.
  };

  // generic vision call into the LM Studio module: returns { result, enhanced_b64, model }
  async function postVision(prompt, b64) {
    const res = await fetch(`${LM}/vision`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ b64, mime: "image/jpeg", prompt }),
    });
    if (!res.ok) {
      const txt = await res.text();
      let msg = txt;
      try { msg = JSON.parse(txt).detail || txt; } catch {}
      throw new Error((msg || "").slice(0, 200) || `Vision failed (${res.status})`);
    }
    return res.json();
  }

  const runOdometer = async (b64) => {
    failPending("odometer");   // re-reading supersedes any prior pending read
    setOdoBusy(true); setOdoStatus("");
    try {
      const data  = await postVision(ODOMETER_PROMPT, b64);
      const r     = data.result || {};
      const model = data.model || activeModel;
      const conf  = r.confidence || "low";
      // keep the crop whether or not the read succeeded — it's your photo record
      if (data.enhanced_b64) pendingImg.current.odometer = data.enhanced_b64;
      if (r.odometer_miles != null) {
        const datePatch = /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? { date: r.date } : {};
        setForm(f => ({ ...f, odometer: String(r.odometer_miles), ...datePatch }));
        const dateNote = datePatch.date ? ` · ${datePatch.date}` : "";
        setOdoStatus(conf === "low" ? `${r.odometer_miles}${dateNote} — verify` : `${r.odometer_miles}${dateNote} ✓`);
        setOdoType(conf === "low" ? "warn" : "ok");
        pending.current.odometer = model;                // pending until kept
      } else {
        reportResult(model, false);                      // a null read is a miss for this model
        setOdoStatus("Couldn't read — enter manually"); setOdoType("err");
      }
    } catch (e) { setOdoStatus("Error: " + e.message); setOdoType("err"); }
    finally { setOdoBusy(false); loadModelStats(); }
  };

  // extract a single cropped number from the pump — kind "money" (sale) or "volume" (gallons)
  const runPumpNumber = async (b64, kind) => {
    const field = kind === "money" ? "total" : "gallons";
    failPending(field);   // re-reading supersedes any prior pending read
    setPumpBusy(true);
    try {
      const data  = await postVision(numberPrompt(kind), b64);
      const r     = data.result || {};
      const model = data.model || activeModel;
      const conf  = r.confidence || "low";
      // keep the crop whether or not the read succeeded — it's your photo record
      if (data.enhanced_b64) pendingImg.current[field] = data.enhanced_b64;
      if (r.value != null) {
        if (kind === "money") {
          const total = Number(r.value).toFixed(2);
          setForm(f => {
            const next = { ...f, total };
            const g = parseFloat(next.gallons);
            if (g > 0) next.ppg = (parseFloat(total) / g).toFixed(3);
            return next;
          });
          setPumpStatus(conf === "low" ? `Sale $${total} — verify` : `Sale $${total} ✓`);
        } else {
          const gallons = Number(r.value).toFixed(3);
          setForm(f => {
            const next = { ...f, gallons };
            const t = parseFloat(next.total);
            if (parseFloat(gallons) > 0 && t > 0) next.ppg = (t / parseFloat(gallons)).toFixed(3);
            return next;
          });
          setPumpStatus(conf === "low" ? `Gallons ${gallons} — verify` : `Gallons ${gallons} ✓`);
        }
        setPumpType(conf === "low" ? "warn" : "ok");
        pending.current[field] = model;                  // pending until kept
      } else {
        reportResult(model, false);                      // a null read is a miss for this model
        setPumpStatus(`Couldn't read ${kind === "money" ? "sale" : "gallons"} — enter manually`);
        setPumpType("err");
      }
    } catch (e) { setPumpStatus("Error: " + e.message); setPumpType("err"); }
    finally { setPumpBusy(false); loadModelStats(); }
  };

  const updateField = (id, val) => {
    // hand-editing an auto-filled read means that read was wrong → fail its model
    if ((id === "odometer" || id === "total" || id === "gallons") && pending.current[id]) {
      failPending(id);
    }
    setForm(f => {
      const next = { ...f, [id]: val };
      if (id === "total" || id === "gallons") {
        const t = parseFloat(id === "total"   ? val : next.total);
        const g = parseFloat(id === "gallons" ? val : next.gallons);
        if (t > 0 && g > 0) next.ppg = (t / g).toFixed(3);
      }
      return next;
    });
  };

  const addEntry = async () => {
    const odo = parseFloat(form.odometer);
    const gal = parseFloat(form.gallons);
    if (isNaN(odo) || isNaN(gal) || gal <= 0) { showToast?.("Odometer and gallons are required", "error"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date || today(), odometer: odo, gallons: gal,
          total:      parseFloat(form.total)   || null,
          ppg:        parseFloat(form.ppg)     || null,
          station:    form.station             || null,
          notes:      form.notes               || null,
          lat:        gps?.lat                 ?? null,
          lng:        gps?.lng                 ?? null,
          vehicle_id: activeVehicle ? parseInt(activeVehicle) : null,
          images:     Object.keys(pendingImg.current).length ? { ...pendingImg.current } : null,
        }) });
      if (!res.ok) throw new Error("Save failed");
      // the user kept these reads by logging them → credit each model a success
      Object.values(pending.current).forEach(m => reportResult(m, true));
      pending.current = {};
      pendingImg.current = {};
      setForm({ date: today(), odometer: "", gallons: "", total: "", ppg: "", station: "", notes: "" });
      setGps(null);
      setNearby([]);
      setOdoThumb(null); setOdoStatus(""); setPumpThumb(null); setPumpStatus("");
      setOdoB64(null); setPumpSaleB64(null); setPumpGallonsB64(null);
      showToast?.("Fill-up logged", "success");
      fetchAll();
    } catch (e) { showToast?.(e.message, "error"); }
    finally { setSubmitting(false); }
  };

  const deleteEntry = (id, dateStr) => {
    showConfirm?.(`Delete fill-up on ${dateStr}?`, async () => {
      await fetch(`${API}/${id}`, { method: "DELETE" });
      showToast?.("Entry deleted", "success");
      if (expandedId === id) setExpandedId(null);
      fetchAll();
    });
  };

  const startEdit = (e) => {
    setEditing({
      id: e.id,
      date: e.date || today(),
      odometer: e.odometer ?? "",
      gallons: e.gallons ?? "",
      total: e.total ?? "",
      ppg: e.ppg ?? "",
      station: e.station ?? "",
      notes: e.notes ?? "",
      lat: e.lat ?? null,
      lng: e.lng ?? null,
      vehicle_id: e.vehicle_id ?? null,
    });
  };

  const editField = (id, val) => {
    setEditing(p => {
      const next = { ...p, [id]: val };
      if (id === "total" || id === "gallons") {
        const t = parseFloat(id === "total" ? val : next.total);
        const g = parseFloat(id === "gallons" ? val : next.gallons);
        if (t > 0 && g > 0) next.ppg = (t / g).toFixed(3);
      }
      return next;
    });
  };

  const saveEdit = async () => {
    const odo = parseFloat(editing.odometer);
    const gal = parseFloat(editing.gallons);
    if (isNaN(odo) || isNaN(gal) || gal <= 0) { showToast?.("Odometer and gallons are required", "error"); return; }
    setSavingEdit(true);
    try {
      const res = await fetch(`${API}/${editing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: editing.date || today(), odometer: odo, gallons: gal,
          total:      parseFloat(editing.total) || null,
          ppg:        parseFloat(editing.ppg)   || null,
          station:    editing.station           || null,
          notes:      editing.notes             || null,
          lat:        editing.lat               ?? null,
          lng:        editing.lng               ?? null,
          vehicle_id: editing.vehicle_id        ?? null,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      showToast?.("Fill-up updated", "success");
      setEditing(null);
      fetchAll();
    } catch (e) { showToast?.(e.message, "error"); }
    finally { setSavingEdit(false); }
  };

  // LM Studio is an OPTIONAL capability, not a requirement: vision models only
  // appear when the module is installed/enabled and its host advertises a VLM.
  // When it's absent the whole photo/OCR path is hidden and MPG is plain manual
  // entry — no nag, no broken buttons.
  const visionReady = visionModels.length > 0;

  const avg        = stats.avg_mpg;
  const mpgEntries = entries.filter(e => e.mpg != null);
  const avgRecent  = mpgEntries.slice(-3).reduce((a, b) => a + b.mpg, 0) / (mpgEntries.slice(-3).length || 1);
  const trend      = mpgEntries.length >= 4 ? avgRecent - mpgEntries.slice(0, 3).reduce((a, b) => a + b.mpg, 0) / mpgEntries.slice(0, 3).length : null;

  const inputStyle = { fontFamily: "monospace", fontSize: 13, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "inherit", padding: "7px 10px", outline: "none", width: "100%", boxSizing: "border-box" };
  const labelStyle = { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" };

  // vehicle display name helper
  const vehName = (v) => [v.year, v.make, v.model].filter(Boolean).join(" ") || v.nickname || `Vehicle ${v.id}`;

  if (loading) return <div style={{ padding: "2rem", color: "var(--text-secondary,#888)", fontSize: 13 }}>Loading…</div>;

  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      {cropStep && (
        <CropModal
          key={cropStep}
          title={
            cropStep === "odometer"     ? "Crop the odometer"
            : cropStep === "pump-sale"  ? "Step 1 of 2 · Total sale"
            :                             "Step 2 of 2 · Gallons"
          }
          instruction={
            cropStep === "odometer"     ? "Box just the mileage digits, then extract."
            : cropStep === "pump-sale"  ? "Box just the SALE / TOTAL number (the dollars charged), then extract."
            :                             "Now box just the GALLONS number, then extract."
          }
          accent={cropStep === "pump-gallons" ? "#3b82f6" : "#22c55e"}
          confirmLabel={
            cropStep === "odometer"     ? "✦ Read mileage"
            : cropStep === "pump-sale"  ? "✦ Read sale total →"
            :                             "✦ Read gallons"
          }
          src={cropSrc}
          onCancel={cancelCrop}
          onConfirm={onCropConfirm}
        />
      )}

      <div style={{ padding: "1.5rem 1.5rem 3rem", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>MPG Tracker</h1>
            <p style={{ fontSize: 12, color: "var(--text-tertiary,#888)", marginTop: 4 }}>{visionReady ? "Vision-powered fuel log" : "Fuel log"}</p>
          </div>
          {/* vehicle filter pill */}
          {vehicles.length > 0 && (
            <select
              value={activeVehicle}
              onChange={e => setActiveVehicle(e.target.value)}
              style={{ ...inputStyle, width: "auto", fontSize: 11, padding: "5px 10px" }}
            >
              <option value="">All vehicles</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{vehName(v)}</option>)}
            </select>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 20 }}>
          {[
            { label: "Last MPG", value: stats.last_mpg ? <>{fmt(stats.last_mpg)}{trend != null && <span style={{ fontSize: 10, marginLeft: 6, padding: "2px 6px", borderRadius: 4, background: trend >= 0 ? "var(--success-muted)" : "var(--danger-muted)", color: trend >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>{trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}</span>}</> : "—" },
            { label: "Avg MPG",       value: fmt(stats.avg_mpg)           },
            { label: "Total gallons", value: fmt(stats.total_gal)         },
            { label: "Total spent",   value: fmtDollar(stats.total_spent, 0) },
          ].map(s => (
            <div key={s.label} style={{ background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)", marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 500 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* ── new fill-up ── */}
          <div style={{ background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>New fill-up</div>
            <div style={{ padding: 16 }}>

              {/* vehicle selector */}
              {vehicles.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>Vehicle</label>
                  <select
                    value={activeVehicle}
                    onChange={e => setActiveVehicle(e.target.value)}
                    style={{ ...inputStyle, fontSize: 12 }}
                  >
                    <option value="">— unlinked —</option>
                    {vehicles.map(v => <option key={v.id} value={v.id}>{vehName(v)}</option>)}
                  </select>
                </div>
              )}

              {/* vision capture — only when LM Studio is available; otherwise the
                  form below is plain manual entry */}
              {visionReady && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>
                      Vision model {modelHost && <span style={{ opacity: 0.6 }}>· {modelHost}</span>}
                      {modelLoading && <span style={{ opacity: 0.8, marginLeft: 6, color: "var(--color-warning)" }}>· loading…</span>}
                    </label>
                    <select value={activeModel} onChange={e => selectModel(e.target.value)} disabled={modelLoading} style={{ ...inputStyle, fontSize: 12, opacity: modelLoading ? 0.6 : 1 }}>
                      <option value="">— pick a model —</option>
                      {visionModels.map(m => {
                        const s = modelStats[m.id];
                        const tag = s && s.total ? `  ✓${s.success} ✗${s.fail}` : "";
                        return <option key={m.id} value={m.id}>{m.id}{m.state === "loaded" ? " ●" : ""}{tag}</option>;
                      })}
                    </select>
                    {/* track record for the selected model */}
                    {activeModel && modelStats[activeModel]?.total > 0 && (
                      <div style={{ fontSize: 10, color: "var(--text-tertiary,#888)", marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ color: "var(--color-success,#22c55e)" }}>✓ {modelStats[activeModel].success}</span>
                        <span style={{ color: "var(--color-danger,#ef4444)" }}>✗ {modelStats[activeModel].fail}</span>
                        {modelStats[activeModel].rate != null && <span>{Math.round(modelStats[activeModel].rate * 100)}% success</span>}
                      </div>
                    )}
                  </div>
              )}

              {/* photo capture — ALWAYS shown. With a vision model it auto-reads the
                  numbers; without one it just attaches the photo to the fill-up as a
                  record while you enter the values manually below. */}
              <PhotoButton label="Odometer photo" hint={visionReady ? "Dashboard mileage" : "Dashboard mileage · saved with entry"} thumb={odoThumb} busy={odoBusy} status={odoStatus} statusType={odoType} onPick={f => pickPhoto("odometer", f)} canRetry={!!odoB64} onRetry={() => retryExtract("odometer")} />
              <PhotoButton label="Pump photo" hint={visionReady ? "Sale total, then gallons" : "Receipt / pump · saved with entry"} thumb={pumpThumb} busy={pumpBusy} status={pumpStatus} statusType={pumpType} onPick={f => pickPhoto("pump", f)} canRetry={!!(pumpSaleB64 || pumpGallonsB64)} onRetry={() => retryExtract("pump")} />

              {[
                { id: "odometer", label: "Odometer (mi)",              type: "number", step: "1",     placeholder: "56197"  },
                { id: "gallons",  label: "Gallons",                    type: "number", step: "0.001", placeholder: "16.015" },
                { id: "total",    label: "Total ($)",                  type: "number", step: "0.01",  placeholder: "78.14"  },
                { id: "ppg",      label: "Price / gal ($) · auto",     type: "number", step: "0.001", placeholder: "4.879"  },
                { id: "date",     label: "Date",                       type: "date"                                          },
                { id: "station",  label: "Station",                    type: "text",                  placeholder: "e.g. Shell on Main St" },
              ].map(({ id, label: lbl, ...rest }) => (
                <div key={id} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label style={labelStyle}>{lbl}</label>
                    {id === "station" && !gps && typeof navigator !== "undefined" && navigator.geolocation && (
                      <button
                        onClick={() => navigator.geolocation.getCurrentPosition(
                          pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                          () => {}
                        )}
                        style={{ fontSize: 9, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.08em", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 4, color: "var(--text-tertiary,#666)", padding: "2px 7px", cursor: "pointer" }}>
                        📍 use my location
                      </button>
                    )}
                  </div>
                  <input {...rest} value={form[id]} onChange={e => updateField(id, e.target.value)} style={inputStyle} />
                </div>
              ))}

              {/* location block — sits under Station, above Notes */}
              {gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    📍 {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                    {nearbyBusy && <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid #555", borderTopColor: "#ccc", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />}
                  </div>

                  {/* nearby station suggestions */}
                  {nearby.length > 0 ? (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: "var(--text-tertiary,#888)", marginBottom: 4 }}>Nearby stations — tap to use:</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {nearby.map((st, i) => {
                          const active = form.station === st.name;
                          return (
                            <button
                              key={`${st.name}-${i}`}
                              onClick={() => updateField("station", st.name)}
                              title={st.street ? `${st.street} · ${st.dist_m} m away` : `${st.dist_m} m away`}
                              style={{
                                fontSize: 11, fontFamily: "var(--font-body)", padding: "4px 10px", borderRadius: 14, cursor: "pointer",
                                border: `1px solid ${active ? "var(--color-success)" : "var(--border-color,#333)"}`,
                                background: active ? "var(--success-muted)" : "var(--bg-tertiary,#222)",
                                color: active ? "var(--color-success)" : "var(--text-secondary,#aaa)",
                              }}>
                              {st.name}
                              <span style={{ opacity: 0.6, marginLeft: 5, fontSize: 9 }}>{st.dist_m < 1000 ? `${st.dist_m}m` : `${(st.dist_m / 1000).toFixed(1)}km`}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (!nearbyBusy && (
                    <div style={{ fontSize: 10, color: nearbyErr ? "#f59e0b" : "var(--text-tertiary,#666)", marginBottom: 8 }}>
                      {nearbyErr ? `Station lookup failed (${nearbyErr}) — type it manually.` : "No mapped stations nearby — type it manually."}
                    </div>
                  ))}

                  {/* interactive Leaflet map */}
                  <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-color,#2a2a2a)" }}>
                    <MiniMap lat={gps.lat} lng={gps.lng} />
                  </div>
                </div>
              )}

              {/* notes — last field, below the location block */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                <label style={labelStyle}>Notes</label>
                <input type="text" placeholder="Optional" value={form.notes} onChange={e => updateField("notes", e.target.value)} style={inputStyle} />
              </div>

              <button onClick={addEntry} disabled={submitting}
                style={{ width: "100%", padding: 8, fontFamily: "monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--text-primary,#e8e6e0)", border: "none", borderRadius: 6, color: "var(--bg-primary,#0f0f0f)", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 500, opacity: submitting ? 0.5 : 1 }}>
                {submitting ? "Saving…" : "+ Log fill-up"}
              </button>
            </div>
          </div>

          {/* ── trend ── */}
          <div style={{ background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>MPG trend</div>
            <div style={{ padding: "12px 16px 10px" }}><MpgChart entries={entries} /></div>
          </div>

          {/* ── history ── */}
          <div style={{ background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>Fill-up history</div>
            <div style={{ padding: "0 16px" }}>
              {entries.length === 0 ? (
                <div style={{ textAlign: "center", padding: "2rem 0", fontSize: 12, color: "var(--text-tertiary,#666)", lineHeight: 1.8 }}>No fill-ups logged yet.<br/>Add your first entry to get started.</div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "92px 64px 1fr 48px 52px 60px 56px", gap: 6, padding: "8px 0", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" }}>
                    <span>Date</span><span style={{ textAlign: "right" }}>Odo</span><span>Station</span><span style={{ textAlign: "right" }}>MPG</span><span style={{ textAlign: "right" }}>Gal</span><span style={{ textAlign: "right" }}>Total</span><span style={{ textAlign: "right" }}>$/gal</span>
                  </div>
                  {[...entries].reverse().map(e => {
                    const mpgColor = e.mpg == null ? "var(--text-tertiary,#666)" : e.mpg >= (avg || 0) ? "var(--color-success,#22c55e)" : "var(--color-danger,#ef4444)";
                    const ppg = e.ppg != null ? e.ppg : (e.total != null && e.gallons > 0 ? e.total / e.gallons : null);
                    const isOpen = expandedId === e.id;
                    const isEditing = editing?.id === e.id;
                    const hasGps = Number.isFinite(e.lat) && Number.isFinite(e.lng);
                    return (
                      <div key={e.id} style={{ borderBottom: "1px solid var(--border-color,#2a2a2a)" }}>
                        {/* summary row — click to expand */}
                        <div
                          onClick={() => { const open = !isOpen; setExpandedId(open ? e.id : null); setEditing(null); if (open && entryImages[e.id] === undefined) loadEntryImages(e.id); }}
                          style={{ display: "grid", gridTemplateColumns: "92px 64px 1fr 48px 52px 60px 56px", gap: 6, padding: "8px 0", fontSize: 12, alignItems: "center", cursor: "pointer", background: isOpen ? "var(--bg-tertiary,#1e1e1e)" : "transparent" }}>
                          <span style={{ color: "var(--text-secondary,#aaa)" }}>{e.date}</span>
                          <span style={{ textAlign: "right", fontFamily: "monospace", fontSize: 11, color: "var(--text-tertiary,#888)" }} title="Odometer">{e.odometer != null ? Math.round(e.odometer).toLocaleString() : "—"}</span>
                          <span style={{ fontSize: 11, color: "var(--text-tertiary,#888)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={e.station || ""}>{e.station || e.notes || ""}</span>
                          <span style={{ textAlign: "right", fontWeight: 500, fontSize: 13, color: mpgColor }}>{fmt(e.mpg)}</span>
                          <span style={{ textAlign: "right", color: "var(--text-secondary,#aaa)" }}>{fmt(e.gallons, 2)}</span>
                          <span style={{ textAlign: "right", color: "var(--text-secondary,#aaa)" }}>{fmtDollar(e.total)}</span>
                          <span style={{ textAlign: "right", color: "var(--text-tertiary,#888)", fontSize: 11 }}>{ppg != null ? fmtDollar(ppg, 3) : "—"}</span>
                        </div>

                        {/* expanded detail / edit panel */}
                        {isOpen && (
                          <div style={{ padding: "4px 0 14px" }}>
                            {isEditing ? (
                              <div style={{ padding: "8px 4px" }}>
                                {vehicles.length > 0 && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                                    <label style={labelStyle}>Vehicle</label>
                                    <select
                                      value={editing.vehicle_id ?? ""}
                                      onChange={ev => editField("vehicle_id", ev.target.value ? parseInt(ev.target.value) : null)}
                                      style={{ ...inputStyle, fontSize: 12 }}>
                                      <option value="">— unlinked —</option>
                                      {vehicles.map(v => <option key={v.id} value={v.id}>{vehName(v)}</option>)}
                                    </select>
                                  </div>
                                )}
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
                                  {[
                                    { id: "date", label: "Date", type: "date" },
                                    { id: "odometer", label: "Odometer (mi)", type: "number", step: "1" },
                                    { id: "gallons", label: "Gallons", type: "number", step: "0.001" },
                                    { id: "total", label: "Total ($)", type: "number", step: "0.01" },
                                    { id: "ppg", label: "Price / gal ($)", type: "number", step: "0.001" },
                                    { id: "station", label: "Station", type: "text" },
                                  ].map(({ id, label: lbl, ...rest }) => (
                                    <div key={id} style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                                      <label style={labelStyle}>{lbl}</label>
                                      <input {...rest} value={editing[id] ?? ""} onChange={ev => editField(id, ev.target.value)} style={inputStyle} />
                                    </div>
                                  ))}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                                  <label style={labelStyle}>Notes</label>
                                  <input type="text" value={editing.notes ?? ""} onChange={ev => editField("notes", ev.target.value)} style={inputStyle} />
                                </div>
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                  <button onClick={() => setEditing(null)} style={{ padding: "6px 14px", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "var(--text-secondary,#aaa)", cursor: "pointer" }}>Cancel</button>
                                  <button onClick={saveEdit} disabled={savingEdit} style={{ padding: "6px 14px", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "var(--text-primary,#e8e6e0)", border: "none", borderRadius: 6, color: "var(--bg-primary,#0f0f0f)", fontWeight: 600, cursor: savingEdit ? "not-allowed" : "pointer", opacity: savingEdit ? 0.5 : 1 }}>{savingEdit ? "Saving…" : "✦ Save"}</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {/* key stats */}
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, padding: "4px 4px 10px" }}>
                                  {[
                                    { k: "Odometer", v: e.odometer != null ? `${Math.round(e.odometer).toLocaleString()} mi` : "—" },
                                    { k: "Miles this tank", v: e.miles != null ? `${fmt(e.miles, 1)} mi` : "—" },
                                    { k: "MPG", v: fmt(e.mpg) },
                                    { k: "Gallons", v: fmt(e.gallons, 3) },
                                    { k: "Total", v: fmtDollar(e.total) },
                                    { k: "Price / gal", v: ppg != null ? fmtDollar(ppg, 3) : "—" },
                                  ].map(s => (
                                    <div key={s.k} style={{ background: "var(--bg-tertiary,#1a1a1a)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 8, padding: "8px 10px" }}>
                                      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginBottom: 3 }}>{s.k}</div>
                                      <div style={{ fontSize: 14, fontWeight: 500 }}>{s.v}</div>
                                    </div>
                                  ))}
                                </div>

                                {(e.station || e.notes) && (
                                  <div style={{ padding: "0 4px 10px", fontSize: 11, color: "var(--text-tertiary,#888)" }}>
                                    {e.station && <span>📍 {e.station}</span>}
                                    {e.station && e.notes && <span> · </span>}
                                    {e.notes && <span>{e.notes}</span>}
                                  </div>
                                )}

                                {/* map, if this fill-up has coordinates */}
                                {hasGps && (
                                  <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid var(--border-color,#2a2a2a)", margin: "0 4px 12px" }}>
                                    <MiniMap lat={e.lat} lng={e.lng} />
                                  </div>
                                )}

                                {/* saved crops — what the model read */}
                                {entryImages[e.id]?.length > 0 && (
                                  <div style={{ padding: "0 4px 12px" }}>
                                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginBottom: 6 }}>Captured photos</div>
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                      {entryImages[e.id].map((img, i) => (
                                        <div key={i} style={{ textAlign: "center" }}>
                                          <img src={`data:image/jpeg;base64,${img.b64}`} alt={img.kind}
                                            style={{ height: 54, borderRadius: 6, border: "1px solid var(--border-color,#2a2a2a)", display: "block", background: "#000" }} />
                                          <div style={{ fontSize: 9, color: "var(--text-tertiary,#666)", marginTop: 2 }}>{img.kind}</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* edit / delete */}
                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "0 4px" }}>
                                  <button onClick={() => startEdit(e)} style={{ padding: "6px 14px", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "var(--text-secondary,#aaa)", cursor: "pointer" }}>Edit</button>
                                  <button onClick={() => deleteEntry(e.id, e.date)} style={{ padding: "6px 14px", fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", background: "none", border: "1px solid transparent", borderRadius: 6, color: "var(--color-danger,#ef4444)", cursor: "pointer" }}>Delete</button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}