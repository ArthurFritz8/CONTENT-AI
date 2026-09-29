import { createHash, randomBytes } from "node:crypto";
import { appUrl, db } from "./server";
import { PanelError } from "./security.mjs";
import { studioRpc } from "./workspace";
export const digest = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const nonce = () => randomBytes(32).toString("base64url");
export function oauthConfig() {
  const id = process.env.BUFFER_CLIENT_ID,
    secret = process.env.BUFFER_CLIENT_SECRET;
  if (!id || !secret)
    throw new PanelError(
      "A conexão está em preparação. O administrador precisa concluir o cadastro do aplicativo no Buffer.",
      503,
    );
  return {
    id,
    secret,
    redirect: `${new URL(appUrl()).origin}/api/buffer/callback`,
  };
}
export async function exchangeToken(fields: Record<string, string>) {
  const c = oauthConfig();
  const r = await fetch("https://auth.buffer.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.id,
      client_secret: c.secret,
      ...fields,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => null);
  if (
    !r.ok ||
    typeof d?.access_token !== "string" ||
    typeof d?.refresh_token !== "string" ||
    !Number.isFinite(d?.expires_in)
  )
    throw new PanelError(
      "Não foi possível confirmar a conexão Buffer. Conecte novamente.",
      502,
    );
  return { ...d, expires_at: Date.now() + d.expires_in * 1000 };
}
export async function bufferToken(workspace: string) {
  let token = await studioRpc("studio_read_secret", {
    p_workspace: workspace,
    p_provider: "buffer",
  });
  if (!token) throw new PanelError("Conecte sua conta Buffer.", 409);
  if (token.expires_at > Date.now() + 90000)
    return token.access_token as string;
  const locked = await studioRpc("studio_claim_refresh", {
    p_workspace: workspace,
  });
  if (!locked)
    throw new PanelError(
      "Conexão em atualização. Aguarde; se persistir, reconecte o Buffer.",
      409,
    );
  try {
    token = await studioRpc("studio_read_secret", {
      p_workspace: workspace,
      p_provider: "buffer",
    });
    if (token.expires_at <= Date.now() + 90000) {
      token = await exchangeToken({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      });
      await studioRpc("studio_store_secret", {
        p_workspace: workspace,
        p_provider: "buffer",
        p_value: token,
      });
    }
    await db(
      "studio_connections",
      { workspace_id: `eq.${workspace}`, provider: "eq.buffer" },
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ refresh_claimed_at: null }),
      },
    );
    return token.access_token as string;
  } catch (e) {
    await db(
      "studio_connections",
      { workspace_id: `eq.${workspace}`, provider: "eq.buffer" },
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "reconnect" }),
      },
    );
    throw e;
  }
}
export async function bufferQuery(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const r = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.data || d.errors?.length)
    throw new PanelError(
      "O Buffer não confirmou a consulta. Tente novamente.",
      502,
    );
  return d.data;
}
export async function syncChannels(workspace: string) {
  const token = await bufferToken(workspace),
    account = await bufferQuery(
      token,
      "query { account { organizations { id } } }",
    );
  const channels = [];
  for (const org of (account.account?.organizations || []).slice(0, 10)) {
    const result = await bufferQuery(
      token,
      "query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }",
      { input: { organizationId: org.id } },
    );
    channels.push(
      ...(result.channels || []).filter((c: any) =>
        ["tiktok", "youtube"].includes(c.service),
      ),
    );
  }
  await db(
    "studio_channels",
    { workspace_id: `eq.${workspace}` },
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ enabled: false }),
    },
  );
  for (const c of channels) {
    await db(
      "studio_channels",
      { on_conflict: "workspace_id,external_id" },
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          workspace_id: workspace,
          external_id: c.id,
          platform: c.service,
          name: c.name,
          enabled: true,
        }),
      },
    );
  }
  return channels.length;
}
