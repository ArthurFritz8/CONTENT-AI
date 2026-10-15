import {z} from "zod";
import {createNativeRun} from "./auray-native-chapter.ts";
import {AurayError,type AurayInspection} from "./auray-video-provider.ts";
export async function admitNativeChapter(episode:string,deps:{rpc(name:string,args:Record<string,unknown>):Promise<unknown>;inspect():Promise<AurayInspection>}) {
  z.string().uuid().parse(episode);
  const input=z.object({code:z.enum(["prepare","existing","cancelled","native_setup_required","wallet_reserved"]),wallet_id:z.string().uuid().optional(),profile:z.unknown(),context:z.unknown(),draft:z.unknown(),fingerprint:z.string().optional()}).parse(await deps.rpc("native_worker_input",{p_episode:episode}));
  if(input.code!=="prepare")return {code:input.code};
  if(!input.wallet_id)throw new AurayError("native_wallet_missing");
  const run=await createNativeRun({episode_id:episode,profile:input.profile,context:input.context,draft:input.draft},await deps.inspect());
  if(run.fingerprint!==input.fingerprint)throw new AurayError("native_checkpoint_mismatch");
  const result=z.object({code:z.enum(["reserved","existing","wallet_reserved","native_setup_required"])}).parse(await deps.rpc("reserve_native_chapter",{p_episode:episode,p_wallet:input.wallet_id,p_run:run}));
  return {code:result.code==="reserved"?"existing":result.code};
}
