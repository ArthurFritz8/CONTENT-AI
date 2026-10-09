import { prepareAnimation } from "../supabase/functions/_shared/animation-preparation-runner.ts";
import { createServiceClient } from "../supabase/functions/_shared/supabase-client.ts";
const id=Deno.env.get("EPISODE_ID");
if(Deno.env.get("GITHUB_ACTIONS")!=="true" || Deno.env.get("CONTENT_AI_ANIMATION_PREPARATION_ENABLED")!=="true" || !id || !/^[0-9a-f-]{36}$/i.test(id))
  throw Error("Preparação não ativada em um runner autorizado");
try { console.log(JSON.stringify({episode_id:id,...await prepareAnimation(createServiceClient(),id)})); }
catch { console.error("Preparação interrompida. Checkpoints preservados; confira a fala e o perfil antes de retomar.");Deno.exit(1); }
