// trigger-render — dispara o workflow render.yml no GitHub Actions (ADR-004).
// Input: { episode_id, force? }. Só episode_id vai como input do workflow —
// signed URLs foram vetadas (vazam nos logs da run e expiram na fila).

import {
  AppError,
  isTransientHttpStatus,
  jsonResponse,
  retryWithBackoff,
  toErrorResponse,
} from "../_shared/error-handler.ts";
import { createServiceClient, getSystemConfig } from "../_shared/supabase-client.ts";
import { JobLogger } from "../_shared/logger.ts";
import { parseJsonBody, triggerRenderInputSchema } from "../_shared/validators.ts";
import {
  DEFAULT_RENDER_DISPATCH_TTL_MINUTES,
  RENDER_WORKFLOW_FILE,
} from "../_shared/constants.ts";
import type { RenderDispatchMeta } from "../_shared/types.ts";

interface RenderConfig {
  dispatch_ttl_minutes?: number;
}

function getGithubEnv(): { token: string; repo: string; branch: string } {
  const token = Deno.env.get("GITHUB_TOKEN");
  const repo = Deno.env.get("GITHUB_REPO");
  const branch = Deno.env.get("GITHUB_BRANCH") ?? "main";
  if (!token || !repo) {
    throw new AppError("GITHUB_TOKEN / GITHUB_REPO ausentes no ambiente", 500, "CONFIG_MISSING");
  }
  return { token, repo, branch };
}

async function dispatchWorkflow(episodeId: string): Promise<void> {
  const { token, repo, branch } = getGithubEnv();
  const url =
    `https://api.github.com/repos/${repo}/actions/workflows/${RENDER_WORKFLOW_FILE}/dispatches`;

  await retryWithBackoff(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: branch, inputs: { episode_id: episodeId } }),
      });
      if (res.status !== 204) {
        const body = await res.text();
        throw new AppError(
          `GitHub dispatch falhou (${res.status}): ${body.slice(0, 300)}`,
          isTransientHttpStatus(res.status) ? 502 : 500,
          "GITHUB_DISPATCH_FAILED",
        );
      }
    },
    { shouldRetry: (err) => err instanceof AppError && err.status === 502 },
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return toErrorResponse(new AppError("Método não permitido", 405, "METHOD_NOT_ALLOWED"));
  }

  let logger: JobLogger | undefined;
  try {
    const input = await parseJsonBody(req, triggerRenderInputSchema);
    const db = createServiceClient();
    logger = new JobLogger(db, "trigger-render");

    const { data: episode, error } = await db
      .from("episodes")
      .select("id, status, render_progress, metadata")
      .eq("id", input.episode_id)
      .maybeSingle();

    if (error) throw new AppError(`Erro ao buscar episódio: ${error.message}`, 500, "DB_ERROR");
    if (!episode) throw new AppError("Episódio não encontrado", 404, "NOT_FOUND");
    if (episode.status !== "assets") {
      throw new AppError(
        `Episódio em '${episode.status}' — render exige status 'assets'`,
        409,
        "INVALID_STATE",
      );
    }

    // Idempotência: recusa re-dispatch dentro do TTL (a menos que force=true)
    const cfg = await getSystemConfig<RenderConfig>(db, "render", {});
    const ttlMinutes = cfg.dispatch_ttl_minutes ?? DEFAULT_RENDER_DISPATCH_TTL_MINUTES;
    const metadata = (episode.metadata ?? {}) as Record<string, unknown>;
    const prev = metadata.render_dispatch as RenderDispatchMeta | undefined;

    if (prev && !input.force) {
      const ageMinutes = (Date.now() - Date.parse(prev.dispatched_at)) / 60_000;
      if (ageMinutes < ttlMinutes) {
        throw new AppError(
          `Render já disparado há ${Math.round(ageMinutes)}min (TTL ${ttlMinutes}min). Use force=true para redisparar.`,
          409,
          "ALREADY_DISPATCHED",
        );
      }
    }

    await dispatchWorkflow(episode.id);

    const dispatch: RenderDispatchMeta = {
      dispatched_at: new Date().toISOString(),
      attempt: (prev?.attempt ?? 0) + 1,
      target: "github_actions",
    };
    const { error: updateError } = await db
      .from("episodes")
      .update({ metadata: { ...metadata, render_dispatch: dispatch } })
      .eq("id", episode.id);
    if (updateError) {
      logger.error("falha ao registrar render_dispatch no episódio", updateError);
    }

    await logger.event({
      episode_id: episode.id,
      event_type: "render_started",
      metadata: { target: "github_actions", attempt: dispatch.attempt, forced: input.force },
    });

    logger.info("workflow de render disparado", { episode_id: episode.id, attempt: dispatch.attempt });
    return jsonResponse({ dispatched: true, attempt: dispatch.attempt }, 202);
  } catch (err) {
    logger?.error("falha no trigger-render", err);
    return toErrorResponse(err);
  }
});
