import { z } from "zod";

export const storyStyleIds = ["illustrated","cinematic_3d","cartoon_2d","anime","realistic","motion_comic"] as const;
export type StoryStyleId = typeof storyStyleIds[number];
export const storyStyles = [
  {id:"illustrated",label:"Ilustrado clássico",description:"Ilustrações com voz e câmera digital. Não possui movimento de boca.",delivery:"illustration"},
  {id:"cinematic_3d",label:"3D cinematográfico",description:"Personagens em 3D, atuação e diálogos em cena.",delivery:"animated"},
  {id:"cartoon_2d",label:"Desenho 2D",description:"Personagens desenhados, poses, expressões e movimento de boca.",delivery:"animated"},
  {id:"anime",label:"Anime",description:"Direção visual de anime, com expressões e cenas próprias desse estilo.",delivery:"animated"},
  {id:"realistic",label:"Realista",description:"Personagens e cenários com aparência fotográfica.",delivery:"animated"},
  {id:"motion_comic",label:"HQ com voz",description:"Quadros ilustrados, vozes, efeitos e movimentos de câmera. Não equivale a animação corporal contínua.",delivery:"comic"},
] as const;
export const storySources = {automatic:"Automático: fontes compatíveis",modal:"Modal",auray:"Auray",local:"Renderizador próprio"} as const;
/** Preview availability is independent from selectable production sources. */
export const storySampleSources = {...storySources,puter:"Puter"} as const;
export const storyPresentationSchema = z.object({
  version:z.literal("1.0.0"), primary_style:z.enum(storyStyleIds),
  continuity_mode:z.enum(["fixed","per_chapter"]),
  allowed_styles:z.array(z.enum(storyStyleIds)).min(1).max(storyStyleIds.length),
  source:z.enum(["automatic","modal","auray","local"]),
  voice_policy:z.enum(["preserve","approved_variants"]),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.allowed_styles).size!==v.allowed_styles.length || !v.allowed_styles.includes(v.primary_style) ||
    (v.continuity_mode==="fixed" && v.allowed_styles.length!==1))
    ctx.addIssue({code:"custom",message:"Escolha estilos distintos e inclua o estilo principal; estilo fixo aceita somente um"});
});
export type StoryPresentation = z.infer<typeof storyPresentationSchema>;
export function defaultStoryPresentation():StoryPresentation {
  return {version:"1.0.0",primary_style:"illustrated",continuity_mode:"fixed",allowed_styles:["illustrated"],source:"automatic",voice_policy:"preserve"};
}
/** A preference is not evidence that an engine implements that style or voice contract. */
export function presentationNeedsAdapter(p:StoryPresentation,chosen:StoryStyleId=p.primary_style) {
  const value=storyPresentationSchema.parse(p);
  if(!value.allowed_styles.includes(chosen))throw Error("Estilo fora das escolhas da novela");
  return chosen!=="illustrated" || !["automatic","local"].includes(value.source) || value.voice_policy!=="preserve";
}
/** Preparing a pattern does not qualify an execution or reserve a video budget. */
export function supportsPreparedPattern(p:StoryPresentation,chosen:StoryStyleId) {
  const value=storyPresentationSchema.parse(p);
  return value.allowed_styles.includes(chosen) && ["cinematic_3d","cartoon_2d","anime","realistic"].includes(chosen) && ["automatic","modal"].includes(value.source);
}
export function supportsNativePattern(p:StoryPresentation,chosen:StoryStyleId) {
  const value=storyPresentationSchema.parse(p);
  return value.source==="auray" && value.voice_policy==="approved_variants" && value.allowed_styles.includes(chosen) && ["cinematic_3d","cartoon_2d","anime","realistic"].includes(chosen);
}
export const storyStyleSampleSchema = z.object({
  id:z.string().uuid(),style_id:z.enum(storyStyleIds),source:z.enum(["modal","auray","local","puter"]),
  title:z.string().trim().min(5).max(100),model:z.string().trim().min(2).max(120),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(1).max(50*1024*1024),
  seconds:z.number().finite().min(1).max(120),width:z.number().int().min(480).max(4096),height:z.number().int().min(480).max(4096),
  output_fps:z.number().finite().min(1).max(120),native_fps:z.number().finite().min(1).max(120).nullable(),
  has_audio:z.boolean(),motion:z.enum(["generated","interpolated","mixed","illustrated"]),
  review_scope:z.enum(["reviewed_sample","technical_only"]),limitations:z.array(z.string().trim().min(5).max(500)).min(1).max(8),
}).strict();
export type StoryStyleSample=z.infer<typeof storyStyleSampleSchema>;
