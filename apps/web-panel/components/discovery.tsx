"use client";
import { useRef, useState } from "react";
import { themes } from "../../../packages/core/src/editorial/profile";
export function Discovery({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false),
    [theme, setTheme] = useState("gadgets"),
    [focus, setFocus] = useState(""),
    [days, setDays] = useState(7),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<number[]>([]);
  const [automatic, setAutomatic] = useState(false);
  const requests = useRef<Record<string, string>>({});
  async function run(index?: number) {
    setBusy(true);
    setError("");
    try {
      const key =
        index === undefined
          ? `search:${theme}:${focus}:${days}:${automatic}`
          : `save:${result.id}:${index}`;
      const requestId = (requests.current[key] ??= crypto.randomUUID());
      const payload =
        index === undefined
          ? {
              profile: { theme, focus, days, auto_discover: automatic },
              requestId,
            }
          : { action: "save", discoveryId: result.id, index, requestId };
      const r = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (index === undefined) {
        setResult(d);
        setSaved([]);
      } else {
        setSaved((v) => [...v, index]);
        onSaved();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pesquisa indisponível");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel studio-feature">
      <div className="studio-actions">
        <div>
          <h2>Qual assunto vamos explorar?</h2>
          <p>
            Encontre pautas específicas com fontes recentes. Você escolhe antes
            de gerar.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          Encontrar pautas
        </button>
      </div>
      {open && (
        <>
          <div className="studio-form-grid">
            <label>
              Tema
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                {Object.entries(themes).map(([id, v]) => (
                  <option key={id} value={id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Janela de pesquisa
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
              </select>
            </label>
          </div>
          <label>
            Seu recorte (opcional)
            <input
              value={focus}
              maxLength={500}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Ex.: acessórios para uma mesa pequena, público brasileiro"
            />
          </label>
          <label className="studio-check">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />
            Pesquisar diariamente e adicionar sugestões à fila, sem iniciar
            vídeos
          </label>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => run()}
          >
            {busy ? "Pesquisando fontes…" : "Pesquisar pautas"}
          </button>
          <p className="muted">
            Até 3 pesquisas por dia. Resultados por 24 horas. Fontes recentes
            são um sinal editorial, não uma garantia de audiência.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {result?.candidates?.length === 0 && (
            <p role="status">
              Não encontramos evidência suficiente para uma pauta específica.
              Tente outro recorte.
            </p>
          )}
          <div className="studio-candidates">
            {result?.candidates?.map((c: any, i: number) => (
              <article key={c.title}>
                <h3>{c.title}</h3>
                <p>
                  <strong>Gancho:</strong> {c.hook}
                </p>
                <p>{c.angle}</p>
                <p>
                  <strong>Por que agora:</strong> {c.why_now}
                </p>
                <p>
                  <strong>Limitação:</strong> {c.limitation}
                </p>
                <blockquote>{c.evidence_quote}</blockquote>
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Conferir fonte
                </a>
                <p className="muted">
                  Data da fonte: {c.published_at || "não informada"}. Consultada
                  em {new Date(c.checked_at).toLocaleDateString("pt-BR")}.
                </p>
                <button
                  className="button secondary"
                  disabled={busy || saved.includes(i)}
                  onClick={() => run(i)}
                >
                  {saved.includes(i)
                    ? "Adicionada à fila"
                    : "Escolher e adicionar à fila"}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
