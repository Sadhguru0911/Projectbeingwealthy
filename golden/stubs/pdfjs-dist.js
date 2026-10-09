// Realistic-enough shape so App.jsx's top-level
// `pdfjsLib.GlobalWorkerOptions.workerSrc = ...` (a real module-scope side
// effect, needed for the browser PDF viewer) can assign without throwing
// when the module is loaded outside a browser/Vite context. Golden-number
// tests never call PDF-reading code paths, so nothing else needs to work.
module.exports = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(new Error("stub")) }) };
