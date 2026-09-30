import {
  appUrl,
  body,
  config,
  db,
  errorResponse,
  requireUser,
} from "../../../lib/server";
import { assertOrigin, PanelError } from "../../../lib/security.mjs";
import { LEGACY_WORKSPACE, workspaceDb } from "../../../lib/workspace";
import { syncChannels } from "../../../lib/buffer-oauth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await requireUser(),
      read = workspaceDb(user);
    const [channels, connections, workspace] = await Promise.all([
      read("studio_channels", { select: "id,name,platform,enabled,timezone" }),
      read("studio_connections", { select: "provider,status,metadata" }),
      db("studio_workspaces", {
        select: "name,settings",
        id: `eq.${user.workspaceId}`,
      }),
    ]);
    const posts = (
      await read("studio_outbox", {
        select: "id,episode_id,channel_id,status,due_at,error_code",
        order: "created_at.desc",
        limit: "30",
      })
    ).data;
    const legacy = user.workspaceId === LEGACY_WORKSPACE;
    const current = legacy
      ? (
          await db("system_config", {
            select: "key,value",
            key: "in.(buffer_tiktok,buffer_youtube,telegram)",
          })
        ).data
      : [];
    return Response.json(
      {
        name: workspace.data[0]?.name,
        profile: workspace.data[0]?.settings?.editorial,
        legacy,
        posts: posts.map((p: any) => ({
          ...p,
          channel_name:
            channels.data.find((c: any) => c.id === p.channel_id)?.name ||
            "Canal",
        })),
        oauthReady: Boolean(
          process.env.BUFFER_CLIENT_ID && process.env.BUFFER_CLIENT_SECRET,
        ),
        channels: channels.data,
        connections: connections.data.map((c: any) => ({
          provider: c.provider,
          status:
            c.provider === "telegram" && !c.metadata?.chat_id
              ? "pending"
              : c.status,
          username:
            c.provider === "telegram" ? c.metadata?.username : undefined,
        })),
        legacyChannels: current
          .filter((c: any) => c.key.startsWith("buffer_") && c.value.enabled)
          .map((c: any) => c.key.replace("buffer_", "")),
        legacyTelegram: current.some(
          (c: any) => c.key === "telegram" && c.value.enabled,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const user = await requireUser(),
      input = await body(request);
    if (input.action === "sync") {
      const count = await syncChannels(user.workspaceId);
      return Response.json({ count });
    }
    if (input.action === "disconnect") {
      if (!["buffer", "telegram"].includes(input.provider))
        throw new PanelError("Conexão inválida.");
      await db(
        "studio_connections",
        {
          workspace_id: `eq.${user.workspaceId}`,
          provider: `eq.${input.provider}`,
        },
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: "disconnected",
            metadata: {},
            refresh_claimed_at: null,
          }),
        },
      );
      if (input.provider === "buffer")
        await db(
          "studio_channels",
          { workspace_id: `eq.${user.workspaceId}` },
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ enabled: false }),
          },
        );
      return Response.json({ ok: true });
    }
    if (input.action !== "telegram") throw new PanelError("Ação inválida.");
    const c = config();
    const r = await fetch(`${c.url}/functions/v1/studio-telegram`, {
      method: "POST",
      headers: {
        apikey: c.service,
        Authorization: `Bearer ${c.service}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspace: user.workspaceId,
        actor: user.id,
        mode: input.mode,
        token: input.token || undefined,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      throw new PanelError(
        d?.code === "WEBHOOK_IN_USE"
          ? "Esse bot já está em outro serviço. Crie um bot dedicado ao Studio."
          : "Não foi possível preparar o Telegram. Confira o token ou tente novamente.",
        r.status === 429 ? 429 : 409,
      );
    }
    return Response.json(await r.json());
  } catch (e) {
    return errorResponse(e);
  }
}
