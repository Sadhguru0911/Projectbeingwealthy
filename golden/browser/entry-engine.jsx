import { createRoot } from "react-dom/client";
import { useState } from "react";
import OnboardingFlow from "../../src/onboarding/OnboardingFlow.jsx";
import { rawBankRows, ASHA_HISTORY_END } from "../../src/demo/ashaStatement.js";
// Engine functions are answered from a table the node runner computed with the REAL App.jsx functions
// (the full App cannot be bundled for a browser here) - same inputs, same outputs, no re-implementation.
const MAP = window.__ENGINE_MAP;
const k = (d) => d.replace(/\d+/g, "#");
const FC = window.__FORECASTS;
const source = { rows: rawBankRows, historyEnd: ASHA_HISTORY_END, forecast: (h, fee, ins) => { const r = FC[h + "|" + fee + "|" + ins]; if (!r) throw new Error("no forecast for " + h + "|" + fee + "|" + ins); return r; }, engine: {
  matchRule: (d) => MAP.desc[k(d)].rule, seedRules: () => [], findLibraryEntry: (d) => MAP.desc[k(d)].lib, normalizeMerchant: (d) => MAP.norm[k(d)] } };
function App() {
  const [household, setHousehold] = useState({ me: true });
  const [priority, setPriority] = useState(null);
  return <OnboardingFlow demo={true} journeySource={source} household={household} setHousehold={setHousehold} priority={priority} setPriority={setPriority}
    setHouseholdAnswered={() => {}} onStartUpload={() => {}} onTryDemo={() => {}} onExitDemo={() => {}} onFinish={(info) => { window.__finished = info || true; }} />;
}
createRoot(document.getElementById("root")).render(<App />);
