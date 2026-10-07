import { z } from "zod";

export const storyDirectionSchema = z.object({
  framing: z.enum(["wide", "medium", "close", "detail"]),
  action: z.string().trim().min(15).max(300),
  start_pose: z.string().trim().min(10).max(200),
  end_pose: z.string().trim().min(10).max(200),
  emotion_change: z.string().trim().min(10).max(200),
  listener_id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/).nullable(),
  listener_reaction: z.string().trim().min(10).max(200).nullable(),
  continuity: z.string().trim().min(15).max(300),
}).strict();

export type StoryDirection = z.infer<typeof storyDirectionSchema>;

export function validateStoryDirection(scenes: Array<{
  visual: { speaker_id: string; on_stage: string[]; direction?: StoryDirection };
}>, required = false): void {
  for (const { visual: v } of scenes) {
    const d = v.direction;
    if (!d) { if (required) throw new Error("Cena sem direção: ação, reação e continuidade são obrigatórias"); continue; }
    if (Boolean(d.listener_id) !== Boolean(d.listener_reaction) ||
      (d.listener_id && (!v.on_stage.includes(d.listener_id) || d.listener_id === v.speaker_id)))
      throw new Error("Reação deve pertencer a outro personagem presente na cena");
    if (d.start_pose.toLocaleLowerCase() === d.end_pose.toLocaleLowerCase())
      throw new Error("A ação deve alterar a pose ou posição, não repetir um retrato estático");
    if (d.framing === "detail" && v.speaker_id !== "narrator")
      throw new Error("Fala direta precisa mostrar o personagem; detalhe deve usar narrador");
  }
  if (required) {
    if (new Set(scenes.map(s => s.visual.direction?.framing)).size < 3)
      throw new Error("Capítulo exige pelo menos três enquadramentos diferentes");
    if (!scenes.some(s => s.visual.direction?.listener_id))
      throw new Error("Capítulo exige uma reação de quem está ouvindo");
    if (new Set(scenes.map(s => s.visual.direction?.action.toLocaleLowerCase())).size !== scenes.length)
      throw new Error("Cada cena deve ter sua própria ação narrativa");
  }
}
