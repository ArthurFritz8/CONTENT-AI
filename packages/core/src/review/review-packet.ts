import { z } from "zod";
import { scriptJsonSchema, isRenderReady } from "../schemas/script-json.ts";
import { researchDataSchema } from "../schemas/research.ts";
import { researchMatchesEvidence } from "../validators/research-evidence.ts";
import { createScriptQualityChecker } from "../validators/script-quality.ts";

const webUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "URL web sem credenciais necessária");
const snapshotSchema = z.object({
  episode: z.object({
    id: z.string().uuid(), script_json: scriptJsonSchema, render_url: webUrl,
    research_data: researchDataSchema, research_evidence: z.unknown(),
    product_compliance: z.object({ commercial_content: z.boolean().optional() }).passthrough().nullable(),
    metadata: z.object({ render_outputs: z.object({ landscape: webUrl, portrait: webUrl }).passthrough() }),
  }),
  assets: z.array(z.object({
    type: z.string(), url: webUrl, source: z.string(), license: z.string(), author: z.string().nullable(),
    metadata: z.record(z.unknown()).nullable(),
  })),
  fact_check: z.unknown(),
});

function clip(text: string, length: number): string {
  const chars = Array.from(text.replace(/\s+/gu, " ").trim());
  return chars.length > length ? `${chars.slice(0, length - 1).join("")}…` : chars.join("");
}

export function buildReviewPacket(snapshot: unknown, requestId: string) {
  z.string().uuid().parse(requestId);
  const { episode, assets, fact_check } = snapshotSchema.parse(snapshot);
  const script = episode.script_json;
  if (episode.render_url !== episode.metadata.render_outputs.portrait) throw new Error("Vídeo principal diverge da versão apresentada");
  if (script.episode_id !== episode.id || !isRenderReady(script)) throw new Error("Roteiro/render inválido para revisão");
  if (!researchMatchesEvidence(episode.research_data, episode.research_evidence)) throw new Error("Evidência de pesquisa inválida");
  const report = createScriptQualityChecker(fact_check)(script, episode.research_data, Boolean(episode.product_compliance?.commercial_content));
  if (!report.passed) throw new Error("Roteiro reprovado no QA; revisão não enviada");
  const scenes = [...script.scenes].sort((a, b) => a.order - b.order);
  const caption = [
    "REVISÃO EDITORIAL",
    clip(script.metadata.youtube.title, 100), "",
    `Conteúdo: ${clip(scenes[0]!.narration_text, 230)}`,
    `${scenes.length} cenas • Português • ${script.disclosures.commercial_content ? "Com link de afiliado" : "Sem conteúdo comercial"}`,
    "Voz/conteúdo sintético: sim", "",
    "Assista às duas versões e confira o roteiro, descrições, fontes e licenças no anexo.",
    "QA automático passou. Veracidade, direitos e qualidade audiovisual exigem sua revisão.",
    "Aprovar registra esta versão para futura publicação. Refazer render mantém roteiro e assets.",
    `Episódio: ${episode.id}`,
  ].join("\n");
  const lines = [
    "CONTENT AI — REVISÃO EDITORIAL", `Episódio: ${episode.id}`, `Revisão: ${requestId}`, "",
    "ANTES DE APROVAR", "[ ] Vídeo e áudio corretos nas duas orientações; legendas legíveis e sincronizadas.",
    "[ ] Afirmações conferidas nas fontes; produto e contexto correspondem.",
    "[ ] Uso das imagens/música autorizado e atribuições suficientes.",
    "[ ] Títulos/descrições fiéis; divulgação comercial clara quando aplicável.", "",
    "VÍDEOS", `Vertical: ${episode.metadata.render_outputs.portrait}`, `Horizontal: ${episode.metadata.render_outputs.landscape}`, "",
    "YOUTUBE", `Título: ${script.metadata.youtube.title}`, `Categoria editorial: ${script.metadata.youtube.category}`,
    `Tags: ${script.metadata.youtube.tags.join(", ")}`, "Descrição:", script.metadata.youtube.description, "",
    "TIKTOK / SHORTS", `Título TikTok: ${script.metadata.tiktok.title}`, `Hashtags: ${script.metadata.tiktok.hashtags.join(" ")}`,
    "Descrição TikTok:", script.metadata.tiktok.description,
    "A elegibilidade como Short depende da duração/proporção final. TikTok continua com publicação manual.", "",
    "ROTEIRO COMPLETO", ...scenes.flatMap(scene => [
      `Cena ${scene.order + 1} — ${scene.role} — alvo editorial ${scene.duration_seconds}s`, scene.narration_text,
      `Visual planejado: ${scene.visual.description}`, "",
    ]), "FONTES E EVIDÊNCIAS", ...script.sources.flatMap((source, index) => [
      `${index + 1}. ${source.claim}`, source.source_url,
    ]), "As citações foram fornecidas pelo mecanismo de busca do Gemini; não constituem verificação independente.", "",
    "ASSETS E LICENÇAS DECLARADAS", ...assets.flatMap(asset => [
      `${asset.type} | origem: ${asset.source} | licença: ${asset.license} | autor: ${asset.author ?? "não informado"}`,
      asset.url,
    ]), "Licenças declaradas no pipeline precisam ser conferidas pelo revisor.", "",
    "TRANSPARÊNCIA", `Conteúdo sintético: ${script.disclosures.contains_synthetic_media ? "sim" : "não"}`,
    `Conteúdo comercial: ${script.disclosures.commercial_content ? "sim" : "não"}`,
    `Disclosure: ${script.disclosures.commercial_disclosure_text ?? "não aplicável"}`, "",
    "ALERTAS", ...report.findings.map(f => f.message), "",
    "DECISÃO", "Aprovar versão: mantém review e registra consentimento para esta versão; não faz upload.",
    "Refazer render: gera os vídeos novamente com o mesmo roteiro/assets; exige nova revisão.",
    "Reprovar: interrompe o episódio para correção editorial; não publica.",
  ];
  const document = lines.join("\n");
  if (new TextEncoder().encode(document).length > 256 * 1024) throw new Error("Dossiê excede 256 KiB");
  return { caption, document, filename: `revisao-${episode.id.slice(0, 8)}.txt`,
    reply_markup: { inline_keyboard: [
      [{ text: "▶ Assistir vertical", url: episode.metadata.render_outputs.portrait },
        { text: "▶ Assistir horizontal", url: episode.metadata.render_outputs.landscape }],
      [{ text: "Aprovar versão", callback_data: `rv:a:${requestId}` }],
      [{ text: "Refazer render", callback_data: `rv:r:${requestId}` }, { text: "Reprovar", callback_data: `rv:x:${requestId}` }],
    ] },
  };
}
