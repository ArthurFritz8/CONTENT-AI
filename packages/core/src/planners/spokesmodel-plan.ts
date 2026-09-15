// ADR-031: personagem fixo via pool curado de fotos Pexels (mesma pessoa,
// fotoshoot único) — substitui a geração paga por IA do ADR-030. Zero custo,
// zero faturamento; hotlink direto do CDN (mesma convenção do ADR-009).

export interface SpokesmodelPhoto {
  pexels_id: number;
  landscape_url: string;
  portrait_url: string;
  author: string;
  pexels_url: string;
}

export interface SpokesmodelConfig {
  enabled?: boolean;
  character_description?: string | null;
  max_scenes_per_episode?: number;
  fixed_photos?: SpokesmodelPhoto[];
}

/** Escolhe determinísticamente uma foto do pool para a cena; null se desabilitado/vazio. */
export function pickPresenterPhoto(
  cfg: SpokesmodelConfig,
  sceneOrder: number,
): SpokesmodelPhoto | null {
  const photos = cfg.fixed_photos ?? [];
  if (!cfg.enabled || photos.length === 0) return null;
  return photos[sceneOrder % photos.length] ?? null;
}
