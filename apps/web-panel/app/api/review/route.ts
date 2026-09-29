import {
  appUrl,
  body,
  config,
  db,
  errorResponse,
  requireUser,
} from "../../../lib/server";
import { assertOrigin, PanelError, uuid } from "../../../lib/security.mjs";
import {
  LEGACY_WORKSPACE,
  studioRpc,
  workspaceDb,
} from "../../../lib/workspace";
import { bufferTikTokPlan } from "../../../../../packages/core/src/publish/buffer-tiktok-plan";
import { bufferYoutubePlan } from "../../../../../packages/core/src/publish/buffer-youtube-plan";

export const dynamic = "force-dynamic";
async function reviewContext(id: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const own = await workspaceDb(user)("episodes", {
    id: `eq.${id}`,
    select: "id,status",
  });
  if (!own.data[0]) throw new PanelError("Vídeo não encontrado.", 404);
  const review = await studioRpc("studio_ensure_review", { p_episode: id });
  if (!review?.id)
    throw new PanelError(
      "O vídeo ainda não está disponível para revisão.",
      409,
    );
  const settings = (
    await db("system_config", {
      select: "key,value",
      key: "in.(youtube,buffer_tiktok,buffer_youtube)",
    })
  ).data;
  const cfg = Object.fromEntries(settings.map((r: any) => [r.key, r.value]));
  const ownChannels = (
    await workspaceDb(user)("studio_channels", {
      select: "id,name,platform",
      enabled: "eq.true",
    })
  ).data;
  const platforms: string[] = [];
  const channels: any[] = [];
  for (const platform of ["tiktok", "youtube"]) {
    try {
      if (platform === "tiktok")
        bufferTikTokPlan(review.snapshot, config().url);
      else bufferYoutubePlan(review.snapshot, cfg.youtube, config().url);
      channels.push(...ownChannels.filter((c: any) => c.platform === platform));
      if (
        user.workspaceId === LEGACY_WORKSPACE &&
        cfg[`buffer_${platform}`]?.enabled
      )
        platforms.push(platform);
    } catch {
      /* Preview remains available; invalid outputs cannot be scheduled. */
    }
  }
  return { user, review, platforms, channels };
}
export async function GET(request: Request) {
  try {
    const { review, platforms, channels } = await reviewContext(
      uuid(new URL(request.url).searchParams.get("episode")), await requireUser(),
    );
    return Response.json(
      {
        id: review.id,
        fingerprint: review.fingerprint,
        decision: review.decision,
        platforms,
        channels,
        consent: {
          tiktok: review.buffer_tiktok_consent,
          youtube: review.buffer_youtube_consent,
        },
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
    const user = await requireUser();
    const input = await body(request);
    const ctx = await reviewContext(uuid(input.episode), user);
    if (
      ctx.review.id !== uuid(input.review) ||
      ctx.review.fingerprint !== input.fingerprint
    )
      throw new PanelError(
        "O vídeo mudou. Atualize e revise a versão nova.",
        409,
      );
    const platforms: string[] = Array.isArray(input.platforms)
      ? [...new Set<string>(input.platforms)]
      : [];
    const channels: string[] = Array.isArray(input.channels)
      ? [...new Set<string>(input.channels)]
      : [];
    if (channels.some((id) => !ctx.channels.some((c) => c.id === id)))
      throw new PanelError("Canal não autorizado.", 403);
    if (input.dueAt && platforms.length)
      throw new PanelError(
        "Para os canais atuais, ajuste a agenda no Buffer. Data específica exige a nova conexão.",
      );
    if (platforms.some((p) => !ctx.platforms.includes(p)))
      throw new PanelError(
        "Canal ou formato indisponível para publicação.",
        409,
      );
    if (!["approve", "reject", "adjust", "rerender"].includes(input.action))
      throw new PanelError("Ação inválida.");
    const result = await studioRpc("studio_review_action", {
      p_workspace: ctx.user.workspaceId,
      p_actor: ctx.user.id,
      p_request: uuid(input.requestId),
      p_review: ctx.review.id,
      p_fingerprint: input.fingerprint,
      p_action: input.action,
      p_channels: input.action === "approve" ? channels : [],
      p_due_at: input.dueAt || null,
      p_platforms: input.action === "approve" ? platforms : [],
      p_instructions: input.instructions || null,
    });
    if (
      [
        "stale",
        "already_scheduled",
        "daily_cap_reached",
        "channel_unavailable",
      ].includes(result.code)
    ) {
      throw new PanelError(
        (
          {
            stale: "Esta revisão mudou. Atualize a página.",
            already_scheduled:
              "O vídeo já foi agendado. Confira Publicações antes de alterar.",
            daily_cap_reached: "O limite de produção de hoje foi atingido.",
            channel_unavailable: "Canal indisponível.",
          } as Record<string, string>
        )[result.code],
        409,
      );
    }
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
