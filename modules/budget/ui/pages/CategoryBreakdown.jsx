// =============================================================================
// CategoryBreakdown.jsx — Spending & income by parent / subcategory (donut)
// thrive UI
// =============================================================================
import { useState, useEffect, useCallback } from "react";
import { api } from "@trunk/api";
import SankeyView from "./SankeyView";

const API = "/reports/category-breakdown";

// ── colour palette ──────────────────────────────────────────────────────────
// themeable categorical palette (CSS vars from core; wraps past 8). Applied via
// `style` (not the fill= attribute) so the var() actually resolves in SVG.
const PALETTE = [
  "var(--chart-1)","var(--chart-2)","var(--chart-3)","var(--chart-4)",
  "var(--chart-5)","var(--chart-6)","var(--chart-7)","var(--chart-8)",
];
const color  = (i) => PALETTE[i % PALETTE.length];
const fmtUSD = (cents) =>
  "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (part, total) =>
  total ? ((part / total) * 100).toFixed(1) + "%" : "0%";
const shortDate = (iso) => {
  const [, m, d] = (iso || "").split("-");
  return m && d ? `${m}/${d}` : iso;
};

// ── SVG donut helpers ────────────────────────────────────────────────────────
const CX = 150, CY = 150;
const O_OUT = 130, O_IN = 95;   // outer ring radii
const I_OUT =  90, I_IN = 58;   // inner ring radii

function pt(r, deg) {
  const rad = (deg - 90) * Math.PI / 180;
  return `${(CX + r * Math.cos(rad)).toFixed(3)} ${(CY + r * Math.sin(rad)).toFixed(3)}`;
}
function arc(rOut, rIn, a1, a2) {
  const sweep = Math.min(a2 - a1, 359.99);
  const large = sweep > 180 ? 1 : 0;
  const a2c = a1 + sweep;
  return [
    `M ${pt(rOut, a1)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${pt(rOut, a2c)}`,
    `L ${pt(rIn,  a2c)}`,
    `A ${rIn}  ${rIn}  0 ${large} 0 ${pt(rIn, a1)}`,
    "Z",
  ].join(" ");
}

// ── donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ categories, totalCents, title, sign = -1, rangeQS = "" }) {
  const [hov,     setHov]     = useState(null);  // { key, name, total_cents, pct }
  const [drillId, setDrillId] = useState(null);  // parent category id we've zoomed into
  const [subSel,  setSubSel]  = useState(null);  // { catId, name } subcategory filter within a drill
  const [txns,       setTxns]       = useState([]);
  const [txnLoading, setTxnLoading] = useState(false);

  const enter = (cat)  => { setDrillId(cat); setSubSel(null); setHov(null); };
  const back  = ()     => { setDrillId(null); setSubSel(null); setHov(null); };

  // fetch the individual transactions behind the drilled category (or sub-filter)
  useEffect(() => {
    if (drillId == null) { setTxns([]); return; }
    let cancelled = false;
    setTxnLoading(true);
    let qs = `${rangeQS}&root_id=${drillId}&sign=${sign}`;
    if (subSel) qs += `&sub_id=${subSel.catId}`;
    api.get(`/reports/category-transactions?${qs}`)
      .then(rows => { if (!cancelled) setTxns(rows); })
      .catch(() => { if (!cancelled) setTxns([]); })
      .finally(() => { if (!cancelled) setTxnLoading(false); });
    return () => { cancelled = true; };
  }, [drillId, subSel, rangeQS, sign]);

  if (!categories.length) {
    return (
      <div style={{ textAlign: "center", padding: "2rem", fontSize: 12, color: "var(--text-tertiary,#888)" }}>
        {title}: no data
      </div>
    );
  }

  const grandTotal = totalCents || categories.reduce((s, c) => s + c.total_cents, 0);
  const drillCat   = drillId != null ? categories.find(c => c.id === drillId) : null;
  // drilling only makes sense when the parent has children to expand into
  const canDrill   = (cat) => cat.subcategories.length > 0;

  // ── build slice data ──
  const slices = []; // { key, path, color, fillOpacity, name, total_cents, onClick }

  if (drillCat) {
    // DRILL MODE — one bold ring of this parent's subcategories filling the donut;
    // clicking a slice filters the transaction list below to that subcategory.
    const subTotal     = drillCat.subcategories.reduce((s, x) => s + x.total_cents, 0);
    const directSpend  = drillCat.total_cents - subTotal;
    const items = [];
    if (directSpend > 0) items.push({ catId: drillCat.id, name: drillCat.name + " (direct)", total_cents: directSpend });
    drillCat.subcategories.forEach(sub => items.push({ catId: sub.id, name: sub.name, total_cents: sub.total_cents }));

    let cur = 0;
    items.forEach((it, i) => {
      const sweep = (it.total_cents / drillCat.total_cents) * 360;
      const sel = subSel && subSel.catId === it.catId;
      slices.push({
        key: `d-${it.catId}`, catId: it.catId,
        path: arc(O_OUT, I_IN, cur, cur + sweep),  // full thickness
        color: color(i), fillOpacity: 1, selected: !!sel,
        name: it.name, total_cents: it.total_cents,
        onClick: () => setSubSel(prev => (prev && prev.catId === it.catId) ? null : { catId: it.catId, name: it.name }),
      });
      cur += sweep;
    });
  } else {
    // OVERVIEW MODE — outer = parents, inner = subcategories
    let cursor = 0;
    categories.forEach((cat, ci) => {
      const sweep = (cat.total_cents / grandTotal) * 360;
      const a1 = cursor, a2 = cursor + sweep;
      const c = color(ci);
      const drillable = canDrill(cat);
      slices.push({
        key: `cat-${cat.id}`, ring: "outer",
        path: arc(O_OUT, O_IN, a1, a2), color: c, fillOpacity: 1,
        name: cat.name, total_cents: cat.total_cents,
        onClick: drillable ? () => enter(cat.id) : undefined,
      });

      if (cat.subcategories.length === 0) {
        slices.push({ key: `sub-${cat.id}`, path: arc(I_OUT, I_IN, a1, a2), color: c, fillOpacity: 0.45,
          name: cat.name, total_cents: cat.total_cents });
      } else {
        let subCursor = a1;
        const subTotal    = cat.subcategories.reduce((s, x) => s + x.total_cents, 0);
        const directSpend = cat.total_cents - subTotal;
        if (directSpend > 0) {
          const ss = (directSpend / cat.total_cents) * sweep;
          slices.push({ key: `sub-${cat.id}-direct`, path: arc(I_OUT, I_IN, subCursor, subCursor + ss), color: c, fillOpacity: 0.35,
            name: cat.name + " (direct)", total_cents: directSpend,
            onClick: () => enter(cat.id) });
          subCursor += ss;
        }
        cat.subcategories.forEach(sub => {
          const ss = (sub.total_cents / cat.total_cents) * sweep;
          slices.push({ key: `sub-${sub.id}`, path: arc(I_OUT, I_IN, subCursor, subCursor + ss), color: c, fillOpacity: 0.75,
            name: sub.name, total_cents: sub.total_cents,
            onClick: () => enter(cat.id) });
          subCursor += ss;
        });
      }
      cursor = a2;
    });
  }

  // center readout: hovered slice → selected sub → drilled parent → whole total
  const selSlice = subSel ? slices.find(s => s.selected) : null;
  const centerText = hov
    ? hov
    : selSlice
      ? { name: subSel.name, total_cents: selSlice.total_cents, pct: fmtPct(selSlice.total_cents, grandTotal) }
      : drillCat
        ? { name: drillCat.name, total_cents: drillCat.total_cents, pct: fmtPct(drillCat.total_cents, grandTotal) }
        : { name: title, total_cents: grandTotal, pct: null };

  // legend rows: drilled parent's children, or all parents
  const legendCats = drillCat ? [drillCat] : categories;

  // only dim siblings when the hovered thing actually corresponds to a slice
  const hovOnChart = hov && slices.some(s => s.key === hov.key);

  return (
    <div>
      <svg viewBox="0 0 300 300" style={{ width: "100%", maxWidth: 300, display: "block", margin: "0 auto" }}>
        {slices.map(s => {
          const dim = hovOnChart ? hov.key !== s.key : (subSel ? !s.selected : false);
          return (
            <path key={s.key} d={s.path} fillOpacity={s.fillOpacity}
              stroke={s.selected ? "var(--text-primary,#e8e6e0)" : "var(--bg-primary,#0f0f0f)"}
              strokeWidth={s.selected ? 2.5 : 1.5}
              style={{ fill: s.color, cursor: s.onClick ? "pointer" : "default", transition: "opacity 0.15s" }}
              opacity={dim ? 0.4 : 1}
              onMouseEnter={() => setHov({ key: s.key, name: s.name, total_cents: s.total_cents, pct: fmtPct(s.total_cents, grandTotal) })}
              onMouseLeave={() => setHov(null)}
              onClick={s.onClick}
            />
          );
        })}

        {/* center — clickable to pop back up one level when drilled */}
        <g style={{ cursor: drillCat ? "pointer" : "default" }}
          onClick={drillCat ? (subSel ? () => setSubSel(null) : back) : undefined}>
          {/* invisible hit target over the donut hole */}
          <circle cx={CX} cy={CY} r={I_IN} fill="transparent" />
          {drillCat && (
            <text x={CX} y={CY - 26} textAnchor="middle"
              style={{ fill: "var(--text-tertiary,#888)", fontSize: 9, fontFamily: "monospace", letterSpacing: "0.1em" }}>
              {subSel ? "✕ CLEAR" : "← BACK"}
            </text>
          )}
          <text x={CX} y={CY - 10} textAnchor="middle"
            style={{ fill: "var(--text-tertiary,#888)", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>
            {centerText.pct ? centerText.pct : title.split(" ")[0]}
          </text>
          <text x={CX} y={CY + 12} textAnchor="middle"
            style={{ fill: "var(--text-primary,#e8e6e0)", fontSize: 18, fontWeight: 600, fontFamily: "monospace" }}>
            {fmtUSD(centerText.total_cents)}
          </text>
          <text x={CX} y={CY + 30} textAnchor="middle"
            style={{ fill: "var(--text-secondary,#aaa)", fontSize: 10, fontFamily: "var(--font-body)" }}>
            {centerText.name.length > 22 ? centerText.name.slice(0, 22) + "…" : centerText.name}
          </text>
        </g>
      </svg>

      {/* breadcrumb when drilled */}
      {drillCat && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", margin: "6px 0 2px", color: "var(--text-tertiary,#888)" }}>
          <button onClick={back}
            style={{ background: "none", border: "none", color: "var(--text-secondary,#aaa)", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 11 }}>
            {title}
          </button>
          <span>/</span>
          {subSel ? (
            <>
              <button onClick={() => setSubSel(null)}
                style={{ background: "none", border: "none", color: "var(--text-secondary,#aaa)", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 11 }}>
                {drillCat.name}
              </button>
              <span>/</span>
              <span style={{ color: "var(--text-primary,#e8e6e0)" }}>{subSel.name}</span>
              <button onClick={() => setSubSel(null)} title="Clear filter"
                style={{ background: "none", border: "none", color: "var(--text-tertiary,#888)", cursor: "pointer", padding: "0 0 0 2px", fontFamily: "inherit", fontSize: 11 }}>✕</button>
            </>
          ) : (
            <span style={{ color: "var(--text-primary,#e8e6e0)" }}>{drillCat.name}</span>
          )}
        </div>
      )}

      {drillCat ? (
        <>
          {/* subcategory filter list (mirrors the donut slices) */}
          <div style={{ marginTop: 8, maxHeight: 130, overflowY: "auto" }}>
            {slices.map(s => {
              const sel = subSel && subSel.catId === s.catId;
              return (
                <div key={s.key}
                  onMouseEnter={() => setHov({ key: s.key, name: s.name, total_cents: s.total_cents, pct: fmtPct(s.total_cents, grandTotal) })}
                  onMouseLeave={() => setHov(null)}
                  onClick={() => setSubSel(sel ? null : { catId: s.catId, name: s.name })}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer",
                    borderBottom: "1px solid var(--border-color,#222)", opacity: subSel && !sel ? 0.5 : 1 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0, display: "inline-block", outline: sel ? "1.5px solid var(--text-primary,#e8e6e0)" : "none", outlineOffset: 1 }} />
                  <span style={{ flex: 1, fontSize: 12, color: "var(--text-secondary,#ccc)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary,#888)", fontFamily: "monospace", flexShrink: 0 }}>{fmtPct(s.total_cents, grandTotal)}</span>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary,#e8e6e0)", flexShrink: 0 }}>{fmtUSD(s.total_cents)}</span>
                </div>
              );
            })}
          </div>

          {/* individual transactions behind the current view */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginBottom: 4 }}>
              {txnLoading ? "Loading…" : `${txns.length} transaction${txns.length === 1 ? "" : "s"}`}{subSel ? ` · ${subSel.name}` : ""}
            </div>
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {txns.map(t => (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "46px 1fr auto", gap: 8, alignItems: "baseline", padding: "3px 0", borderBottom: "1px solid var(--border-color,#1b1b1b)" }}>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary,#888)", fontFamily: "monospace" }}>{shortDate(t.date)}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary,#ccc)" }}>{t.payee}</span>
                    <span style={{ fontSize: 11, color: "var(--text-tertiary,#666)", marginLeft: 6 }}>{t.category_name}</span>
                  </span>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary,#e8e6e0)" }}>{fmtUSD(t.amount_cents)}</span>
                </div>
              ))}
              {!txnLoading && txns.length === 0 && (
                <div style={{ fontSize: 11, color: "var(--text-tertiary,#666)", padding: "8px 0" }}>No transactions</div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* overview legend — parents (+ subs), click a parent to drill in */
        <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" }}>
          {legendCats.map((cat) => {
            const ci = categories.indexOf(cat);
            const drillable = canDrill(cat);
            return (
              <div key={cat.id}
                style={{ padding: "5px 0", borderBottom: "1px solid var(--border-color,#222)", cursor: drillable ? "pointer" : "default" }}
                onMouseEnter={() => setHov({ key: `cat-${cat.id}`, name: cat.name, total_cents: cat.total_cents, pct: fmtPct(cat.total_cents, grandTotal) })}
                onMouseLeave={() => setHov(null)}
                onClick={drillable ? () => enter(cat.id) : undefined}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: color(ci), flexShrink: 0, display: "inline-block" }} />
                  <span style={{ flex: 1, fontSize: 12, color: "var(--text-secondary,#ccc)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {cat.name}{drillable && <span style={{ color: "var(--text-tertiary,#666)", marginLeft: 6 }}>▸</span>}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary,#888)", fontFamily: "monospace", flexShrink: 0 }}>{fmtPct(cat.total_cents, grandTotal)}</span>
                  <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary,#e8e6e0)", flexShrink: 0 }}>{fmtUSD(cat.total_cents)}</span>
                </div>
                {cat.subcategories.length > 0 && (
                  <div style={{ marginLeft: 18, marginTop: 2 }}>
                    {cat.subcategories.map((sub) => (
                      <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}
                        onMouseEnter={e => { e.stopPropagation(); setHov({ key: `sub-${sub.id}`, name: sub.name, total_cents: sub.total_cents, pct: fmtPct(sub.total_cents, grandTotal) }); }}
                        onMouseLeave={e => { e.stopPropagation(); setHov(null); }}>
                        <span style={{ width: 6, height: 6, borderRadius: 1, background: color(ci), opacity: 0.6, flexShrink: 0, display: "inline-block" }} />
                        <span style={{ flex: 1, fontSize: 11, color: "var(--text-tertiary,#999)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub.name}</span>
                        <span style={{ fontSize: 10, color: "var(--text-tertiary,#888)", fontFamily: "monospace", flexShrink: 0 }}>{fmtPct(sub.total_cents, grandTotal)}</span>
                        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary,#bbb)", flexShrink: 0 }}>{fmtUSD(sub.total_cents)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── date range selector ──────────────────────────────────────────────────────
function RangeSelector({ rangeType, setRangeType, fromDate, setFromDate, toDate, setToDate }) {
  const btnStyle = (active) => ({
    fontFamily: "monospace", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
    padding: "5px 12px", borderRadius: 6, cursor: "pointer", border: "none",
    background: active ? "var(--text-primary,#e8e6e0)" : "var(--bg-tertiary,#222)",
    color: active ? "var(--bg-primary,#0f0f0f)" : "var(--text-secondary,#aaa)",
  });
  const inputStyle = { fontFamily: "monospace", fontSize: 12, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "inherit", padding: "5px 10px", outline: "none" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
      {[["last30","Last 30 days"],["month","This month"],["custom","Custom"]].map(([id, lbl]) => (
        <button key={id} style={btnStyle(rangeType === id)} onClick={() => setRangeType(id)}>{lbl}</button>
      ))}
      {rangeType === "custom" && (
        <>
          <input type="date" style={inputStyle} value={fromDate} onChange={e => setFromDate(e.target.value)} />
          <span style={{ color: "var(--text-tertiary,#666)", fontSize: 12 }}>→</span>
          <input type="date" style={inputStyle} value={toDate} onChange={e => setToDate(e.target.value)} />
        </>
      )}
    </div>
  );
}

// ── main page ────────────────────────────────────────────────────────────────
export default function CategoryBreakdown() {
  const today = () => new Date().toISOString().slice(0, 10);
  const [view,      setView]      = useState("donut");   // donut | sankey
  const [rangeType, setRangeType] = useState("last30");
  const [fromDate,  setFromDate]  = useState(today);
  const [toDate,    setToDate]    = useState(today);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [err,       setErr]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let qs = `range=${rangeType}`;
      if (rangeType === "custom") qs += `&from=${fromDate}&to=${toDate}`;
      const d = await api.get(`/reports/category-breakdown?${qs}`);
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [rangeType, fromDate, toDate]);

  useEffect(() => {
    if (rangeType !== "custom" || (fromDate && toDate)) load();
  }, [load, rangeType, fromDate, toDate]);

  const card = { background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 };
  const rangeQS = rangeType === "custom" ? `range=custom&from=${fromDate}&to=${toDate}` : `range=${rangeType}`;

  return (
    <div style={{ padding: "1.5rem 1.5rem 3rem" }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>Category Breakdown</h1>
          <p style={{ fontSize: 12, color: "var(--text-tertiary,#888)", marginTop: 4 }}>
            {view === "sankey" ? "Money flow: income → budget → expenses" : "Spending and income by category"}
          </p>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", flexShrink: 0 }}>
          View
          <select value={view} onChange={e => setView(e.target.value)}
            style={{ fontFamily: "monospace", fontSize: 12, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "var(--text-primary,#e8e6e0)", padding: "5px 10px", outline: "none", cursor: "pointer" }}>
            <option value="donut">Donut</option>
            <option value="sankey">Sankey</option>
          </select>
        </label>
      </div>

      <RangeSelector {...{rangeType, setRangeType, fromDate, setFromDate, toDate, setToDate}} />

      {err && <div style={{ ...card, padding: "10px 14px", marginBottom: 12, color: "var(--color-danger,#ef4444)", fontSize: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary,#888)" }}>Loading…</div>
      ) : data && (
        <>
          {data.from_date && (
            <p style={{ fontSize: 11, color: "var(--text-tertiary,#666)", marginBottom: 16 }}>
              {data.from_date} → {data.to_date}
            </p>
          )}
          {view === "sankey" ? (
            <div style={card}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>
                Money Flow
              </div>
              <SankeyView data={data} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
              <div style={card}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>
                  Spending
                </div>
                <div style={{ padding: 16 }}>
                  <DonutChart
                    categories={data.expenses.categories}
                    totalCents={data.expenses.total_cents}
                    title="Spending"
                    sign={-1}
                    rangeQS={rangeQS}
                  />
                </div>
              </div>
              <div style={card}>
                <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-tertiary,#666)" }}>
                  Income
                </div>
                <div style={{ padding: 16 }}>
                  <DonutChart
                    categories={data.income.categories}
                    totalCents={data.income.total_cents}
                    title="Income"
                    sign={1}
                    rangeQS={rangeQS}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}