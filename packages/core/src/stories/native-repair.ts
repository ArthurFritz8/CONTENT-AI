import {z} from "zod";
import {nativeDraftSchema,nativeProfileSchema} from "./native-contract.ts";
import {validateNativeDraft} from "./native-chapter.ts";
export const nativeRepairSchema=z.object({index:z.number().int().min(0).max(2),
  dialogue:z.string().trim().min(4).max(120),prompt:z.string().trim().min(40).max(600),
  summary:z.string().trim().min(30).max(1200)}).strict();
/** Reuses only untouched shots; changing a line requires an explicit updated summary. */
export function repairNativeDraft(raw:unknown,context:unknown,profile:unknown,edit:unknown) {
  const before=nativeDraftSchema.parse(raw),p=nativeProfileSchema.parse(profile),input=nativeRepairSchema.parse(edit);
  const scene=before.scenes[input.index]!;
  if(input.dialogue!==scene.narration_text && input.summary===before.summary)throw Error("Atualize o resumo para registrar a consequência da nova fala.");
  return validateNativeDraft({...before,summary:input.summary,scenes:before.scenes.map((s,i)=>i===input.index?{...s,narration_text:input.dialogue,prompt:input.prompt,seed:(s.seed+1)%2147483648}:s)},context,p);
}
