import { previewUrl } from "../../../lib/media";
import { workspaceDb, studioRpc } from "../../../lib/workspace";
import {
  appUrl,
  body,
  config,
  db,
  errorResponse,
  requireUser,
  safeErrorText,
} from "../../../lib/server";
import {
  assertOrigin,
  mediaUrl,
  mutation,
  pagination,
  PanelError,
  uuid,
} from "../../../lib/security.mjs";

export const dynamic = "force-dynamic";
const episodeSelect =
  "id,status,briefing,render_progress,qa_score,created_at,updated_at,approval_date";
const publishSelect =
  "id,episode_id,platform,external_id,status,privacy,variant,affiliate_url,commercial_disclosure,published_at,created_at";
function title(e: any) {
  return {
    ...e,
    title: e.briefing?.text || "Geração sem título",
    briefing: undefined,
  };
}
async function count(
  db: ReturnType<typeof workspaceDb>,
  table: string,
  filters: Record<string, string> = {},
) {
  const result = await db(
    table,
    { select: "id", ...filters },
    { method: "HEAD" },
  );
  if (result.total === null)
    throw new PanelError("O banco não retornou a contagem.", 502);
  return result.total;
}
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const db = workspaceDb(user);
    const params = new URL(request.url).searchParams,
      resource = params.get("resource") || "overview";
    let result: unknown;
    if (resource === "overview") {
      const [
        pending,
        active,
        review,
        failed,
        published,
        recent,
        events,
        settings,
      ] = await Promise.all([
        count(db, "idea_queue", { status: "eq.pending" }),
        count(db, "episodes", {
          status: "in.(idea,research,script,assets,rendered)",
        }),
        count(db, "episodes", { status: "eq.review" }),
        count(db, "episodes", { status: "eq.failed" }),
        count(db, "publishes", { status: "eq.published" }),
        db("episodes", {
          select: episodeSelect,
          order: "created_at.desc",
          limit: "6",
        }),
        db("job_events", {
          select: "id,episode_id,event_type,created_at,error_message",
          order: "created_at.desc",
          limit: "8",
        }),
        db("system_config", {
          select: "key,value,updated_at",
          key: "in.(pipeline,niche)",
        }),
      ]);
      result = {
        user,
        counts: { pending, active, review, failed, published },
        recent: recent.data.map(title),
        events: events.data.map((e: any) => ({
          ...e,
          error_message: safeErrorText(e.error_message),
        })),
        settings: settings.data,
      };
    } else if (resource === "episodes") {
      const p = pagination(params);
      const filters: Record<string, string> = {
        select: episodeSelect,
        order: "created_at.desc,id.desc",
        limit: String(p.limit),
        offset: String(p.offset),
      };
      if (p.status) filters.status = `eq.${p.status}`;
      if (p.search) filters["briefing->>text"] = `ilike.*${p.search}*`;
      const r = await db("episodes", filters);
      result = { items: r.data.map(title), total: r.total, page: p.page };
    } else if (resource === "queue") {
      const p = pagination(params),
        filters: Record<string, string> = {
          select:
            "id,briefing,niche,product_url,affiliate_links,priority,status,episode_id,created_at,revision,source,validated_at,recommendations,recommendation_checked_at,selected_product,selected_hook,selected_evidence_url,story_context",
          status: "eq.pending",
          order: "priority.asc,created_at.asc,id.asc",
          limit: String(p.limit),
          offset: String(p.offset),
        };
      if (p.search) filters.briefing = `ilike.*${p.search}*`;
      const [r, recent] = await Promise.all([
        db("idea_queue", filters),
        db("idea_queue", {
          select: "id,briefing,episode_id,consumed_at,selected_product",
          status: "eq.consumed",
          order: "consumed_at.desc",
          limit: "8",
        }),
      ]);
      const ids = recent.data.map((row: any) => row.episode_id).filter(Boolean);
      const [episodes, reviews, events] = ids.length
        ? await Promise.all([
            db("episodes", {
              select: "id,status,render_progress,updated_at",
              id: `in.(${ids.join(",")})`,
            }),
            db("review_requests", {
              select: "episode_id,delivery_status,decision,created_at",
              episode_id: `in.(${ids.join(",")})`,
              order: "created_at.desc",
              limit: "30",
            }),
            db("job_events", {
              select: "episode_id,event_type,created_at,error_message",
              episode_id: `in.(${ids.join(",")})`,
              order: "created_at.desc",
              limit: "100",
            }),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];
      const episodeById = new Map(
        episodes.data.map((row: any) => [row.id, row]),
      );
      const reviewByEpisode = new Map<string, any>();
      for (const review of reviews.data) {
        if (!reviewByEpisode.has(review.episode_id))
          reviewByEpisode.set(review.episode_id, review);
      }
      const eventByEpisode = new Map<string, any>();
      for (const event of events.data) {
        if (!eventByEpisode.has(event.episode_id))
          eventByEpisode.set(event.episode_id, {
            ...event,
            error_message: safeErrorText(event.error_message),
          });
      }
      result = {
        items: r.data,
        total: r.total,
        page: p.page,
        recent: recent.data.map((row: any) => ({
          ...row,
          episode: episodeById.get(row.episode_id) || null,
          review: reviewByEpisode.get(row.episode_id) || null,
          event: eventByEpisode.get(row.episode_id) || null,
        })),
      };
    } else if (resource === "episode") {
      const id = uuid(params.get("id"));
      const [ep, events, publishes, assets, reviews] = await Promise.all([
        db("episodes", {
          select:
            "id,status,briefing,render_progress,qa_score,created_at,updated_at,approval_date,failure_reason,failure_from_status,script_json,render_url,metadata,tts_engine,prompt_version",
          id: `eq.${id}`,
          limit: "1",
        }),
        db("job_events", {
          select:
            "id,event_type,created_at,error_message,model_used,cost_estimate",
          episode_id: `eq.${id}`,
          order: "created_at.desc",
          limit: "100",
        }),
        db("publishes", {
          select: publishSelect,
          episode_id: `eq.${id}`,
          order: "created_at.desc",
          limit: "30",
        }),
        db("assets", {
          select: "id,type,url,license,source,author",
          episode_id: `eq.${id}`,
          limit: "100",
        }),
        db("review_requests", {
          select: "id,decision,delivery_status,created_at,decided_at",
          episode_id: `eq.${id}`,
          order: "created_at.desc",
          limit: "10",
        }),
      ]);
      const e = ep.data[0];
      if (!e) throw new PanelError("Geração não encontrada.", 404);
      const c = config(),
        outputs = e.metadata?.render_outputs;
      const { metadata: discardedMetadata, ...safe } = e;
      result = {
        episode: {
          ...safe,
          failure_reason: safeErrorText(e.failure_reason),
          videos: {
            portrait: await previewUrl(outputs?.portrait || e.render_url, e.id),
            landscape: await previewUrl(outputs?.landscape, e.id),
            tiktok: await previewUrl(
              outputs?.platforms?.tiktok?.portrait,
              e.id,
            ),
          },
        },
        events: events.data.map((e: any) => ({
          ...e,
          error_message: safeErrorText(e.error_message),
        })),
        publishes: publishes.data,
        reviews: reviews.data,
        assets: await Promise.all(
          assets.data.map(async (a: any) => ({
            ...a,
            url: await previewUrl(a.url, e.id),
          })),
        ),
      };
    } else if (resource === "publishes") {
      const p = pagination(params),
        r = await db("publishes", {
          select: publishSelect,
          order: "created_at.desc,id.desc",
          limit: String(p.limit),
          offset: String(p.offset),
        });
      result = { items: r.data, total: r.total, page: p.page };
    } else if (resource === "settings") {
      const [settings, audit] = await Promise.all([
        db("system_config", {
          select: "key,value,updated_at",
          key: "in.(pipeline,niche,budget,render,tts,telegram_queue)",
        }),
        db("web_panel_commands", {
          select: "request_id,action,created_at,result",
          order: "created_at.desc",
          limit: "15",
        }),
      ]);
      // Endpoint URLs/credentials are not part of settings returned to the browser.
      result = {
        settings: settings.data.map((s: any) =>
          s.key === "tts"
            ? {
                ...s,
                value: {
                  chain: s.value.chain,
                  voice_pt_br: s.value.voice_pt_br,
                },
              }
            : s,
        ),
        audit: audit.data,
      };
    } else throw new PanelError("Página de dados não encontrada.", 404);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request, appUrl());
    const user = await requireUser(),
      input = mutation(await body(request));
    const r = {
      data: await studioRpc("studio_command", {
        p_workspace: user.workspaceId,
        p_actor: user.id,
        p_request: input.requestId,
        p_action: input.action,
        p_payload: input.payload,
      }),
    };
    const errors: Record<string, string> = {
      story_locked: "O plano desta história está guardado na série. Crie outra proposta para mudar o elenco ou o enredo.",
      conflict:
        "Esta pauta ou configuração mudou. Atualize a página antes de editar.",
      queue_full: "A fila atingiu o limite configurado.",
      daily_limit: "O limite de adições de hoje foi atingido.",
      disabled: "A entrada de pautas está desativada.",
      not_found: "Registro não encontrado.",
      already_started: "A geração desta pauta já começou. Atualize a fila.",
      not_candidate: "Esta ação é exclusiva das sugestões de tendências.",
      pipeline_paused:
        "Ative a Produção automática em Configurações antes de gerar.",
      product_required: "Escolha um produto concreto antes de gerar o vídeo.",
      production_busy:
        "Já existe um vídeo em produção. Acompanhe-o em Gerações.",
      daily_cap_reached:
        "O limite diário de episódios foi atingido. Tente no próximo dia UTC.",
    };
    if (errors[r.data.code]) throw new PanelError(errors[r.data.code], 409);
    if (
      ![
        "created",
        "updated",
        "cancelled",
        "saved",
        "product_chosen",
        "started",
      ].includes(r.data.code)
    )
      throw new PanelError("A operação não foi confirmada.", 502);
    return Response.json(r.data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
