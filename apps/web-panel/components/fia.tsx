"use client";
import { useEffect, useRef, useState } from "react";
import {
  guideFor,
  studioGuide,
} from "../../../packages/core/src/support/guide";
export function Fia({ section }: { section: string }) {
  const [open, setOpen] = useState(false),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState("guide");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  async function ask() {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, section }),
      });
      const d = await r.json();
      setAnswer(r.ok ? d.text : d.error);
      setMode(d.mode || "guide");
    } catch {
      setAnswer(guideFor(section).text);
      setMode("guide");
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="fia">
      <button
        className="fia-toggle"
        aria-expanded={open}
        aria-controls="fia-help"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Fechar Fia" : "Fia · precisa de ajuda?"}
      </button>
      {open && (
        <section id="fia-help" aria-label="Ajuda da Fia" className="fia-panel">
          <h2>Fia, sua guia no Studio</h2>
          <p>{guideFor(section).text}</p>
          <div className="fia-topics">
            {studioGuide.map((g) => (
              <button
                key={g.id}
                className="button small secondary"
                onClick={() => {
                  setAnswer(g.text);
                  setMode("guide");
                }}
              >
                {g.title}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <label htmlFor="fia-question">Qual é sua dúvida?</label>
            <input
              ref={input}
              id="fia-question"
              value={question}
              maxLength={1500}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ex.: como aprovar só no YouTube?"
            />
            <button
              className="button primary"
              disabled={busy || question.trim().length < 3}
            >
              {busy ? "Consultando…" : "Perguntar à Fia"}
            </button>
          </form>
          <p className="muted">
            Não envie senhas ou tokens. A Fia orienta; suas decisões ficam nos
            botões do painel.
          </p>
          {answer && (
            <div role="status">
              <small>
                {mode === "ai"
                  ? "Resposta assistida por IA — confira no painel"
                  : "Guia do Studio"}
              </small>
              <p className="preserve">{answer}</p>
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
