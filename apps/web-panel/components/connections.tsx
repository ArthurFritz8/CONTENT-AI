"use client";
import { useEffect, useState } from "react";
export function Connections() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [link, setLink] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/connections", { cache: "no-store" }),
        d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível consultar conexões.",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function act(action: string, mode?: string, provider?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(
        action === "buffer" ? "/api/buffer/connect" : "/api/connections",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            mode,
            provider,
            token: mode === "own" ? token : undefined,
          }),
        },
      );
      setToken("");
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (action === "buffer") {
        location.assign(d.url);
        return;
      }
      if (d.url) setLink(d.url);
      else
        setMessage(
          action === "sync"
            ? `${d.count} canais encontrados.`
            : "Conexão desconectada no Studio.",
        );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Conexão indisponível.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel studio-feature">
      <h2>Seu Studio, seus canais</h2>
      <p>
        1. Escolha o tema em Pautas. 2. Conecte seus canais. 3. Gere e revise o
        vídeo antes de agendar.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <h3>Buffer · TikTok e YouTube</h3>
      <p>
        Autorize sua conta na tela oficial do Buffer. Não é necessário copiar
        uma chave.
      </p>
      {data?.legacyChannels?.length > 0 && (
        <p>
          Canais atuais do operador: {data.legacyChannels.join(" e ")}. A
          integração atual permanece ativa.
        </p>
      )}
      {data?.connections
        ?.filter((c: any) => c.provider === "buffer")
        .map((c: any) => (
          <p key={c.provider}>
            Conexão:{" "}
            {c.status === "connected"
              ? "conectada"
              : c.status === "reconnect"
                ? "precisa reconectar"
                : c.status}
          </p>
        ))}
      <div className="studio-actions">
        <button
          className="button primary"
          disabled={busy || !data?.oauthReady}
          onClick={() => act("buffer")}
        >
          Conectar Buffer
        </button>
        <button
          className="button secondary"
          disabled={
            busy ||
            !data?.connections?.some(
              (c: any) => c.provider === "buffer" && c.status === "connected",
            )
          }
          onClick={() => act("sync")}
        >
          Atualizar canais
        </button>
        <a
          className="button secondary"
          href="https://publish.buffer.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Configurar horários no Buffer
        </a>
      </div>
      {data && !data.oauthReady && (
        <p className="muted">
          A conexão de novas contas aguarda o cadastro do aplicativo pelo
          administrador. Seus canais atuais continuam funcionando.
        </p>
      )}
      {data?.channels?.map((c: any) => (
        <p key={c.id}>
          {c.name} · {c.platform} · {c.enabled ? "disponível" : "desconectado"}
        </p>
      ))}
      <p className="muted">
        A agenda recorrente é definida no Buffer. Conectar canais não publica
        vídeos sem a sua aprovação.
      </p>
      <h3>Telegram · opcional</h3>
      <p>
        Você pode revisar tudo no site. Para receber avisos no Telegram, conecte
        com um link pessoal que expira em 10 minutos.
      </p>
      {data?.legacyTelegram && <p>O bot atual do operador continua ativo.</p>}
      {data?.connections
        ?.filter((c: any) => c.provider === "telegram")
        .map((c: any) => (
          <p key={c.provider}>
            {c.status === "connected"
              ? "Telegram conectado"
              : c.status === "pending"
                ? "Falta abrir o bot e pressionar Iniciar"
                : "Telegram desconectado"}
          </p>
        ))}
      <button
        className="button primary"
        disabled={busy}
        onClick={() => act("telegram", "shared")}
      >
        Conectar Telegram
      </button>
      {link && (
        <p>
          <a
            className="button secondary"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir bot e pressionar Iniciar
          </a>{" "}
          <button className="button secondary" onClick={() => load()}>
            Já iniciei · verificar
          </button>
        </p>
      )}
      <details>
        <summary>Prefiro meu próprio bot</summary>
        <ol>
          <li>
            Abra{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noopener noreferrer"
            >
              @BotFather
            </a>{" "}
            no Telegram e envie /newbot.
          </li>
          <li>Escolha um nome e um usuário terminado em bot.</li>
          <li>
            Cole o token no campo abaixo. O Studio valida e configura o
            recebimento das mensagens.
          </li>
          <li>Abra o link gerado e pressione Iniciar.</li>
        </ol>
        <label>
          Token do seu bot
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Cole aqui, nunca no chat de suporte"
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || token.length < 25}
          onClick={() => act("telegram", "own")}
        >
          Validar e conectar meu bot
        </button>
        <p className="muted">
          Use um bot dedicado: o Studio não substitui um webhook de outro
          serviço.
        </p>
      </details>
      {data?.connections?.length > 0 && (
        <details>
          <summary>Desconectar integrações</summary>
          {data.connections.map((c: any) => (
            <button
              key={c.provider}
              disabled={busy}
              className="button secondary"
              onClick={() => act("disconnect", undefined, c.provider)}
            >
              Desconectar {c.provider}
            </button>
          ))}
          <p>
            Posts já agendados devem ser cancelados no Buffer. A desconexão
            impede novos envios pelo Studio.
          </p>
        </details>
      )}
    </section>
  );
}
