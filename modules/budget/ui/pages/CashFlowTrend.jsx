// =============================================================================
// CashFlowTrend.jsx — Monthly income vs expense vs net over time (+ projection)
// thrive UI (budget module report)
//
// Complements the single-period Category Breakdown with a time axis: per-month
// income (up) / expense (down) bars off a zero baseline, with a net line over
// the top. Backed by GET /reports/cash-flow. An optional forward projection
// (GET /reports/cash-flow-projection) appends future months derived purely from
// scheduled transactions, drawn "ghosted" (translucent bars, dashed net line).
// =============================================================================
import { useState, useEffect, useCallback } from "react";
import { api } from "@trunk/api";

const INCOME = "#22c55e", EXPENSE = "#ef4444", NET = "#3b82f6";
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const fmtUSD    = (cents) => "$" + (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedUSD = (cents) => (cents < 0 ? "−" : "") + fmtUSD(cents);
const ymParts   = (ym) => { const [y, m] = ym.split("-"); return { y, mi: +m - 1 }; };
const monthFull = (ym) => { const { y, mi } = ymParts(ym); return `${MON[mi]} ${y}`; };
const todayISO  = () => new Date().toISOString().slice(0, 10);

const card = { background: "var(--bg-secondary,#181818)", border: "1px solid var(--border-color,#2a2a2a)", borderRadius: 10 };

// ── chart ─────────────────────────────────────────────────────────────────────
function CashFlowChart({ months, hov, setHov }) {
  const W = 760, H = 300, mL = 10, mR = 10, mT = 16, mB = 30;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const n = months.length;

  const maxInc = Math.max(0, ...months.map(m => m.income_cents));
  const maxExp = Math.max(0, ...months.map(m => m.expense_cents));
  const total  = maxInc + maxExp || 1;
  const upH    = plotH * (maxInc / total);
  const downH  = plotH - upH;
  const zeroY  = mT + upH;
  const incScale = maxInc ? upH   / maxInc : 0;
  const expScale = maxExp ? downH / maxExp : 0;

  const groupW = plotW / n;
  const barW   = Math.min(groupW * 0.46, 24);
  const cx     = (i) => mL + groupW * (i + 0.5);
  const netY   = (net) => net >= 0 ? zeroY - net * incScale : zeroY + (-net) * expScale;

  const labelEvery = n <= 14 ? 1 : n <= 28 ? 2 : 3;
  const showLabel  = (i) => i === 0 || i === n - 1 || i % labelEvery === 0;

  // where the projected tail begins (−1 / n when there's no projection)
  const splitRaw = months.findIndex(m => m.projected);
  const splitAt  = splitRaw < 0 ? n : splitRaw;

  // net line: a solid run over the actuals, a dashed run over the projection
  // (the dashed run starts at the last actual point so the two connect)
  const pt = (i) => `${cx(i).toFixed(1)},${netY(months[i].net_cents).toFixed(1)}`;
  const actIdx  = months.map((_, i) => i).filter(i => !months[i].projected);
  const projIdx = months.map((_, i) => i).filter(i =>  months[i].projected);
  const projRun = projIdx.length && actIdx.length ? [actIdx[actIdx.length - 1], ...projIdx] : projIdx;

  const bar = (m, i, kind) => {
    const cents = kind === "inc" ? m.income_cents : m.expense_cents;
    if (cents <= 0) return null;
    const h = cents * (kind === "inc" ? incScale : expScale);
    const hovd = hov === i, dim = hov != null && !hovd;
    return (
      <rect x={cx(i) - barW / 2} y={kind === "inc" ? zeroY - h : zeroY} width={barW} height={h} rx="1.5"
            fill={kind === "inc" ? INCOME : EXPENSE} pointerEvents="none"
            opacity={(m.projected ? 0.4 : 0.9) * (dim ? 0.55 : 1)}
            stroke={m.projected ? (kind === "inc" ? INCOME : EXPENSE) : "none"}
            strokeWidth={m.projected ? 1 : 0} strokeDasharray={m.projected ? "2 2" : undefined} />
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} onMouseLeave={() => setHov(null)}>
      {/* zero baseline */}
      <line x1={mL} y1={zeroY} x2={W - mR} y2={zeroY} stroke="var(--border-color,#333)" strokeWidth="1" />

      {/* actual / projection divider */}
      {splitAt > 0 && splitAt < n && (
        <line x1={mL + groupW * splitAt} y1={mT} x2={mL + groupW * splitAt} y2={mT + plotH}
              stroke="var(--text-tertiary,#555)" strokeWidth="1" strokeDasharray="3 3" />
      )}

      {months.map((m, i) => (
        <g key={m.month}>
          <rect x={mL + groupW * i} y={mT} width={groupW} height={plotH}
                fill={hov === i ? "rgba(255,255,255,0.04)" : "transparent"} onMouseEnter={() => setHov(i)} />
          {bar(m, i, "inc")}
          {bar(m, i, "exp")}
          {showLabel(i) && (
            <text x={cx(i)} y={H - 16} textAnchor="middle"
                  style={{ fill: m.projected ? "var(--text-tertiary,#666)" : "var(--text-tertiary,#888)", fontSize: 10, fontFamily: "monospace" }}>
              {MON[ymParts(m.month).mi]}
            </text>
          )}
          {(i === 0 || ymParts(m.month).mi === 0) && (
            <text x={cx(i)} y={H - 4} textAnchor="middle"
                  style={{ fill: "var(--text-tertiary,#555)", fontSize: 9, fontFamily: "monospace" }}>
              {ymParts(m.month).y}
            </text>
          )}
        </g>
      ))}

      {/* net line — solid over actuals, dashed over the projection */}
      {actIdx.length > 1 && (
        <polyline points={actIdx.map(pt).join(" ")} fill="none" stroke={NET} strokeWidth="1.75" opacity="0.9" pointerEvents="none" />
      )}
      {projRun.length > 1 && (
        <polyline points={projRun.map(pt).join(" ")} fill="none" stroke={NET} strokeWidth="1.75" strokeDasharray="4 3" opacity="0.7" pointerEvents="none" />
      )}
      {months.map((m, i) => (
        <circle key={m.month} cx={cx(i)} cy={netY(m.net_cents)} r={hov === i ? 3.5 : 2.2}
                fill={m.projected ? "var(--bg-secondary,#181818)" : NET} stroke={NET} strokeWidth="1" pointerEvents="none" />
      ))}
    </svg>
  );
}

// ── range + projection selector ────────────────────────────────────────────────
function RangeBar({ range, setRange, fromDate, setFromDate, toDate, setToDate, proj, setProj }) {
  const btn = (active) => ({
    fontFamily: "monospace", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
    padding: "5px 12px", borderRadius: 6, cursor: "pointer", border: "none",
    background: active ? "var(--text-primary,#e8e6e0)" : "var(--bg-tertiary,#222)",
    color: active ? "var(--bg-primary,#0f0f0f)" : "var(--text-secondary,#aaa)",
  });
  const input = { fontFamily: "monospace", fontSize: 12, background: "var(--bg-tertiary,#222)", border: "1px solid var(--border-color,#333)", borderRadius: 6, color: "inherit", padding: "5px 10px", outline: "none" };
  const lbl   = { fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)", marginRight: 2 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={lbl}>History</span>
        {[["3","3 months"],["6","6 months"],["12","12 months"],["24","24 months"],["ytd","YTD"],["custom","Custom"]].map(([id, l]) => (
          <button key={id} style={btn(range === id)} onClick={() => setRange(id)}>{l}</button>
        ))}
        {range === "custom" && (
          <>
            <input type="date" style={input} value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <span style={{ color: "var(--text-tertiary,#666)", fontSize: 12 }}>→</span>
            <input type="date" style={input} value={toDate} onChange={e => setToDate(e.target.value)} />
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={lbl} title="Projected from scheduled transactions">Project</span>
        {[["","Off"],["1","1"],["2","2"],["3","3"],["6","6"],["9","9"],["12","12"]].map(([id, l]) => (
          <button key={id || "off"} style={btn(proj === id)} onClick={() => setProj(id)}>{l}</button>
        ))}
        {proj && <span style={{ fontSize: 11, color: "var(--text-tertiary,#666)" }}>months ahead, from scheduled</span>}
      </div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function CashFlowTrend() {
  const [range,    setRange]    = useState("12");
  const [fromDate, setFromDate] = useState("");
  const [toDate,   setToDate]   = useState("");
  const [proj,     setProj]     = useState("");     // projection horizon months, "" = off
  const [data,     setData]     = useState(null);
  const [projData, setProjData] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState(null);
  const [hov,      setHov]      = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      let qs;
      if (range === "custom")   qs = `from=${fromDate}&to=${toDate}`;
      else if (range === "ytd") qs = `from=${new Date().getFullYear()}-01-01&to=${todayISO()}`;
      else                      qs = `months=${range}`;
      setData(await api.get(`/reports/cash-flow?${qs}`));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [range, fromDate, toDate]);

  useEffect(() => {
    if (range !== "custom" || (fromDate && toDate)) load();
  }, [load, range, fromDate, toDate]);

  const loadProj = useCallback(async () => {
    if (!proj) { setProjData(null); return; }
    try { setProjData(await api.get(`/reports/cash-flow-projection?months=${proj}`)); }
    catch { setProjData(null); }
  }, [proj]);
  useEffect(() => { loadProj(); }, [loadProj]);

  const histMonths = (data?.months || []).map(m => ({ ...m, projected: false }));
  const projMonths = proj ? (projData?.months || []).map(m => ({ ...m, projected: true })) : [];
  const months     = [...histMonths, ...projMonths];
  const totals     = data?.totals;
  const projTotals = proj ? projData?.totals : null;

  const focus = hov != null && months[hov]
    ? { label: monthFull(months[hov].month) + (months[hov].projected ? " · projected" : ""), ...months[hov] }
    : totals && { label: "Total", ...totals };

  const stat = (label, value, color) => (
    <div style={{ ...card, padding: "12px 16px", flex: "1 1 140px" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)" }}>{label}</div>
      <div style={{ fontSize: 20, fontFamily: "monospace", fontWeight: 600, marginTop: 4, color }}>{value}</div>
    </div>
  );

  return (
    <div style={{ padding: "1.5rem 1.5rem 3rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 14, fontWeight: 500, letterSpacing: "0.15em", textTransform: "uppercase", margin: 0 }}>Cash Flow</h1>
        <p style={{ fontSize: 12, color: "var(--text-tertiary,#888)", marginTop: 4 }}>Income, expense and net by month</p>
      </div>

      <RangeBar {...{ range, setRange, fromDate, setFromDate, toDate, setToDate, proj, setProj }} />

      {err && <div style={{ ...card, padding: "10px 14px", marginBottom: 12, color: "var(--color-danger,#ef4444)", fontSize: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary,#888)" }}>Loading…</div>
      ) : data && months.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-tertiary,#888)" }}>No transactions in this range.</div>
      ) : data && (
        <>
          {/* summary cards (historical range) */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: projTotals ? 10 : 16 }}>
            {totals && stat("Income",  fmtUSD(totals.income_cents),  INCOME)}
            {totals && stat("Expense", fmtUSD(totals.expense_cents), EXPENSE)}
            {totals && stat("Net",     signedUSD(totals.net_cents),  totals.net_cents >= 0 ? INCOME : EXPENSE)}
          </div>
          {projTotals && (
            <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-tertiary,#888)", marginBottom: 16 }}>
              Projected next {proj} mo:
              <span style={{ color: INCOME,  marginLeft: 10 }}>▲ {fmtUSD(projTotals.income_cents)}</span>
              <span style={{ color: EXPENSE, marginLeft: 10 }}>▼ {fmtUSD(projTotals.expense_cents)}</span>
              <span style={{ color: projTotals.net_cents >= 0 ? NET : EXPENSE, marginLeft: 10 }}>net {signedUSD(projTotals.net_cents)}</span>
            </div>
          )}

          {/* chart */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
              padding: "10px 16px", borderBottom: "1px solid var(--border-color,#2a2a2a)" }}>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary,#aaa)" }}>
                {focus && (
                  <>
                    <span style={{ color: "var(--text-primary,#e8e6e0)" }}>{focus.label}</span>
                    <span style={{ color: INCOME,  marginLeft: 12 }}>▲ {fmtUSD(focus.income_cents)}</span>
                    <span style={{ color: EXPENSE, marginLeft: 12 }}>▼ {fmtUSD(focus.expense_cents)}</span>
                    <span style={{ color: focus.net_cents >= 0 ? NET : EXPENSE, marginLeft: 12 }}>net {signedUSD(focus.net_cents)}</span>
                  </>
                )}
              </div>
              <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--text-tertiary,#888)" }}>
                {[["Income", INCOME], ["Expense", EXPENSE], ["Net", NET]].map(([l, c]) => (
                  <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: "inline-block" }} />{l}
                  </span>
                ))}
                {projTotals && <span style={{ color: "var(--text-tertiary,#666)" }}>┊ dashed = projected</span>}
              </div>
            </div>
            <div style={{ padding: "12px 8px 4px" }}>
              <CashFlowChart months={months} hov={hov} setHov={setHov} />
            </div>
          </div>

          {/* month table */}
          <div style={card}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, padding: "8px 16px",
              fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-tertiary,#666)",
              borderBottom: "1px solid var(--border-color,#2a2a2a)" }}>
              <span>Month</span>
              <span style={{ textAlign: "right" }}>Income</span>
              <span style={{ textAlign: "right" }}>Expense</span>
              <span style={{ textAlign: "right" }}>Net</span>
            </div>
            {months.map((m, i) => (
              <div key={m.month}
                onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, padding: "6px 16px",
                  fontSize: 12, fontFamily: "monospace", alignItems: "baseline", opacity: m.projected ? 0.72 : 1,
                  borderTop: i === histMonths.length && projMonths.length ? "1px dashed var(--border-color,#3a3a3a)" : i ? "1px solid var(--border-color,#1b1b1b)" : "none",
                  background: hov === i ? "var(--bg-tertiary,#222)" : "transparent" }}>
                <span style={{ color: "var(--text-secondary,#ccc)", fontStyle: m.projected ? "italic" : "normal" }}>
                  {monthFull(m.month)}{m.projected && <span style={{ color: "var(--text-tertiary,#666)", marginLeft: 6 }}>proj</span>}
                </span>
                <span style={{ textAlign: "right", color: INCOME }}>{m.income_cents ? fmtUSD(m.income_cents) : "—"}</span>
                <span style={{ textAlign: "right", color: EXPENSE }}>{m.expense_cents ? fmtUSD(m.expense_cents) : "—"}</span>
                <span style={{ textAlign: "right", color: m.net_cents >= 0 ? "var(--text-primary,#e8e6e0)" : EXPENSE }}>{signedUSD(m.net_cents)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
