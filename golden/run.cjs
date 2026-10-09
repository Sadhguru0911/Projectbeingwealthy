#!/usr/bin/env node
/**
 * Golden-number regression check (migration plan Phase 0, backlog #45/#16).
 *
 * Usage:
 *   node golden/run.cjs           - check current App.jsx against golden.json
 *   node golden/run.cjs --update  - recompute and overwrite golden.json
 *     (only ever run --update deliberately, after confirming a change in
 *     the numbers is intentional - this file is the safety net itself)
 */
const fs = require("fs");
const path = require("path");
const { callEngine } = require("./load-engine.cjs");
const fixtures = require("./fixtures.cjs");

const GOLDEN_PATH = path.join(__dirname, "golden.json");
const isUpdate = process.argv.includes("--update");

function run() {
  const results = fixtures.map((f) => {
    let value, error = null;
    try {
      value = callEngine(f.fn, f.args);
    } catch (e) {
      error = e.message;
    }
    return { fn: f.fn, label: f.label, args: f.args, value, error };
  });

  if (isUpdate) {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(results, null, 2) + "\n");
    console.log(`Wrote ${results.length} golden fixture(s) to ${path.relative(process.cwd(), GOLDEN_PATH)}`);
    return;
  }

  if (!fs.existsSync(GOLDEN_PATH)) {
    console.error("No golden.json committed yet - run with --update first.");
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
  let failures = 0;
  results.forEach((r, i) => {
    const g = golden[i];
    const same = g && JSON.stringify(g.value) === JSON.stringify(r.value) && g.error === r.error;
    const status = same ? "PASS" : "FAIL";
    if (!same) failures++;
    console.log(`[${status}] ${r.fn} - ${r.label}`);
    if (!same) {
      console.log(`  expected: ${JSON.stringify(g ? g.value : undefined)}${g && g.error ? " (error: " + g.error + ")" : ""}`);
      console.log(`  actual:   ${JSON.stringify(r.value)}${r.error ? " (error: " + r.error + ")" : ""}`);
    }
  });
  console.log(`\n${results.length - failures}/${results.length} passed.`);
  if (failures > 0) process.exit(1);
}

run();
