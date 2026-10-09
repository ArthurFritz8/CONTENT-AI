import { prepareProfileVoices } from "../supabase/functions/_shared/profile-voices-runner.ts";
import { createServiceClient } from "../supabase/functions/_shared/supabase-client.ts";
const id=Deno.env.get("SERIES_ID");
if(Deno.env.get("GITHUB_ACTIONS")!=="true" || Deno.env.get("CONTENT_AI_PROFILE_VOICES_ENABLED")!=="true" || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error("Prévia de voz não ativada em runner autorizado");
try {console.log(JSON.stringify({series_id:id,...await prepareProfileVoices(createServiceClient(),id)}));}
catch {console.error("Prévia interrompida. Amostras concluídas foram preservadas; tente novamente pelo painel.");Deno.exit(1);}
