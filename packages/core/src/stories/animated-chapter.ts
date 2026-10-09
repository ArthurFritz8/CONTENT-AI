import { z } from "zod";
import { scriptJsonSchema, type ScriptJson } from "../schemas/script-json.ts";
import { canonicalStringify, sha256Hex } from "../validators/hash-utils.ts";
import { productionProfileHash, seriesProductionProfileSchema } from "./production.ts";
import { storyContextSchema, storyVisualSchema } from "./schema.ts";
import { animatedSceneSchema, ANIMATED_SHOT_SECONDS } from "./animation-contract.ts";
import { videoShotSchema } from "./video-routing.ts";

export const animatedDraftSchema = z.object({
  title: z.string().trim().min(5).max(100), summary: z.string().trim().min(30).max(1200),
  scenes: z.array(z.object({ narration_text: z.string().trim().min(1).max(160), visual: storyVisualSchema,
    prompt: z.string().trim().min(40).max(2400), seed: z.number().int().min(0).max(2147483647),
  }).strict()).min(5).max(8),
}).strict();

/** Compile only after actual PCM audio has been prepared/measured; word counts are not a quote. */
export async function planAnimatedChapter(args: { draft: unknown; context: unknown; episodeId: string; profile: unknown;
  takes: Array<{ reference_path: string; reference_sha256: string; audio_path: string; audio_sha256: string;
    audio_seconds: number; voice: unknown }> }) {
  const draft = animatedDraftSchema.parse(args.draft), context = storyContextSchema.parse(args.context);
  const profile = seriesProductionProfileSchema.parse(args.profile), hash = await productionProfileHash(profile);
  if (profile.orientation !== "portrait" || profile.output_fps !== 60 || profile.short_edge > 704)
    throw Error("O motor homologado exige vertical, 60 FPS e resolução de até 704 pixels na menor borda");
  const cast = context.bible.cast.map(c => c.id);
  if (profile.voices.length !== cast.length || profile.voices.some(v => !cast.includes(v.character_id)))
    throw Error("Perfil audiovisual não corresponde ao elenco da novela");
  if (args.takes.length !== draft.scenes.length) throw Error("Cada tomada exige áudio medido e referência cadastrada");
  const scenes = [];
  const shots = [];
  for (const [order, s] of draft.scenes.entries()) {
    const take = args.takes[order]!, character = s.visual.speaker_id;
    if (!cast.includes(character) || !s.visual.on_stage.includes(character) || s.visual.on_stage.some(id => !cast.includes(id)) ||
      new Set(s.visual.on_stage).size !== s.visual.on_stage.length) throw Error("Quem fala deve aparecer na cena e pertencer ao elenco fixo");
    const voice = profile.voices.find(v => v.character_id === character)!;
    if (canonicalStringify(voice) !== canonicalStringify(take.voice) || !profile.references.some(r =>
      r.character_id === character && r.path === take.reference_path && r.sha256 === take.reference_sha256))
      throw Error("Referência ou voz diferente do padrão da novela");
    const { voice: _voice, ...measured } = take;
    const binding = animatedSceneSchema.parse({ ...measured, shot_id: `take_${order}`,
      character_id: character, voice_sha256: await sha256Hex(canonicalStringify(voice)), prompt: s.prompt, seed: s.seed });
    scenes.push({ id: binding.shot_id, order, role: order === 0 ? "hook" : order === draft.scenes.length - 1 ? "cta" : "content",
      duration_seconds: ANIMATED_SHOT_SECONDS, narration_text: s.narration_text, transition: "cut", ken_burns: "static",
      visual: { description: s.prompt, search_query: "original animated fiction" }, story_visual: s.visual, animation: binding,
      highlight_words: [], presenter: false, asset_landscape: null, asset_portrait: null, subtitle_position: "bottom_center" });
    shots.push(videoShotSchema.parse({ version: "1.0.0", id: binding.shot_id, kind: "dialogue", reference_path: binding.reference_path,
      reference_sha256: binding.reference_sha256, audio_path: binding.audio_path, audio_sha256: binding.audio_sha256,
      seconds: 63 / 16, prompt: s.prompt, seed: s.seed, quality: "approved_master", min_short_edge: 704,
      min_output_fps: profile.output_fps, continuity: { series_id: context.series_id, profile_sha256: hash } }));
  }
  const description = `Ficção original criada com apoio de IA. ${context.bible.title} — capítulo ${context.chapter_number}/${context.bible.chapters.length}. ${draft.summary}`;
  const script = scriptJsonSchema.parse({ episode_id: args.episodeId, prompt_version: "2.0.0", editorial_style: "storytelling_pessoal",
    fiction: { context, summary: draft.summary, animation: { version: "1.0.0", profile_sha256: hash, orientation: "portrait",
      width: 704, height: 1280, output_fps: 60, native_fps: 16, native_frames: 64, output_frames: 237 } },
    metadata: { youtube: { title: draft.title, description, tags: ["história original", "ficção", "novela"], category: "24" },
      tiktok: { title: draft.title, description, hashtags: ["#HistoriaOriginal", "#Ficcao", "#Novela"] } },
    narration: { full_text: scenes.map(s => s.narration_text).join(" "), language: "pt-BR", estimated_duration_seconds: scenes.length * ANIMATED_SHOT_SECONDS },
    scenes, gap_seconds: 0, music: null, sources: [], disclosures: { contains_synthetic_media: true, commercial_content: false, commercial_disclosure_text: null } });
  return { script, shots, profile_sha256: hash, animated_seconds: scenes.length * ANIMATED_SHOT_SECONDS };
}

export function shotsFromAnimatedScript(script: ScriptJson) {
  const parsed = scriptJsonSchema.parse(script), a = parsed.fiction?.animation;
  if (!a) throw Error("Capítulo sem plano animado");
  return [...parsed.scenes].sort((x, y) => x.order - y.order).map(s => videoShotSchema.parse({ version: "1.0.0",
    id: s.animation!.shot_id, kind: "dialogue", reference_path: s.animation!.reference_path, reference_sha256: s.animation!.reference_sha256,
    audio_path: s.animation!.audio_path, audio_sha256: s.animation!.audio_sha256, seconds: 63 / 16, prompt: s.animation!.prompt,
    seed: s.animation!.seed, quality: "approved_master", min_short_edge: 704, min_output_fps: a.output_fps,
    continuity: { series_id: parsed.fiction!.context.series_id, profile_sha256: a.profile_sha256 } }));
}
