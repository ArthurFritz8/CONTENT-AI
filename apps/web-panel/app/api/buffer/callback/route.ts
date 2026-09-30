import { appUrl, db, errorResponse, requireUser } from "../../../../lib/server";
import { PanelError } from "../../../../lib/security.mjs";
import {
  digest,
  exchangeToken,
  oauthConfig,
  syncChannels,
} from "../../../../lib/buffer-oauth";
import { studioRpc } from "../../../../lib/workspace";
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      p = new URL(request.url).searchParams,
      state = p.get("state") || "",
      code = p.get("code");
    if (!/^[A-Za-z0-9_-]{43}$/.test(state))
      throw new PanelError("Conexão inválida. Recomece pelo painel.", 403);
    const { data } = await db(
      "studio_oauth_states",
      {
        state_hash: `eq.${digest(state)}`,
        workspace_id: `eq.${user.workspaceId}`,
        actor: `eq.${user.id}`,
        expires_at: `gt.${new Date().toISOString()}`,
      },
      { method: "DELETE", headers: { Prefer: "return=representation" } },
    );
    if (!data[0])
      throw new PanelError("Esta conexão expirou ou já foi usada.", 403);
    if (p.get("error") || !code)
      return Response.redirect(
        `${appUrl()}/studio/settings?buffer=cancelled`,
        303,
      );
    const tokens = await exchangeToken({
      grant_type: "authorization_code",
      code,
      code_verifier: data[0].verifier,
      redirect_uri: oauthConfig().redirect,
    });
    await studioRpc("studio_store_secret", {
      p_workspace: user.workspaceId,
      p_provider: "buffer",
      p_value: tokens,
    });
    await db(
      "studio_connections",
      { workspace_id: `eq.${user.workspaceId}`, provider: "eq.buffer" },
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ refresh_claimed_at: null }),
      },
    );
    await syncChannels(user.workspaceId);
    return Response.redirect(
      `${appUrl()}/studio/settings?buffer=connected`,
      303,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
