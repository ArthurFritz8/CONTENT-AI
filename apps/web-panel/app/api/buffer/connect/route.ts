import { appUrl, db, errorResponse, requireUser } from "../../../../lib/server";
import { assertOrigin } from "../../../../lib/security.mjs";
import { digest, nonce, oauthConfig } from "../../../../lib/buffer-oauth";
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const u = await requireUser(),
      c = oauthConfig(),
      state = nonce(),
      verifier = nonce();
    await db(
      "studio_oauth_states",
      {},
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          workspace_id: u.workspaceId,
          actor: u.id,
          state_hash: digest(state),
          verifier,
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
      },
    );
    const url = new URL("https://auth.buffer.com/auth");
    const challenge = Buffer.from(digest(verifier), "hex").toString(
      "base64url",
    );
    url.search = new URLSearchParams({
      client_id: c.id,
      redirect_uri: c.redirect,
      response_type: "code",
      scope: "account:read posts:read posts:write offline_access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return Response.json({ url: url.href });
  } catch (e) {
    return errorResponse(e);
  }
}
