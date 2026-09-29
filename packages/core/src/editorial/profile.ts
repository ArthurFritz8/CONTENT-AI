import { z } from "zod";
export const themes = {
  gadgets: {
    label: "Gadgets e tecnologia",
    query: "lançamento gadget marca modelo Brasil",
    rule: "Um produto identificado por marca e modelo; problema, funcionamento e limitação verificáveis. Não inventar preço ou disponibilidade.",
  },
  geek: {
    label: "Mundo geek",
    query: "cultura geek anúncio oficial lançamento Brasil",
    rule: "Um anúncio ou acontecimento específico. Distinguir anúncio confirmado, rumor e opinião. Não reutilizar personagens ou pôsteres sem licença.",
  },
  novelas: {
    label: "Novelas e séries",
    query: "novela série anúncio oficial capítulo Brasil",
    rule: "Um acontecimento ou anúncio específico e confirmado. Sinalizar spoilers, separar ficção de fatos sobre atores; nunca inventar bastidores. Imagens ilustrativas, sem cenas de TV não licenciadas.",
  },
  finance: {
    label: "Educação financeira",
    query: "Banco Central Brasil educação financeira notícia oficial",
    rule: "Educação financeira geral. Citar data e fonte oficial para taxas e regras. Sem aconselhamento individual, compra de ativos ou promessa de lucro.",
  },
  casa: {
    label: "Casa e organização",
    query: "organização casa produto lançamento Brasil",
    rule: "Uma solução concreta para um problema doméstico; limitações e segurança. Sem promessas médicas.",
  },
  games: {
    label: "Games",
    query: "jogo lançamento atualização anúncio oficial Brasil",
    rule: "Um jogo e um anúncio verificável, identificar plataforma e data; não inventar desempenho ou reviews. Sem gameplay não licenciado.",
  },
  ciencia: {
    label: "Ciência e curiosidades",
    query: "pesquisa científica descoberta universidade Brasil notícia",
    rule: "Uma descoberta e a fonte original. Explicar limites, hipótese versus resultado; sem converter pesquisa preliminar em recomendação médica.",
  },
} as const;
export const editorialProfileSchema = z.object({
  theme: z.enum([
    "gadgets",
    "geek",
    "novelas",
    "finance",
    "casa",
    "games",
    "ciencia",
  ]),
  focus: z.string().trim().max(500).default(""),
  auto_discover: z.boolean().default(false),
  days: z.union([z.literal(7), z.literal(30)]).default(7),
});
export type EditorialProfile = z.infer<typeof editorialProfileSchema>;
export function editorialInstruction(raw: unknown): string {
  const p = editorialProfileSchema.safeParse(raw);
  if (!p.success) return "";
  return `PERFIL EDITORIAL: ${themes[p.data.theme].label}. ${themes[p.data.theme].rule}\nFoco do operador: ${p.data.focus}. Vídeo com imagens e narração, 60s ou mais. Ilustrações não são demonstrações reais. CTA orgânico para comentar ou seguir; nunca prometer viralização.`;
}
const candidate = z.object({
  title: z.string().min(8).max(160),
  hook: z.string().min(20).max(240),
  angle: z.string().min(20).max(400),
  why_now: z.string().min(20).max(350),
  limitation: z.string().min(10).max(300),
  source_url: z.string().url(),
  evidence_quote: z.string().min(25).max(250),
});
export function groundedCandidates(
  raw: unknown,
  sources: Array<{
    url: string;
    content: string;
    published_date?: string | null;
  }>,
  now = new Date(),
) {
  const parsed = z.array(candidate).max(3).parse(raw);
  const seen = new Set<string>();
  return parsed
    .filter((c) => {
      const s = sources.find((s) => s.url === c.source_url);
      const key = c.title.toLocaleLowerCase();
      const valid =
        !/(?:tend[eê]ncias|lista de|top \d|\d+ (?:gadgets|produtos|novidades|ideias))/i.test(
          c.title,
        ) &&
        !!s &&
        s.content
          .toLocaleLowerCase()
          .includes(c.evidence_quote.toLocaleLowerCase()) &&
        !seen.has(key) &&
        !/(garant.{0,10}(lucro|viral)|cura|retorno garantido)/i.test(c.hook);
      seen.add(key);
      return valid;
    })
    .map((c) => ({
      ...c,
      published_at:
        sources.find((s) => s.url === c.source_url)?.published_date || null,
      checked_at: now.toISOString(),
      signal: "recent_source",
    }));
}
