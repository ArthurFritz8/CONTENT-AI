import { AppError } from "./error-handler.ts";

export async function dispatchGithub(workflow: "render.yml" | "assets.yml", episodeId: string): Promise<void> {
  const repo = Deno.env.get("GITHUB_REPO");
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw new AppError("GitHub não configurado", 500, "CONFIG_MISSING");
  // Dispatch has no idempotency key: an ambiguous timeout must NOT trigger an immediate retry.
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: Deno.env.get("GITHUB_BRANCH") ?? "main", inputs: { episode_id: episodeId } }),
  });
  if (res.status !== 204) throw new AppError(`Dispatch recusado (${res.status})`, 502, "GITHUB_DISPATCH_FAILED");
}
