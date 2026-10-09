/**
 * Loads the REAL, currently-committed src/App.jsx (via esbuild, same
 * toolchain used for every compile-check throughout this project) and lets
 * golden-number tests call its pure engine functions (exposed on
 * globalThis.__BW_TEST_EXPORTS__ by the guarded footer at the end of
 * App.jsx). This never re-implements or copies engine logic - it exercises
 * the exact shipped source, so a golden-number test genuinely catches a
 * behaviour change in the real file, not in some parallel copy of it that
 * could silently drift out of sync.
 *
 * Node has no Vite/browser context, so two things are stubbed rather than
 * installed: (1) npm packages App.jsx imports but the pure engine functions
 * never call (papaparse, recharts, lucide-react, xlsx, jszip, pdfjs-dist) -
 * see golden/stubs/ - and (2) Vite's `?url` asset-import syntax, which means
 * nothing to plain Node resolution.
 *
 * Each call runs in its own child process (golden/inner-runner.cjs), with
 * NODE_PATH set in that child's environment from the moment it starts -
 * NODE_PATH is only honoured at process start, so mutating it from an
 * already-running process is unreliable and was deliberately not used here.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");

const ESBUILD_BIN = "/home/claude/.npm-global/lib/node_modules/tsx/node_modules/.bin/esbuild";
const STUBS_DIR = path.join(__dirname, "stubs");
const GLOBAL_NPM_DIR = "/home/claude/.npm-global/lib/node_modules";

let cachedBundlePath = null;

function buildBundle() {
  if (cachedBundlePath && fs.existsSync(cachedBundlePath)) return cachedBundlePath;
  const repoRoot = path.resolve(__dirname, "..");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-golden-"));
  for (const f of ["src/App.jsx", "src/storage.js", "src/pdfExtract.js"]) {
    fs.copyFileSync(path.join(repoRoot, f), path.join(tmpDir, path.basename(f)));
  }
  // App.jsx also imports from ./inference/ (Merchant Library v2, backlog #47) and
  // ./demo/ (demo mode UI wiring, backlog #39) - preserve both subdirectories under
  // tmpDir so the relative imports still resolve. Copies every .js file in each
  // directory (not an enumerated list) so a future new file there doesn't silently
  // need this updated again - only a NEW subdirectory would.
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
    "--define:__APP_VERSION__=\"0.0.0-golden\"",
    "--bundle", "--format=cjs", "--platform=node",
    "--external:react", "--external:react-dom", "--external:papaparse",
    "--external:recharts", "--external:lucide-react", "--external:xlsx",
    "--external:jszip", "--external:pdfjs-dist", "--external:pdfjs-dist/*",
    path.join(tmpDir, "App.jsx"), "--outfile=" + outFile,
  ], { stdio: "pipe" });
  cachedBundlePath = outFile;
  return outFile;
}

/** Calls a real, exported engine function with the given args (an array),
 *  in a fresh child process, and returns its JSON-serializable result. */
function callEngine(fnName, args) {
  const bundlePath = buildBundle();
  const runnerPath = path.join(__dirname, "inner-runner.cjs");
  const out = execFileSync(
    process.execPath,
    [runnerPath, bundlePath, fnName, JSON.stringify(args)],
    {
      env: Object.assign({}, process.env, { NODE_PATH: [STUBS_DIR, GLOBAL_NPM_DIR].join(path.delimiter) }),
      encoding: "utf8",
    }
  );
  const parsed = JSON.parse(out.trim());
  if (!parsed.__ok__) throw new Error(fnName + "(" + JSON.stringify(args) + ") failed: " + parsed.error);
  return parsed.result;
}

module.exports = { callEngine, buildBundle };
