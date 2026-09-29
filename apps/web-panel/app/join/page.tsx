"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export default function Join() {
  const [enabled, setEnabled] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/signup")
      .then((r) => r.json())
      .then((d) => setEnabled(d.enabled));
  }, []);
  return (
    <main className="legal">
      <h1>Crie seu Studio</h1>
      <p>Escolha assuntos, produza vídeos e revise tudo em um só lugar.</p>
      {!enabled ? (
        <p>
          Estamos preparando a abertura para novas contas. Você pode entrar se
          já recebeu acesso.
        </p>
      ) : (
        <form
          method="post"
          action="/api/signup"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const r = await fetch("/api/signup", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(Object.fromEntries(f)),
                }),
                d = await r.json();
              setMessage(d.message || d.error);
            } catch {
              setMessage("Conexão indisponível. Tente novamente.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Nome do Studio
            <input name="name" required minLength={2} maxLength={100} />
          </label>
          <label>
            E-mail
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={200}
              autoComplete="new-password"
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Criando…" : "Criar conta"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        <Link href="/login">Já tenho conta · entrar</Link>
      </p>
    </main>
  );
}
