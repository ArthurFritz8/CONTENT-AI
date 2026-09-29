"use client";
import { useEffect, useState } from "react";
export function ScheduledPosts() {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/connections")
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw Error(d.error);
          if (active) setRows(d.posts || []);
        })
        .catch(() => {
          if (active)
            setError("Não foi possível consultar os novos agendamentos.");
        });
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (!rows.length && !error) return null;
  return (
    <section className="panel studio-feature">
      <h2>Agendamentos dos seus canais</h2>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <article key={r.id}>
          <p>
            <a href={`/studio/episodes/${r.episode_id}`}>
              Vídeo #{r.episode_id.slice(0, 8)}
            </a>{" "}
            · {r.channel_name} ·{" "}
            {
              (
                {
                  pending: "aguardando envio",
                  sending: "enviando",
                  scheduled: "agendado",
                  published: "publicado",
                  failed: "falhou",
                  uncertain: "resultado incerto — conferir no Buffer",
                } as Record<string, string>
              )[r.status]
            }
          </p>
          <p className="muted">
            {r.due_at
              ? new Date(r.due_at).toLocaleString()
              : "Próxima vaga da agenda do Buffer"}
            {r.error_code ? ` · ${r.error_code}` : ""}
          </p>
        </article>
      ))}
    </section>
  );
}
