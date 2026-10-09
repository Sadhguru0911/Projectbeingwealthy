// Test stub: no real pdf.js. A test can set window.__BW_FAKE_PDF to a fake document (numPages/getPage); otherwise getDocument behaves as before.
export const GlobalWorkerOptions={},getDocument=()=>(typeof window!=="undefined"&&window.__BW_FAKE_PDF?{promise:Promise.resolve(window.__BW_FAKE_PDF)}:{});
