import { createRoot } from "react-dom/client";
import { useState } from "react";
import OnboardingFlow from "../../src/onboarding/OnboardingFlow.jsx";
function App() {
  const params = new URLSearchParams(location.search);
  const [household, setHousehold] = useState({ me: true });
  const [priority, setPriority] = useState(null);
  const [priorities, setPriorities] = useState([]);
  const [answered, setAnswered] = useState(false);
  window.__state = { household, priority, answered };
  return <OnboardingFlow demo={params.get("demo") === "1"} household={household} setHousehold={setHousehold}
    priority={priority} setPriority={setPriority} priorities={priorities} setPriorities={setPriorities} householdAnswered={answered} setHouseholdAnswered={setAnswered}
    onPickFile={(f) => { window.__picked = f ? f.name : null; }}
    onStartUpload={(f) => { window.__upload = true; window.__uploadFile = f ? f.name : null; }} onTryDemo={() => { window.__demoClicked = true; }}
    onExitDemo={() => { window.__exited = true; }} onFinish={(info) => { window.__finished = info || true; }} />;
}
createRoot(document.getElementById("root")).render(<App />);
