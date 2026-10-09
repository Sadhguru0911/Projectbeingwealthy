import { useState } from "react";
import { HOUSE, PRIO, ChoiceGrid, OnbStyle, PriorityPicker } from "../onboarding/OnboardingFlow.jsx";
import AskLayer from "../ask/AskLayer.jsx";
import { canAnswer, messageFor, fmtDay } from "../ask/askEngine.js";

/**
 * Home (migration plan, backlog #41/#45). Pure presentational component - every
 * number here is computed by App.jsx and passed down as a plain prop; zero
 * App.jsx imports, avoiding circular-import risk.
 *
 * VISUAL DESIGN, corrected 30 Sep 2026: this now matches home-prototype-v1.html
 * (the agreed design, reviewed and iterated on together) precisely, not an
 * approximation of it. An earlier version of this file reused the classic app's
 * existing shell classes instead, reasoning that would look more consistent - that
 * reasoning turned out to rest on an unverified assumption (that the classic
 * app's own light theme already used this same warm-paper palette; it doesn't -
 * the classic app's --paper is plain white, #FFFFFF, while the agreed design's is
 * #ECE7DA) and, more importantly, substituting a new decision for a design already
 * agreed on was the wrong call to make unilaterally either way. Colors, card
 * grid, the named history ladder, and the real SVG forecast chart all now come
 * directly from the prototype's own CSS/markup, scoped to a `.home-v2` wrapper so
 * nothing here touches the classic app's shared tokens or any other screen.
 */

const PAPER = "#ECE7DA", CARD = "#F9F7F1", INK = "#21262B", INK_SOFT = "#57616B";
const LINE = "#D3CAB5", LINE_STRONG = "#A9A08A", TEAL = "#2E6659", OCHRE = "#A8703A";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.round(n || 0));
const inrK = (n) => (Math.abs(n) >= 100000 ? "\u20B9" + (n / 100000).toFixed(1) + "L" : inr(n));
function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); }

// Asha's story stepper, same steps and labels as the prototype (STEPS / STEPBTN).
const STORY_NEXT = { 1: 2, 2: 3, 3: 6, 6: 12 };
const STORY_BTN = { 1: "Asha adds August", 2: "Asha adds July", 3: "Asha adds April to June", 6: "Asha adds the six months before that" };
const STAGES = ["Snapshot", "Emerging patterns", "Reliable patterns", "Stronger forecasts"];
function stageForMonths(m) {
  if (m < 2) return 0;
  if (m < 3) return 1;
  if (m < 6) return 2;
  return 3;
}

/** The calculation drawer (backlog #41's original spec), built as one small,
 *  reusable piece rather than one-off per number: a "Why?" toggle that reveals
 *  the real evidence already computed for that number, never a claim with
 *  nothing behind it. Local, per-instance expand state only - purely a
 *  display concern, not data, so it stays out of App.jsx entirely. Renders
 *  nothing at all when there's no real evidence to show, rather than an
 *  empty, misleading "Why?" link. */
function Evidence({ items }) {
  const [open, setOpen] = useState(false);
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <button className="hv2-link" style={{ fontSize: 11.5 }} onClick={() => setOpen((o) => !o)}>{open ? "Hide the working" : "Why?"}</button>
      {open && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12, color: INK_SOFT, lineHeight: 1.6 }}>
          {items.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}

/** "Show the proof" (backlog #61): a click reveals the real, named,
 *  well-established commitments behind the patterns ladder, not just an
 *  abstract stage name and month count. Renders nothing when there's
 *  genuinely nothing established yet, rather than an empty, misleading link -
 *  same discipline as <Evidence>. */
function PatternsProof({ patterns }) {
  const [open, setOpen] = useState(false);
  if (!patterns || patterns.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <button className="hv2-link" style={{ fontSize: 11.5 }} onClick={() => setOpen((o) => !o)}>{open ? "Hide what we've learned" : `See the ${patterns.length} pattern${patterns.length === 1 ? "" : "s"} we've confirmed`}</button>
      {open && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12, color: INK_SOFT, lineHeight: 1.7 }}>
          {patterns.map((p, i) => <li key={i}>{p.name} &mdash; {p.occurrenceCount}&times;, last {inr(p.lastAmount)}</li>)}
        </ul>
      )}
    </div>
  );
}

