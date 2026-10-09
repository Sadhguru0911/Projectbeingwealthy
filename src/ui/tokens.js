/**
 * Design tokens (migration plan Phase 1, backlog #43). Named values only —
 * defined here, used nowhere yet. This file has zero effect on the shipped
 * app until something imports it, which is deliberate: Phase 0 scaffolds
 * the vocabulary so Phase 1 can restyle the shell by pointing existing
 * inline styles/CSS at these names, one screen at a time, rather than
 * inventing values ad hoc per screen as it goes.
 *
 * Two densities, not one: COMFORTABLE for summary/reading surfaces (Home,
 * onboarding, dashboards), COMPACT for workbench tables (Review, Rules,
 * Accounts, Recurring) that need to fit many columns. Both keep a
 * legibility floor — compact's smallest label is still ~13px, not the
 * ~10.5px several screens use today.
 */

export const color = {
  paper: "#ECE7DA",
  card: "#F9F7F1",
  ink: "#21262B",
  inkSoft: "#57616B",
  line: "#D3CAB5",
  lineStrong: "#A9A08A",
  teal: "#2E6659",
  ochre: "#A8703A",
  tint: "rgba(46,102,89,.075)",
  tintLine: "rgba(46,102,89,.28)",
};

export const font = {
  serif: "'Fraunces', serif",
  sans: "'IBM Plex Sans', sans-serif",
  mono: "'IBM Plex Mono', monospace",
};

// Two density tiers. Values are the SAME semantic slots (eyebrow, label, body,
// heading, control height) so a screen can switch tier without restructuring.
export const density = {
  comfortable: {
    eyebrow: "13.5px",
    label: "13px",
    body: "16px",
    heading: "28px",
    hero: "clamp(42px, 10vw, 60px)",
    cardPadding: "24px",
    controlHeight: "46px",
    radius: "12px",
  },
  compact: {
    // Revised during Phase 1 with real evidence: 13px (matching comfortable) genuinely
    // overflows the widest real table in this app (16 columns, Review's by-transaction
    // view) — "Remember" gets cut off past the shell's edge. 12px is the largest size
    // confirmed NOT to overflow that table, tested against its real column headers at
    // the app's real max-width, and is still a real improvement over today's 10.5px.
    eyebrow: "12px",
    label: "12px",
    body: "13.5px",
    heading: "19px",
    hero: "21px",
    cardPadding: "12px",
    controlHeight: "36px",
    radius: "6px",
  },
};

// Shared shell patterns (Phase 2, backlog #41/#45): every non-Home screen gets this
// header shape, including the persistent "Home" control agreed for every domain screen.
export const shell = {
  pageHeaderHasBackToHome: true,
  backToHomeLabel: "\u2190 Home",
};
