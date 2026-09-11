// Same assets implementation, bounded checkpoints, executable binaries only on the runner.
import { handleAssets } from "../supabase/functions/generate-assets/handler.ts";
const id = Deno.env.get("EPISODE_ID");
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("EPISODE_ID inválido");
if (Deno.env.get("GITHUB_ACTIONS") !== "true") throw new Error("Runner não autorizado");
for (let step = 0; step < 40; step++) {
  const res = await handleAssets(new Request("https://worker.invalid/generate-assets", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ episode_id: id }),
  }));
  if (res.status === 200) Deno.exit(0);
  if (res.status !== 202) throw new Error(`Assets falhou: ${res.status} ${await res.text()}`);
}
throw new Error("Assets excedeu limite de checkpoints");
