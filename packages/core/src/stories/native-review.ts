import {z} from "zod";
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeMediaReviewSchema=z.object({
 version:z.literal("native-media-review-v1"),episode_id:z.string().uuid(),video_sha256:sha,created_at:z.string().datetime(),
 speech_engine:z.enum(["faster-whisper-base-cpu","unavailable"]),
 model_revision:z.literal("ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"),
 human_review_required:z.literal(true),lip_sync_verified:z.literal(false),identity_verified:z.literal(false),source_video_unchanged:z.literal(true),
 takes:z.array(z.object({index:z.number().int().min(0).max(8),speaker:z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),sha256:sha,
  expected_text:z.string().min(4).max(120),recognized_text:z.string().max(600),
  speech_status:z.enum(["no_mismatch_detected","possible_extra_speech","possible_missing_speech","unavailable"]),
  appearance_status:z.enum(["no_color_shift_detected","possible_color_shift","unavailable"]),
  sampled_frames:z.number().int().min(0).max(6),color_shift_score:z.number().min(0).max(1).nullable(),
 }).strict()).min(3).max(9).refine(t=>[3,6,9].includes(t.length)),
}).strict().superRefine((r,ctx)=>{if(r.takes.some((t,i)=>t.index!==i))ctx.addIssue({code:"custom",message:"Ordem das tomadas alterada"});});
export type NativeMediaReview=z.infer<typeof nativeMediaReviewSchema>;
export function unavailableNativeMediaReview(episode:string,video:string,takes:Array<{speaker:string;sha256:string;expected_text:string}>) {
 return nativeMediaReviewSchema.parse({version:"native-media-review-v1",episode_id:episode,video_sha256:video,created_at:new Date().toISOString(),
  speech_engine:"unavailable",model_revision:"ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",human_review_required:true,lip_sync_verified:false,identity_verified:false,source_video_unchanged:true,
  takes:takes.map((t,index)=>({...t,index,recognized_text:"",speech_status:"unavailable",appearance_status:"unavailable",sampled_frames:0,color_shift_score:null}))});
}
