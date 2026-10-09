/**
 * Runs INSIDE a child process spawned by load-engine.cjs, with NODE_PATH
 * already set correctly in its environment (NODE_PATH only takes effect if
 * present before the Node process starts - mutating process.env from
 * within an already-running process does not reliably reach module
 * resolution, which is why this is a separate process rather than an
 * in-process require()). Reads: [bundlePath, functionName, jsonArgs] from
 * argv. Prints exactly one line of JSON to stdout: the function's result,
 * or {"__error__": message}.
 */
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.includes("?")) return request; // Vite-only asset-URL syntax
  return origResolve.call(this, request, ...rest);
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request.includes("?")) return {};
  return origLoad.call(this, request, ...rest);
};

const [, , bundlePath, fnName, jsonArgs] = process.argv;
try {
  require(bundlePath);
  const exported = globalThis.__BW_TEST_EXPORTS__;
  if (!exported) throw new Error("__BW_TEST_EXPORTS__ missing - test-export footer may be gone from App.jsx");
  const fn = exported[fnName];
  if (typeof fn !== "function") throw new Error("No exported engine function named " + fnName);
  const args = JSON.parse(jsonArgs);
  const result = fn(...args);
  process.stdout.write(JSON.stringify({ __ok__: true, result }));
} catch (e) {
  process.stdout.write(JSON.stringify({ __ok__: false, error: e.message }));
}
