import { db } from "./server";
import { PanelError } from "./security.mjs";

export const LEGACY_WORKSPACE = "00000000-0000-4000-8000-000000000001";
export type StudioUser = { id: string; workspaceId: string; email: string };
const tables = new Set([
  "episodes",
  "idea_queue",
  "job_events",
  "assets",
  "publishes",
  "review_requests",
  "web_panel_commands",
  "studio_channels",
  "studio_connections",
  "studio_outbox",
  "studio_discoveries",
  "studio_series",
  "studio_story_chapters",
]);
/** Filters cannot override the verified session's workspace. Never expose raw RPCs here. */
export function workspaceDb(user: StudioUser) {
  return async (
    table: string,
    params: Record<string, string> = {},
    options: RequestInit = {},
  ) => {
    if (table === "system_config") {
      if (user.workspaceId === LEGACY_WORKSPACE)
        return db(table, params, options);
      const { data } = await db("studio_workspaces", {
        id: `eq.${user.workspaceId}`,
        select: "settings,updated_at",
      });
      return {
        data: Object.entries(data[0]?.settings || {}).map(([key, value]) => ({
          key,
          value,
          updated_at: data[0].updated_at,
        })),
        total: null,
      };
    }
    if (!tables.has(table)) throw new PanelError("Recurso indisponível.", 403);
    return db(
      table,
      { ...params, workspace_id: `eq.${user.workspaceId}` },
      options,
    );
  };
}
export async function studioRpc(name: string, args: Record<string, unknown>) {
  return (
    await db(`rpc/${name}`, {}, { method: "POST", body: JSON.stringify(args) })
  ).data;
}
