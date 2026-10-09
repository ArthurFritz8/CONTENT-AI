import { storyFixture } from "./story-fixture.ts";
import { planAnimatedChapter } from "../stories/animated-chapter.ts";

export function animatedFixtureInput() {
  const { context } = storyFixture();
  const profile = { version: "1.0.0", orientation: "portrait", short_edge: 704, output_fps: 60,
    style: "Animação tridimensional original com luz quente e identidade persistente.",
    references: context.bible.cast.map(c => ({ character_id: c.id, path: `workspace/references/${c.id}.png`, sha256: "a".repeat(64) })),
    voices: context.bible.cast.map(c => ({ character_id: c.id, engine: "edge", voice_id: `${c.id}-voice`, version: "1.0.0", sample_sha256: "b".repeat(64) })) };
  const draft = { title: "A chave da verdade", summary: "Lia encontra uma chave misteriosa e Rui reconhece o objeto. Eles descobrem juntos uma pista escondida no jardim.",
    scenes: ["Quem deixou esta chave?", "Era da minha mãe.", "Então por que está escondida?", "Ela protege o nosso segredo.", "Vamos descobrir a verdade juntos!"].map((narration_text, i) => ({
      narration_text, visual: { speaker_id: i % 2 ? "rui" : "lia", on_stage: [i % 2 ? "rui" : "lia"], setting: "garden", mood: "surprised" },
      prompt: "Medium close-up. The character speaks naturally, gently raises one hand and shows surprise, maintaining facial identity.", seed: 2007 + i })) };
  const takes = draft.scenes.map((s, i) => ({ reference_path: profile.references.find(r => r.character_id === s.visual.speaker_id)!.path,
    reference_sha256: "a".repeat(64), audio_path: `workspace/audio/${i}.wav`, audio_sha256: "c".repeat(64), audio_seconds: 1,
    voice: profile.voices.find(v => v.character_id === s.visual.speaker_id)! }));
  return { episodeId: "77777777-7777-4777-8777-777777777777", context, profile, draft, takes };
}
export const animatedFixture = () => planAnimatedChapter(animatedFixtureInput());
