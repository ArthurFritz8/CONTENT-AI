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
  "id,episode_id,platform,external_id,status,privacy,variant,published_at,created_at";
function title(e: any) {
  return {
    ...e,
    title: e.briefing?.text || "Geração sem título",
    briefing: undefined,
  };
}
async function count(table: string, filters: Record<string, string> = {}) {
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
        count("idea_queue", { status: "eq.pending" }),
        count("episodes", {
          status: "in.(idea,research,script,assets,rendered)",
        }),
        count("episodes", { status: "eq.review" }),
        count("episodes", { status: "eq.failed" }),
        count("publishes", { status: "eq.published" }),
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
            "id,briefing,niche,product_url,priority,status,episode_id,created_at,revision",
          status: "eq.pending",
          order: "priority.asc,created_at.asc,id.asc",
          limit: String(p.limit),
          offset: String(p.offset),
        };
      if (p.search) filters.briefing = `ilike.*${p.search}*`;
      const r = await db("idea_queue", filters);
      result = { items: r.data, total: r.total, page: p.page };
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
            portrait: mediaUrl(outputs?.portrait || e.render_url, c.url),
            landscape: mediaUrl(outputs?.landscape, c.url),
          },
        },
        events: events.data.map((e: any) => ({
          ...e,
          error_message: safeErrorText(e.error_message),
        })),
        publishes: publishes.data,
        reviews: reviews.data,
        assets: assets.data.map((a: any) => ({
          ...a,
          url: mediaUrl(a.url, c.url),
        })),
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
    const r = await db(
      "rpc/web_panel_mutation",
      {},
      {
        method: "POST",
        body: JSON.stringify({
          p_request_id: input.requestId,
          p_actor: user.id,
          p_action: input.action,
          p_payload: input.payload,
        }),
      },
    );
    const errors: Record<string, string> = {
      conflict:
        "Esta pauta ou configuração mudou. Atualize a página antes de editar.",
      queue_full: "A fila atingiu o limite configurado.",
      daily_limit: "O limite de adições de hoje foi atingido.",
      disabled: "A entrada de pautas está desativada.",
      not_found: "Registro não encontrado.",
      already_started: "A geração desta pauta já começou. Atualize a fila.",
    };
    if (errors[r.data.code]) throw new PanelError(errors[r.data.code], 409);
    if (!["created", "updated", "cancelled", "saved"].includes(r.data.code))
      throw new PanelError("A operação não foi confirmada.", 502);
    return Response.json(r.data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
