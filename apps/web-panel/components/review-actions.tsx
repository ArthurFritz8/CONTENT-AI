"use client";
import { useEffect, useRef, useState } from "react";
export function ReviewActions({
  episode,
  onChange,
}: {
  episode: string;
  onChange: () => void;
}) {
  const [review, setReview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]),
    [checked, setChecked] = useState(false),
    [instructions, setInstructions] = useState("");
  const [channels, setChannels] = useState<string[]>([]),
    [dueAt, setDueAt] = useState("");
  const pending = useRef<{ body: string; id: string } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/review?episode=${episode}`, {
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setReview(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [episode]);
  async function act(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    const payload = {
      episode,
      review: review.id,
      fingerprint: review.fingerprint,
      action,
      platforms,
      instructions,
      channels,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    };
    const key = JSON.stringify(payload);
    if (pending.current?.body !== key)
      pending.current = { body: key, id: crypto.randomUUID() };
    try {
      const r = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, requestId: pending.current.id }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setMessage(
        action === "approve"
          ? platforms.length + channels.length
            ? "Aprovado. O agendamento será processado; acompanhe em Publicações."
            : "Revisão aprovada e salva. Nenhuma publicação foi solicitada."
          : action === "adjust"
            ? "Nova versão solicitada. Ela precisará de outra revisão."
            : "Decisão registrada.",
      );
      pending.current = null;
      setChecked(false);
      setReview((v: any) => ({
        ...v,
        decision: action === "approve" ? "approved" : "superseded",
      }));
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao registrar revisão.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel studio-feature">
      <h2>Revisar e decidir</h2>
      <p>
        Confira os vídeos, o roteiro e as fontes acima. Esta decisão vale
        somente para esta versão.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {review && ["pending", "approved"].includes(review.decision) && (
        <>
          <fieldset disabled={busy}>
            <legend>Onde autorizar a publicação</legend>
            {review.platforms.map((p: string) => (
              <label key={p} className="studio-check">
                <input
                  type="checkbox"
                  checked={platforms.includes(p)}
                  onChange={(e) =>
                    setPlatforms((v) =>
                      e.target.checked ? [...v, p] : v.filter((x) => x !== p),
                    )
                  }
                />
                {p === "youtube" ? "YouTube Shorts" : "TikTok"}
                {review.consent?.[p] ? " — já autorizado" : ""}
              </label>
            ))}
            {review.channels?.map((c: any) => (
              <label key={c.id} className="studio-check">
                <input
                  type="checkbox"
                  checked={channels.includes(c.id)}
                  onChange={(e) =>
                    setChannels((v) =>
                      e.target.checked
                        ? [...v, c.id]
                        : v.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.name} · {c.platform}
              </label>
            ))}
            {channels.length > 0 && platforms.length === 0 && (
              <label>
                Data específica (opcional, no seu fuso:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone})
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </label>
            )}
            <p className="muted">
              Sem canais selecionados, a aprovação fica salva sem publicar. Os
              canais selecionados usam a próxima vaga da agenda do Buffer.
            </p>
          </fieldset>
          <label className="studio-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            Conferi conteúdo, imagens, direitos de uso e os canais selecionados.
          </label>
          <div className="studio-actions">
            <button
              className="button primary"
              disabled={busy || !checked}
              onClick={() => act("approve")}
            >
              {busy
                ? "Registrando…"
                : platforms.length + channels.length
                  ? "Aprovar e agendar"
                  : "Aprovar sem publicar"}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => act("reject")}
            >
              Reprovar
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => act("rerender")}
            >
              Refazer render
            </button>
          </div>
          <details>
            <summary>Pedir ajuste no conteúdo</summary>
            <label>
              O que precisa mudar?
              <textarea
                value={instructions}
                maxLength={2000}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Descreva a correção. Uma nova versão será gerada e revisada."
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || instructions.trim().length < 10}
              onClick={() => act("adjust")}
            >
              Criar versão ajustada
            </button>
            <p className="muted">
              Usa a cota de produção. Refazer render mantém o roteiro; ajustar
              conteúdo gera uma nova versão.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
