import {z} from "zod";
import {storyVisualSchema} from "./schema.ts";
export const NATIVE_AURAY={model:"auray-ai/minimax-h3/text-to-video",version:"auray-native-1.0.0",contractSha256:"365a74a0aeab67eebf117fd826d540017748d687ba0955fc8ed989d113a816f1",shots:3,creditsPerShot:5,fps:24,width:768,height:1344} as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/),character=z.string().regex(/^[a-z][a-z0-9_]{0,23}$/);
export const nativeProfileSchema=z.object({
  version:z.literal(NATIVE_AURAY.version),model:z.literal(NATIVE_AURAY.model),contract_sha256:sha,
  style:z.string().trim().min(30).max(700),orientation:z.literal("portrait"),output_fps:z.literal(24),width:z.literal(768),height:z.literal(1344),
  references:z.array(z.object({character_id:character,path:z.string().min(1).max(500),sha256:sha}).strict()).min(2).max(3),
  voice_directions:z.array(z.object({character_id:character,description:z.string().trim().min(20).max(240)}).strict()).min(2).max(3),
  example:z.object({id:z.string().uuid(),sha256:sha}).strict(),
  voice_policy:z.literal("provider_generated_review"),native_voice_acknowledged:z.literal(true),
}).strict().superRefine((v,ctx)=>{
 const ids=v.references.map(r=>r.character_id),voices=v.voice_directions.map(r=>r.character_id);
 if(new Set(ids).size!==ids.length || new Set(voices).size!==voices.length || ids.length!==voices.length || ids.some(id=>!voices.includes(id)))ctx.addIssue({code:"custom",message:"Referências e direção vocal precisam corresponder ao elenco"});
});
export type NativeProfile=z.infer<typeof nativeProfileSchema>;
export const nativeDraftSchema=z.object({title:z.string().trim().min(5).max(100),summary:z.string().trim().min(30).max(1200),
 scenes:z.array(z.object({narration_text:z.string().trim().min(4).max(120),visual:storyVisualSchema,prompt:z.string().trim().min(40).max(1600),seed:z.number().int().min(0).max(2147483647)}).strict()).length(3),
}).strict();
export const nativeOutputSchema=z.object({version:z.literal("1.0.0"),provider:z.literal("auray"),profile_sha256:sha,
 width:z.literal(768),height:z.literal(1344),output_fps:z.literal(24),voice_identity_preserved:z.literal(false),speech_transcription_verified:z.literal(false),human_review_required:z.literal(true)}).strict();
export const nativeSceneSchema=z.object({shot_id:z.string().regex(/^take_[0-2]$/),character_id:character,reference_sha256:sha,request_key:sha,video_sha256:sha,frames:z.number().int().min(116).max(124)}).strict();
