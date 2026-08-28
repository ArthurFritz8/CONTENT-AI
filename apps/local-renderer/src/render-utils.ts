export const FPS = 30;

export const ORIENTATIONS = {
  landscape: { width: 1920, height: 1080, suffix: "landscape" },
  portrait: { width: 1080, height: 1920, suffix: "portrait" },
} as const;

export type Orientation = keyof typeof ORIENTATIONS;

export interface AudioAssetLike {
  url: string;
}

export interface SceneAssetLike {
  type?: string;
  url: string;
  metadata?: Record<string, unknown> | null;
}

export function padSceneOrder(order: number): string {
  return String(order).padStart(3, "0");
}

export function sceneIntermediatePath(
  episodeId: string,
  sceneOrder: number,
  orientation: Orientation,
): string {
  return `episodes/${episodeId}/render/intermediate/scene_${padSceneOrder(sceneOrder)}_${orientation}.mp4`;
}

export function finalRenderPath(episodeId: string, orientation: Orientation): string {
  return `episodes/${episodeId}/render/final/episode_${orientation}.mp4`;
}

export function conventionalSceneAudioPath(episodeId: string, sceneOrder: number): string {
  return `episodes/${episodeId}/audio/scene_${padSceneOrder(sceneOrder)}.mp3`;
}

export function conventionalWordBoundariesPath(episodeId: string, sceneOrder: number): string {
  return `episodes/${episodeId}/audio/scene_${padSceneOrder(sceneOrder)}_word_boundaries.json`;
}

export function sceneProgress(completedScenes: number, totalScenes: number): number {
  if (totalScenes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((completedScenes / totalScenes) * 100)));
}

export function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function storagePublicUrl(baseUrl: string, bucket: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${normalizedBase}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

export function selectAudioUrlForScene(
  assets: AudioAssetLike[],
  sceneOrder: number,
): string | null {
  return selectAssetUrlForScene(assets, sceneOrder);
}

export function selectAssetUrlForScene(
  assets: SceneAssetLike[],
  sceneOrder: number,
  type?: string,
  orientation?: Orientation,
): string | null {
  const metadataMatch = assets.find((asset) => {
    if (type && asset.type !== type) return false;
    if (asset.metadata?.scene_order !== sceneOrder) return false;
    return !orientation || asset.metadata?.orientation === orientation;
  });
  if (metadataMatch) return metadataMatch.url;

  const padded = padSceneOrder(sceneOrder);
  const candidates = [`scene_${padded}`, `scene-${padded}`, `scene_${sceneOrder}`, `scene-${sceneOrder}`];
  const match = assets.find((asset) => {
    if (type && asset.type !== type) return false;
    const lower = asset.url.toLowerCase();
    return candidates.some((candidate) => lower.includes(candidate)) &&
      (!orientation || lower.includes(orientation));
  });
  return match?.url ?? null;
}

export function buildConcatList(paths: string[]): string {
  return paths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n") + "\n";
}