/** An inline, answerable question card (backlog #63) - built to match the
 *  exact pattern already designed for onboarding's own quick-review cards
 *  (SCREENS.quick in the journey prototype: an open question, answered with
 *  a tap on a chip, right there, never a screen change). Cash cushion is a
 *  numeric answer rather than a category, so the chips here are common
 *  preset amounts rather than labeled choices, with a free-text field for
 *  anything else - same spirit, adapted to the kind of answer this
 *  particular question needs. Generalizing this into a single reusable
 *  question-engine (for other profile-building questions beyond this one)
 *  is real, deliberately deferred work, not attempted in this pass. */
function CashBufferQuestion({ onAnswer }) {
  const [custom, setCustom] = useState("");
  const presets = [50000, 100000, 200000, 300000];
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {presets.map((p) => (
          <button key={p} className="hv2-chip" onClick={() => onAnswer(p)}>{inr(p)}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="number" placeholder="A different amount" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid " + LINE_STRONG, fontFamily: "inherit", fontSize: 13, background: CARD }} />
        <button className="hv2-btn" style={{ marginTop: 0 }} onClick={() => { const v = Number(custom); if (v > 0) onAnswer(v); }}>Set</button>
      </div>
    </div>
  );
}

/** Same real question, same real choice list, as onboarding's own Q1 - just
 *  answered from Home instead (backlog #66), for anyone who hasn't yet,
 *  regardless of whether they ever saw the sequential onboarding flow at
 *  all. Multi-select (several people can be part of a financial life at
 *  once), "me" always included and not toggleable - matching Q1 exactly. */
function HouseholdQuestion({ household, onToggle, onConfirm }) {
  return (
    <div style={{ marginTop: 4 }}>
      <div className="onb-root embed"><OnbStyle />
        <ChoiceGrid options={HOUSE} isSelected={(key) => !!household[key]} disabledKey="me"
          onToggle={(key) => onToggle({ ...household, [key]: !household[key] })} /></div>
      <button className="hv2-btn" style={{ marginTop: 10 }} onClick={onConfirm}>Confirm</button>
    </div>
  );
}

/** Same picker as onboarding's Q2: choose up to 3, then Save. */
function PriorityQuestion({ onAnswer }) {
  const [sel, setSel] = useState([]);
  return <div className="onb-root embed"><OnbStyle /><PriorityPicker value={sel} onChange={setSel} /><div className="row"><button className="btn" disabled={!sel.length} onClick={() => onAnswer(sel)}>Save</button></div></div>;
}

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/** The real SVG forecast chart - built from projection.dailyStates (the app's own
 *  real day-by-day balance walk, already computed for Cash Flow's own chart), not
 *  a placeholder. Mirrors the prototype's chart exactly: axis line, date labels,
 *  a shaded band under the line, a dashed cushion line, and a marked lowest point. */
function ForecastChart({ projection, cashBuffer }) {
  const W = 560, H = 160, L = 8, R = W - 8, T = 16, B = H - 28;
  const days = projection.dailyStates;
  const values = days.map((d) => d.balance).concat([cashBuffer || 0]);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const X = (i) => L + (i / (days.length - 1)) * (R - L);
  const Y = (v) => B - ((v - min) / range) * (B - T);
  const linePath = days.map((d, i) => (i === 0 ? "M" : "L") + X(i).toFixed(1) + " " + Y(d.balance).toFixed(1)).join(" ");
  const bandPath = "M" + X(0) + " " + B + " " + days.map((d, i) => "L" + X(i).toFixed(1) + " " + Y(d.balance).toFixed(1)).join(" ") + " L" + X(days.length - 1) + " " + B + " Z";
  const lowIdx = days.reduce((best, d, i) => (d.balance < days[best].balance ? i : best), 0);

  return (
    <svg viewBox={"0 0 " + W + " " + H} width="100%" style={{ display: "block", marginTop: 8 }} role="img" aria-label="Cash forecast for the next three months">
      <line x1={L} y1={B} x2={R} y2={B} stroke={LINE} />
      <text x={L} y={B + 20} fontSize="12.5" fill={INK_SOFT} fontFamily="IBM Plex Mono">Today</text>
      <text x={R} y={B + 20} textAnchor="end" fontSize="12.5" fill={INK_SOFT} fontFamily="IBM Plex Mono">{days[days.length - 1].date}</text>
      <path d={bandPath} fill={TEAL} opacity="0.13" />
      {cashBuffer > 0 && (
        <>
          <line x1={L} y1={Y(cashBuffer)} x2={R} y2={Y(cashBuffer)} stroke={OCHRE} strokeWidth="1.3" strokeDasharray="4 4" />
          <text x={L + 2} y={Y(cashBuffer) - 7} fontSize="12.5" fill={OCHRE}>Your cushion {inrK(cashBuffer)}</text>
        </>
      )}
      <path d={linePath} fill="none" stroke={TEAL} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(lowIdx)} cy={Y(days[lowIdx].balance)} r="5" fill={CARD} stroke={TEAL} strokeWidth="2.4" />
    </svg>
  );
}

export default function HomeScreen({
  cashToday, netWorth,
  lastTransactionDate, todayStr, hasAnyData, setView, projection, uncategorizedCount,
  monthsOfHistory, cashBuffer, nextSteps, attentionItems, hasGoalSet, onDismissItem, onSnoozeItem, onStepAct,
  helpMeUnderstandItems, cashTodayEvidence, netWorthEvidence, lastBackupAt, autoBackupOn, onBackupNow,
  establishedPatterns, priority, demoStory, onDemoStory, onDemoStartOver, askFacts, deck, onOpenDeck, onSetCashBuffer, household, onSetHousehold, onConfirmHousehold, onSetPriorities,
}) {
  // Ask (backlog #75): the panel's own state lives here so a "Why?" link below can open it on a question.
  const [ask, setAsk] = useState({ open: false, thread: [] });
  const openAsk = (id) => setAsk((a) => ({ open: true, thread: [...(a.open ? a.thread : []), messageFor(askFacts, id)] }));
  const styleBlock = (
    <style>{`
      .home-v2 { background: ${PAPER}; color: ${INK}; font-family: 'IBM Plex Sans', sans-serif; padding: 20px; border-radius: 8px; }
      .home-v2 h2.hv2-h { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(24px, 5vw, 30px); margin: 0 0 12px; }
      .home-v2 .hv2-kicker { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; color: ${TEAL}; margin-bottom: 8px; }
      .home-v2 .hv2-fresh { font-size: 12.5px; color: ${INK_SOFT}; border: 1px solid ${LINE_STRONG}; border-radius: 22px; padding: 4px 12px; display: inline-flex; align-items: center; gap: 7px; }
      .home-v2 .hv2-fresh i { width: 7px; height: 7px; border-radius: 50%; background: ${TEAL}; display: inline-block; }
      .home-v2 .hv2-grid { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px; }
      @media (min-width: 860px) { .home-v2 .hv2-grid.two { grid-template-columns: 1fr 1fr; align-items: start; } }
      .home-v2 .hv2-card { background: ${CARD}; border: 1px solid ${LINE}; border-radius: 12px; padding: 22px; }
      .home-v2 .hv2-money { font-family: 'IBM Plex Mono', monospace; font-size: 34px; font-weight: 600; letter-spacing: -0.01em; }
      .home-v2 .hv2-money small { display: block; font-size: 13px; font-weight: 400; color: ${INK_SOFT}; margin-top: 10px; font-family: 'IBM Plex Sans', sans-serif; }
      .home-v2 .hv2-lockrow { display: flex; gap: 10px; align-items: center; font-size: 13.5px; color: ${INK_SOFT}; }
      .home-v2 .hv2-lockrow b { color: ${INK}; font-weight: 600; }
      .home-v2 .hv2-note { font-size: 12.5px; color: ${INK_SOFT}; line-height: 1.5; margin: 10px 0 0; }
      .home-v2 .hv2-muted { font-size: 13.5px; color: ${INK_SOFT}; line-height: 1.5; margin: 0 0 6px; }
      .home-v2 .hv2-link { background: none; border: none; padding: 4px 0; font: inherit; font-size: 13px; color: ${TEAL}; text-decoration: underline; cursor: pointer; }
      .home-v2 .hv2-stat-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
      .home-v2 .hv2-stat .l { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: ${INK_SOFT}; }
      .home-v2 .hv2-stat .v { font-family: 'IBM Plex Mono', monospace; font-size: 18px; font-weight: 600; margin-top: 2px; }
      .home-v2 .hv2-ladder { display: flex; align-items: center; gap: 5px; margin-bottom: 10px; }
      .home-v2 .hv2-ladder .seg { width: 22px; height: 5px; border-radius: 3px; background: ${LINE}; }
      .home-v2 .hv2-ladder .seg.on { background: ${TEAL}; }
      .home-v2 .hv2-ladder b { font-size: 13.5px; margin-left: 6px; }
      .home-v2 .hv2-btn { font-family: inherit; font-size: 13px; font-weight: 600; padding: 9px 16px; border-radius: 6px; border: 1px solid ${INK}; background: ${INK}; color: ${CARD}; cursor: pointer; margin-top: 10px; }
      .home-v2 .hv2-btn:hover { background: ${TEAL}; border-color: ${TEAL}; }
      .home-v2 .hv2-chip { font-family: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 16px; border: 1px solid ${LINE_STRONG}; background: ${CARD}; color: ${INK}; cursor: pointer; }
      .home-v2 .hv2-chip:hover { border-color: ${TEAL}; color: ${TEAL}; }
      .home-v2 .hv2-headline { font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; line-height: 1.25; margin: 16px 0 8px; }
      .home-v2 .hv2-pill { display: inline-block; font-size: 12px; padding: 3px 11px; border-radius: 16px; border: 1px solid ${LINE_STRONG}; color: ${INK_SOFT}; margin-top: 6px; }
      .home-v2 .hv2-pill.ok { color: ${TEAL}; border-color: ${TEAL}; }
      .home-v2 .hv2-pill.warn { color: ${OCHRE}; border-color: ${OCHRE}; }
      .home-v2 .hv2-story { background: #F1EDE1; border: 1px dashed ${LINE_STRONG}; }
      .home-v2 .hv2-crow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 8px 0; }
      .home-v2 .hv2-crow > span { min-width: 120px; font-size: 14.5px; color: ${INK_SOFT}; }
      .home-v2 .hv2-chip.sel { background: ${TEAL}; border-color: ${TEAL}; color: ${CARD}; }
      .home-v2 .hv2-footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 12px; color: ${INK_SOFT}; border-top: 1px solid ${LINE}; padding-top: 14px; margin-top: 4px; }
    `}</style>
  );

  if (!hasAnyData) {
    return (
      <div className="home-v2">
        {styleBlock}
        <h2 className="hv2-h">Home</h2>
        <div className="hv2-card">Nothing here yet - import a statement to see your first financial picture, or explore with sample data from the front page.</div>
      </div>
    );
  }

  const freshnessDays = lastTransactionDate ? daysBetween(lastTransactionDate, todayStr) : null;
  const isStale = freshnessDays !== null && freshnessDays > 35;
  const stage = stageForMonths(monthsOfHistory || 0);
  const cashOnly = cashToday !== null && netWorth.totalLiabilities === 0 && Math.round(netWorth.totalAssets) === Math.round(cashToday);
  return (
    <div className="home-v2">
      {styleBlock}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="hv2-kicker">Home</div>
          <h2 className="hv2-h">Where you stand</h2>
        </div>
        <div className="hv2-fresh"><i />{isStale ? `Data last updated ${freshnessDays} days ago` : "Up to date through " + todayStr}</div>
      </div>

      {demoStory && (
        <div className="hv2-card hv2-story" style={{ marginBottom: 16 }}>
          <div className="hv2-kicker">Asha&rsquo;s story</div>
          <p className="hv2-muted">Add to her history, add her accounts &mdash; and watch Home adapt.</p>
          <div className="hv2-crow"><span>Her history</span>
            {demoStory.h < 12
              ? <button className="hv2-btn" style={{ marginTop: 0 }} onClick={() => onDemoStory({ h: STORY_NEXT[demoStory.h] || 12 })}>{STORY_BTN[demoStory.h] || "Asha adds more months"} &rarr;</button>
              : <span style={{ minWidth: 0 }}>A full year</span>}
            {demoStory.h < 6 && <button className="hv2-link" onClick={() => onDemoStory({ h: 6 })}>Jump to six months</button>}
          </div>
          <div className="hv2-crow"><span>Her accounts</span>
            {[["card", "Adds her credit card"], ["loan", "Adds her loan"], ["inv", "Adds her investments"], ["goalSet", "Sets a goal target"]].map(([k, label]) => (
              <button key={k} className={"hv2-chip" + (demoStory[k] ? " sel" : "")} onClick={() => onDemoStory({ [k]: !demoStory[k] })}>{label}</button>
            ))}
          </div>
          <div className="hv2-crow"><span></span><button className="hv2-link" onClick={onDemoStartOver}>&#8634; Start Asha over</button></div>
        </div>
      )}

      {/* Layout follows the agreed prototype (Demo_Homescreen5): Money | Future, Attention | Next steps,
       *  Net worth | Patterns (backlog #73). Card contents are unchanged except where #73 says otherwise. */}
      <div className="hv2-grid two">
        <div className="hv2-card">
          <div className="hv2-kicker">Your money</div>
          <div className="hv2-money">
            {cashToday === null ? "Unverified" : inr(cashToday)}
            <small>{cashToday === null ? "Missing a verified balance for one or more bank accounts" : "Cash in your bank today"}</small>
          </div>
          <Evidence items={cashTodayEvidence} />
          {cashToday !== null && (monthsOfHistory < 3 ? (
            <>
              <div className="hv2-headline">Here&rsquo;s your first look.</div>
              <p className="hv2-muted">One month gives me a snapshot. A few more let me understand your patterns.</p>
              <span className="hv2-pill">Early look &middot; {monthsOfHistory} month{monthsOfHistory === 1 ? "" : "s"}</span>
            </>
          ) : (projection && cashBuffer > 0 && (() => {
            const low = projection.projectedMinimumCash, ok = low >= cashBuffer, early = monthsOfHistory < 6;
            const pillBase = early ? "Early estimate" : (ok ? "Comfortable" : "Below your cushion");
            return (
              <>
                <div className="hv2-headline">{ok ? "Your cash looks comfortable for the next 3 months." : "Your cash dips below the cushion you\u2019d like."}</div>
                <p className="hv2-muted">{ok
                  ? <>It stays above your {inr(cashBuffer)} cushion, with {inrK(low - cashBuffer)} to spare at its lowest point, around {fmtDay(projection.projectedMinimumCashDate)}.{early ? " Bills that only come once or twice a year could still be missing." : ""}</>
                  : <>At its lowest point, around {fmtDay(projection.projectedMinimumCashDate)}, it is {inrK(cashBuffer - low)} below your {inr(cashBuffer)} cushion.{early ? " Bills that only come once or twice a year could still be missing." : ""}</>}</p>
                <span className={"hv2-pill" + (early ? "" : ok ? " ok" : " warn")}>{pillBase} &middot; based on {monthsOfHistory} months of your history</span>
              </>
            );
          })()))}
        </div>
        <div className="hv2-card">
          <div className="hv2-kicker">Your future - next 3 months</div>
          {monthsOfHistory < 3 || projection === null ? (
            <div className="hv2-lockrow"><LockIcon /><span><b>Where your cash is headed</b> - unlocks with 3 months of history</span></div>
          ) : (
            <>
              {/* Explicit chart title, added directly (backlog #62) - "Your
               *  future" alone doesn't say what the chart actually shows;
               *  found directly that this wasn't clear without it. */}
              <p className="hv2-muted" style={{ margin: "0 0 4px", fontWeight: 600, color: INK }}>Projected daily cash balance, today through {projection.dailyStates[projection.dailyStates.length - 1].date}</p>
              <ForecastChart projection={projection} cashBuffer={cashBuffer} />
              <div className="hv2-stat-row">
                <div className="hv2-stat"><div className="l">Lowest point</div><div className="v" style={{ color: projection.projectedMinimumCash < 0 ? "#9C4A34" : INK }}>{inr(projection.projectedMinimumCash)}</div></div>
                <div className="hv2-stat"><div className="l">Around</div><div className="v">{projection.projectedMinimumCashDate}</div></div>
                <div className="hv2-stat"><div className="l">Drawdown</div><div className="v">{inr(projection.cashDrawdown)}</div></div>
              </div>
              <p className="hv2-note" style={{ marginTop: 8 }}>
                This projects your committed bills and usual spending forward from today's cash
                {cashBuffer ? <> against your {inr(cashBuffer)} cushion (the dashed line) - below it is what "a dip" means on this card.</> : <>. You haven't set a cash cushion yet, so there's no line showing what level would actually be a problem.</>}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="hv2-grid two">
        <div className="hv2-card">
          <div className="hv2-kicker">Worth your attention</div>
          {(!attentionItems || attentionItems.length === 0) ? (
            <p className="hv2-muted"><b style={{ color: INK }}>No material changes requiring your attention.</b>{monthsOfHistory < 3 ? <> With {monthsOfHistory === 1 ? "one month" : monthsOfHistory + " months"} I can&rsquo;t tell what has changed yet &mdash; I&rsquo;ll flag things as your history grows.</> : null}</p>
          ) : (
            attentionItems.map((item, i) => (
              <div key={i} style={{ marginBottom: i < attentionItems.length - 1 ? 12 : 0, display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <b style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, display: "block", marginBottom: 3 }}>{item.title}</b>
                  <p className="hv2-muted" style={{ margin: 0 }}>{item.body}</p>
                  {askFacts && item.why && canAnswer(askFacts, item.why)
                    ? <button className="hv2-link" style={{ fontSize: 11.5 }} onClick={() => openAsk(item.why)}>Why?</button>
                    : <Evidence items={item.evidence} />}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="hv2-card">
          <div className="hv2-kicker">Next steps</div>
          {nextSteps && nextSteps.map((step, i) => (
            <div key={i} style={{ marginBottom: i < nextSteps.length - 1 ? 16 : 0, paddingBottom: i < nextSteps.length - 1 ? 14 : 0, borderBottom: i < nextSteps.length - 1 ? "1px solid " + LINE : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <b style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, display: "block", marginBottom: 3 }}>{step.title}</b>
                {step.id && onSnoozeItem && (
                  <button className="hv2-link" style={{ flexShrink: 0, fontSize: 12 }} onClick={() => onSnoozeItem(step.ids || step.id)} title="Ask me again in a month">Snooze</button>
                )}
              </div>
              {step.items ? (
                <div data-testid="richer-card">
                  {step.items.map((it, k) => (
                    <div key={k} style={{ padding: "8px 0", borderTop: "1px solid " + LINE }}>
                      <b style={{ fontSize: 13.5, display: "block" }}>{it.label}</b>
                      <span className="hv2-muted" style={{ fontSize: 13 }}>{it.text}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="hv2-muted">{step.body}</p>}
              <Evidence items={step.evidence} />
              {step.inlineType === "cashBuffer" ? (
                <CashBufferQuestion onAnswer={onSetCashBuffer} />
              ) : step.inlineType === "household" ? (
                <HouseholdQuestion household={household} onToggle={onSetHousehold} onConfirm={onConfirmHousehold} />
              ) : step.inlineType === "priority" ? (
                <PriorityQuestion onAnswer={onSetPriorities} />
              ) : step.cta ? (
                <button className="hv2-btn" onClick={() => (onStepAct ? onStepAct(step) : setView(step.act || "upload"))}>{step.cta}</button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="hv2-grid two">
        <div className="hv2-card">
          {/* Fixed (backlog #62): was a different size and always-colored,
           *  with no real rationale - an inconsistency, not a deliberate
           *  design choice, found directly. Now matches Cash Today's own
           *  size and layout exactly (big number, caption below it) - the
           *  one color kept is deliberate and meaningful: red ONLY when
           *  net worth is genuinely negative, the same convention the
           *  forecast card's own "Lowest point" already uses, not a
           *  decoration applied regardless of what the number says. */}
          <div className="hv2-kicker">Your money - net worth</div>
          {cashOnly ? (
            <>
              <p className="hv2-muted">Net worth needs both sides &mdash; what you own and what you owe. So far I know your cash: <b style={{ color: INK }}>{inr(cashToday)}</b>.</p>
              <p className="hv2-note">Add your investments and loans and this fills in.</p>
            </>
          ) : (
            <div className="hv2-money" style={{ color: netWorth.netWorth >= 0 ? INK : "#9C4A34" }}>
              {inr(netWorth.netWorth)}
              <small>Own {inr(netWorth.totalAssets)} &middot; Owe {inr(netWorth.totalLiabilities)}</small>
            </div>
          )}
          <Evidence items={netWorthEvidence} />
          <p className="hv2-note"><button className="hv2-link" onClick={() => setView("networth")}>See the full breakdown &rarr;</button></p>
          {!hasGoalSet && (
            <>
              <hr style={{ border: "none", borderTop: "1px solid " + LINE, margin: "12px 0" }} />
              <p className="hv2-muted" style={{ margin: 0 }}>{priority === "home" ? "You said buying a home matters most." : "No goal set yet."} <button className="hv2-link" onClick={() => setView("goals")}>Set a target</button></p>
            </>
          )}
        </div>
        <div className="hv2-card">
          <div className="hv2-kicker">Your patterns</div>
          <div className="hv2-ladder">
            {STAGES.map((_, i) => <span key={i} className={"seg" + (i <= stage ? " on" : "")} />)}
            <b>{STAGES[stage]} &middot; {monthsOfHistory} month{monthsOfHistory === 1 ? "" : "s"}</b>
          </div>
          {/* Show the proof (backlog #61): the real, named, well-established
           *  commitments behind the ladder - not an abstract count the person
           *  has no way to check against their own knowledge of their finances. */}
          {stage >= 2 && establishedPatterns && establishedPatterns.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, borderBottom: "1px dashed " + LINE_STRONG, padding: "6px 0" }}><span>Bills that repeat</span><span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{establishedPatterns.length}</span></div>
          )}
          <PatternsProof patterns={establishedPatterns} />
          {/* Corrected after direct feedback: the earlier version here blended
           *  frequency/control confidence into an "N still uncertain" count,
           *  which wrongly flagged genuinely one-time transactions (a single
           *  investment redemption, a one-off transfer - fully categorized,
           *  correctly linked, nothing to act on) as if they needed attention,
           *  simply because a single sighting can never confirm a repeating
           *  pattern. That is expected and permanent for a one-time event, not
           *  a gap. Uses the SAME complete definition Review itself uses
           *  (isFullyCategorized - category, subcategory, frequency, control,
           *  purpose AND linked account where relevant), not category alone -
           *  found directly from a real screenshot: this said "everything is
           *  categorized" while Review's own count showed 34 items still
           *  missing a linked account specifically. */}
          {deck && deck.count > 0 ? (
            <p className="hv2-note"><button className="hv2-link" onClick={onOpenDeck}>Finish sorting {deck.count} merchant{deck.count === 1 ? "" : "s"} &mdash; about {Math.max(1, Math.ceil(deck.count / 6))} min &rarr;</button></p>
          ) : uncategorizedCount > 0 ? (
            <p className="hv2-note"><button className="hv2-link" onClick={() => setView("review")}>Review the {uncategorizedCount} still incomplete &rarr;</button></p>
          ) : (
            <p className="hv2-muted" style={{ marginTop: 8 }}>Everything is complete - categorized, and linked where relevant.</p>
          )}
        </div>
      </div>

      {/* Renamed from "Help me learn" (backlog #61), per direct feedback: the
       *  old name sounded like the person was teaching the app random facts.
       *  What's actually happening is the system noticed a real pattern and
       *  doesn't yet know what it MEANS - a different, more honest framing.
       *  Deliberately a SEPARATE list from "Worth your attention": a genuine
       *  open question, never money materiality. Only rendered when there's
       *  something real to ask - no empty-state filler. */}
      {helpMeUnderstandItems && helpMeUnderstandItems.length > 0 && (
        <div className="hv2-grid">
          <div className="hv2-card">
            <div className="hv2-kicker">Help me understand your money</div>
            <p className="hv2-muted" style={{ marginTop: -4 }}>We've noticed these financial relationships, but we're not sure what they mean yet.</p>
            {helpMeUnderstandItems.map((item, i) => (
              <div key={i} style={{ marginBottom: i < helpMeUnderstandItems.length - 1 ? 10 : 0 }}>
                <b style={{ fontFamily: "'Fraunces', serif", fontSize: 14.5, fontWeight: 600, display: "block", marginBottom: 2 }}>{item.title}</b>
                <p className="hv2-muted" style={{ margin: 0 }}>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {askFacts && <AskLayer facts={askFacts} ask={ask} setAsk={setAsk} />}

      <div className="hv2-footer">
        <span>Everything here stays on this device.</span>
        {lastBackupAt ? (
          <span>Backed up {daysBetween(lastBackupAt, todayStr) === 0 ? "today" : daysBetween(lastBackupAt, todayStr) + " day" + (daysBetween(lastBackupAt, todayStr) === 1 ? "" : "s") + " ago"}{autoBackupOn ? " (auto)" : ""} &middot; <button className="hv2-link" style={{ fontSize: 12 }} onClick={onBackupNow}>Back up now</button></span>
        ) : (
          <span>Never backed up &middot; <button className="hv2-link" style={{ fontSize: 12 }} onClick={onBackupNow}>Back up now</button></span>
        )}
      </div>
    </div>
  );
}
