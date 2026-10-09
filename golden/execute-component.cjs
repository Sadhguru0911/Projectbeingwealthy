#!/usr/bin/env node
/**
 * Actually EXECUTES the main component's function body (BeingWealthyLedger),
 * with React's hooks minimally stubbed, catching runtime errors - especially
 * temporal-dead-zone ("Cannot access 'x' before initialization") bugs - that
 * NONE of the other checks in this project can see.
 *
 * Why this exists: a real production failure reached the person directly
 * ("app is not loading... Cannot access 'goalsTrackingForHome' before
 * initialization") that every existing check missed. esbuild's compile check
 * only verifies SYNTAX; it does not execute the code, so a `const` referenced
 * before its own declaration line compiles cleanly and only fails at runtime,
 * in a real browser, when React actually calls the component function. This
 * sandbox has no browser to catch that - but React's hooks are simple enough
 * to stub that the component function can be CALLED directly in plain Node,
 * and JS's real TDZ semantics do the rest: if a `const` is used before its
 * declaration executes, this throws the exact same ReferenceError a browser
 * would, for the same real reason - not a simulation of the bug class, an
 * actual instance of hitting it.
 *
 * Hooks are stubbed just enough for this purpose, not to be a real React:
 * useState returns [initial value, a no-op setter] - the FIRST call always
 * matters here, since a fresh render is exactly what this replicates.
 * useMemo/useCallback call their function immediately (React always does,
 * on a first render - memoization only skips it on a RE-render, irrelevant
 * here). useEffect/useRef are no-ops/plain boxes. JSX (React.createElement)
 * returns a harmless marker object rather than building a real element tree.
 *
 * UPGRADED after a second real production failure this was specifically
 * documented as unable to catch: "Rendered more hooks than during the
 * previous render" - a hook called AFTER a conditional early return
 * (`if (view === "landing") return ...`), so the landing render skipped it
 * entirely while every OTHER render called it, violating React's Rules of
 * Hooks. The earlier version of this file only ever called the component
 * ONCE, with view="landing" - it would hit the early return and never run
 * the code after it at all, so this exact bug compiled clean, ran clean on
 * this check, and only broke in a real browser the moment a person clicked
 * past the landing page. That failure mode was already named in this file's
 * own comments ("NOT every view/state combination") - predicted, then hit
 * in practice, now closed rather than left as a known gap.
 *
 * This now calls the component TWICE - once with its real default state
 * (view="landing"), once with `view`'s own useState call forced to return a
 * different value instead - and counts every hook call during each pass.
 * This is a faithful simulation of the actual sequence that broke: a real
 * mounted component re-rendering after `setView` changes `view` away from
 * "landing" is EXACTLY two renders of the same function with different
 * state, which is precisely what React's own Rules-of-Hooks check compares.
 * If the two passes call a different NUMBER of hooks, that's this bug class,
 * caught directly rather than inferred.
 *
 * Run: node golden/execute-component.cjs
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const Module = require("module");

const ESBUILD_BIN = "/home/claude/.npm-global/lib/node_modules/tsx/node_modules/.bin/esbuild";

function buildBundle() {
  const repoRoot = path.resolve(__dirname, "..");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-exec-"));
  for (const f of ["src/App.jsx", "src/storage.js", "src/pdfExtract.js"]) {
    fs.copyFileSync(path.join(repoRoot, f), path.join(tmpDir, path.basename(f)));
  }
  ["inference", "demo", "home", "onboarding", "ask", "intake"].forEach((sub) => {
    const srcDir = path.join(repoRoot, "src", sub);
    if (!fs.existsSync(srcDir)) return;
    fs.mkdirSync(path.join(tmpDir, sub), { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      if (f.endsWith(".js") || f.endsWith(".jsx")) fs.copyFileSync(path.join(srcDir, f), path.join(tmpDir, sub, f));
    }
  });
  const outFile = path.join(tmpDir, "bundle.cjs");
  execFileSync(ESBUILD_BIN, [
    "--define:__APP_VERSION__=\"0.0.0-exec-check\"",
    "--bundle", "--format=cjs", "--platform=node",
    "--jsx-factory=__jsx", "--jsx-fragment=__jsxFrag",
    "--external:react", "--external:react-dom", "--external:papaparse",
    "--external:recharts", "--external:lucide-react", "--external:xlsx",
    "--external:jszip", "--external:pdfjs-dist", "--external:pdfjs-dist/*",
    path.join(tmpDir, "App.jsx"), "--outfile=" + outFile,
  ], { stdio: "pipe" });
  return outFile;
}

function run() {
  const bundlePath = buildBundle();

  // Stub every npm package the bundle imports but this check never needs to
  // actually render - same rationale as golden/stubs/, but built inline here
  // since this file's require() interception needs to be set up before the
  // bundle loads, in this same process (not a child process this time - we
  // need the JSX stubs, __jsx/__jsxFrag, defined as real globals the bundled
  // code's compiled output calls directly).
  const Module_load = Module._load;
  const stubbed = { "papaparse": {}, "recharts": {}, "lucide-react": new Proxy({}, { get: () => (() => null) }), "xlsx": {}, "jszip": {}, "pdfjs-dist": { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error("stub")) }) } };
  Module._load = function (request, ...rest) {
    if (request.includes("?")) return {};
    if (request === "react") return REACT_STUB;
    if (request === "react-dom") return {};
    if (stubbed[request] !== undefined) return stubbed[request];
    if (request.startsWith("pdfjs-dist/")) return {};
    return Module_load.call(this, request, ...rest);
  };
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.includes("?")) return request;
    return origResolve.call(this, request, ...rest);
  };

  // Minimal hook stubs, now logging every call (name + a cheap fingerprint of
  // its position in the sequence) into whatever array `hookLog` currently
  // points at - swapped between passes below. `forceNonLanding` makes the
  // `view` useState call (identified by its literal real default, "landing" -
  // the exact string this app's own `useState("landing")` call uses) return
  // a different value, without needing to track call-position numbers, which
  // would be fragile against unrelated edits elsewhere in the file.
  let hookLog = [];
  let forceNonLanding = false;
  const REACT_STUB = {
    useState: (initial) => { hookLog.push("useState"); const v = typeof initial === "function" ? initial() : initial; return [forceNonLanding && v === "landing" ? "cashflow" : v, () => {}]; },
    useEffect: () => { hookLog.push("useEffect"); },
    useMemo: (fn) => { hookLog.push("useMemo"); return fn(); },
    useCallback: (fn) => { hookLog.push("useCallback"); return fn; },
    useRef: (initial) => { hookLog.push("useRef"); return { current: initial }; },
    createElement: () => ({ __marker: "element" }),
    default: null,
  };
  REACT_STUB.default = REACT_STUB;
  global.__jsx = () => ({ __marker: "element" });
  global.__jsxFrag = () => ({ __marker: "element" });

  delete require.cache[require.resolve(bundlePath)];
  let mod;
  try {
    mod = require(bundlePath);
  } catch (e) {
    console.error("FAIL: module failed to even load:\n  " + e.message);
    process.exit(1);
  }

  const Component = mod.default || mod;
  if (typeof Component !== "function") {
    console.error("FAIL: default export is not a function component - got:", typeof Component);
    process.exit(1);
  }

  let landingHooks, nonLandingHooks;
  try {
    hookLog = []; forceNonLanding = false;
    Component({});
    landingHooks = hookLog.slice();
  } catch (e) {
    console.error("FAIL: BeingWealthyLedger threw a real runtime error on its default render path (view: \"landing\"):");
    console.error("  " + e.message);
    console.error(e.stack.split("\n").slice(1, 5).join("\n"));
    process.exit(1);
  }

  try {
    hookLog = []; forceNonLanding = true;
    Component({});
    nonLandingHooks = hookLog.slice();
  } catch (e) {
    console.error("FAIL: BeingWealthyLedger threw a real runtime error once `view` moves off \"landing\"");
    console.error("(simulating the real sequence after setView fires, e.g. clicking \"Get Started\"):");
    console.error("  " + e.message);
    console.error(e.stack.split("\n").slice(1, 5).join("\n"));
    process.exit(1);
  }

  if (landingHooks.length !== nonLandingHooks.length) {
    console.error("FAIL: hook count differs between the landing render (" + landingHooks.length + " hooks) and a");
    console.error("non-landing render (" + nonLandingHooks.length + " hooks) of the SAME component - this is exactly");
    console.error("\"Rendered more/fewer hooks than during the previous render\", the real error a browser");
    console.error("throws the moment a person's state changes away from the default. Likely cause: a hook");
    console.error("call sits after a conditional early return (e.g. `if (view === \"landing\") return ...`)");
    console.error("instead of before every early return, as React's Rules of Hooks require.");
    const minLen = Math.min(landingHooks.length, nonLandingHooks.length);
    for (let i = 0; i < minLen; i++) {
      if (landingHooks[i] !== nonLandingHooks[i]) { console.error("First mismatch at hook #" + (i + 1) + ": landing=" + landingHooks[i] + " vs non-landing=" + nonLandingHooks[i]); break; }
    }
    process.exit(1);
  }

  console.log("PASS: BeingWealthyLedger executed cleanly on both the default render path (view: \"landing\")");
  console.log("and a non-landing render, with an IDENTICAL hook count (" + landingHooks.length + ") on both -");
  console.log("the real check a browser performs on a state transition, simulated directly rather than");
  console.log("inferred. This still does not exercise every view/state combination beyond these two -");
  console.log("a real browser remains the only fully complete check.");
}

run();
