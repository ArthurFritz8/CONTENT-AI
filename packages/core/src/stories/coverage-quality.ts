import { z } from "zod";

/** Editorial gate for an explicitly animated story; not used for ordinary illustrated videos. */
export const storyCoverageSchema = z.object({
  profile: z.literal("animated_story"),
  shots: z.array(z.object({
    id: z.string().min(1), seconds: z.number().positive().finite(),
    motion: z.enum(["generated", "still", "camera_only"]),
    function: z.enum(["dialogue", "voiceover", "action", "reaction", "detail"]),
    speaker_visible: z.boolean(), body_action_reviewed: z.boolean(), listener_reaction_reviewed: z.boolean(),
  }).strict()).min(1).max(300),
}).strict();
export function assessStoryCoverage(raw: unknown) {
  const { shots } = storyCoverageSchema.parse(raw);
  if (new Set(shots.map(s => s.id)).size !== shots.length) throw new Error("Tomadas duplicadas");
  const duration = shots.reduce((n, s) => n + s.seconds, 0);
  const animated = shots.filter(s => s.motion === "generated").reduce((n, s) => n + s.seconds, 0);
  const dialogue = shots.filter(s => s.function === "dialogue");
  const speech = dialogue.reduce((n, s) => n + s.seconds, 0);
  const visible = dialogue.filter(s => s.speaker_visible && s.motion === "generated").reduce((n, s) => n + s.seconds, 0);
  const findings: string[] = [];
  if (animated / duration < .8) findings.push("Menos de 80% da duração tem animação real; câmera sobre imagem não conta como atuação");
  if (speech > 0 && visible / speech < .8) findings.push("Falas diretas ficam cobertas por objetos ou rostos estáticos por tempo excessivo");
  if (shots.some(s => s.function === "detail" && s.seconds > 2.5)) findings.push("Detalhe de objeto excede 2,5s; revisar cobertura e ritmo");
  if (!shots.some(s => s.motion === "generated" && s.body_action_reviewed)) findings.push("Nenhuma ação corporal foi conferida");
  if (!shots.some(s => s.motion === "generated" && s.listener_reaction_reviewed)) findings.push("Nenhuma reação de quem ouve foi conferida");
  return { profile: "animated_story", passed: findings.length === 0, findings, seconds: duration,
    animated_fraction: animated / duration, visible_dialogue_fraction: speech ? visible / speech : null,
    artistic_review_required: true, lip_sync_certified: false };
}
