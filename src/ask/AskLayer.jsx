import { useEffect, useRef, useState } from "react";
import { HOME_CSS } from "./askStyles.js";
import { ASK_INTRO, ASK_PROMISE, suggestions, askQ, messageFor, msgHTML } from "./askEngine.js";

/**
 * The prototype's Ask surface (backlog #75): the floating "Ask about your money" bar, the slide-in panel with
 * suggestion chips, the thread of answers and the question box. CSS is extracted verbatim from the 29 Sep
 * artifact (src/ask/askStyles.js, scoped to .home-root); answer markup comes from askEngine.js, which is a
 * port of the prototype's own templates. `ask` ({ open, thread }) lives in the parent so a "Why?" link on Home
 * can open the panel on a specific question.
 */
export default function AskLayer({ facts, ask, setAsk }) {
  const [text, setText] = useState("");
  const bodyRef = useRef(null);
  const close = () => setAsk((a) => ({ ...a, open: false }));
  const push = (m) => setAsk((a) => ({ open: true, thread: [...a.thread, m] }));

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [ask.thread.length, ask.open]);
  useEffect(() => {
    if (!ask.open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setAsk((a) => ({ ...a, open: false })); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ask.open, setAsk]);

  const send = () => { const t = text.trim(); if (!t) return; setText(""); push(messageFor(facts, t, true)); };
  const onBodyClick = (e) => { const b = e.target.closest && e.target.closest("[data-fu]"); if (b) push(messageFor(facts, b.getAttribute("data-fu"), true)); };
  const bodyHTML = (ask.thread.length ? "" : '<p class="hi">' + ASK_INTRO + "</p>") + ask.thread.map((m) => msgHTML(facts, m)).join("");

  return (
    <div className="home-root">
      <style>{HOME_CSS}</style>
      {!ask.open && (
        <button className="askbar" onClick={() => setAsk({ open: true, thread: [] })}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>Ask about your money
        </button>
      )}
      {ask.open && (
        <>
          <div className="scrim" onClick={close} />
          <div className="askpanel" role="dialog" aria-label="Ask about your money">
            <div className="ah"><b>Ask about your money</b><button aria-label="Close" onClick={close}>&times;</button></div>
            <div className="ab" ref={bodyRef} onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: bodyHTML }} />
            <div className="af">
              <div className="chips">
                {suggestions(facts).map((id) => <button key={id} className="chip" onClick={() => push(messageFor(facts, id))}>{askQ(facts, id)}</button>)}
              </div>
              <div className="inrow">
                <input type="text" placeholder="Ask about your money…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
                <button className="btn" onClick={send}>Ask</button>
              </div>
              <p className="promise">{ASK_PROMISE}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
