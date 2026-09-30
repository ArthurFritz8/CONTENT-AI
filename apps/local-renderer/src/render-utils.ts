export const FPS = 30;

export const ORIENTATIONS = {
  landscape: { width: 1920, height: 1080, suffix: "landscape" },
  portrait: { width: 1080, height: 1920, suffix: "portrait" },
} as const;

export type Orientation = keyof typeof ORIENTATIONS;

export type KenBurns = "in" | "out" | "pan_left" | "pan_right" | "static";

export function planShotDurations(totalSeconds: number, availableImages: number): number[] {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0 || availableImages < 1) {
    throw new RangeError("Duração e quantidade de imagens devem ser positivas");
  }
  const count = Math.min(3, availableImages, Math.max(1, Math.floor(totalSeconds / 3)));
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? totalSeconds - (count - 1) * (totalSeconds / count) : totalSeconds / count);
}

export function motionForShot(base: KenBurns, shotIndex: number): KenBurns {
  if (shotIndex === 0 || base === "static") return base;
  return shotIndex % 2 ? "pan_right" : "out";
}

export function zoomPanFilter(motion: KenBurns, frames: number, size: { width: number; height: number }): string {
  const centerX = "iw/2-(iw/zoom/2)";
  const centerY = "ih/2-(ih/zoom/2)";
  const movement = {
    in: { z: "min(1+on*0.0015,1.12)", x: centerX, y: centerY },
    out: { z: "max(1.12-on*0.0015,1)", x: centerX, y: centerY },
    pan_left: { z: "1.08", x: `(iw-iw/zoom)*(1-min(on/${frames},1))`, y: centerY },
    pan_right: { z: "1.08", x: `(iw-iw/zoom)*min(on/${frames},1)`, y: centerY },
    static: { z: "1", x: "0", y: "0" },
  }[motion];
  return `zoompan=z='${movement.z}':x='${movement.x}':y='${movement.y}':d=${frames}:s=${size.width}x${size.height}:fps=${FPS}`;
}

export function buildSceneFilterGraph(args: {
  shotDurations: number[];
  motion: KenBurns;
  size: { width: number; height: number };
  subtitlePath: string;
  audioDuration: number;
  gapSeconds: number;
}): string {
  const shots = args.shotDurations.map((duration, index) => {
    const frames = Math.ceil(duration * FPS);
    return `[${index}:v]scale=${args.size.width}:${args.size.height}:force_original_aspect_ratio=increase,` +
      `crop=${args.size.width}:${args.size.height},` +
      `${zoomPanFilter(motionForShot(args.motion, index), frames, args.size)},` +
      `trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS[shot${index}]`;
  });
  const visual = `${args.shotDurations.map((_, index) => `[shot${index}]`).join("")}` +
    `concat=n=${args.shotDurations.length}:v=1:a=0,` +
    `subtitles='${escapeFfmpegFilterPath(args.subtitlePath)}'[v]`;
  const totalDuration = args.audioDuration + args.gapSeconds;
  const audio = `[${args.shotDurations.length}:a]apad=pad_dur=${args.gapSeconds.toFixed(3)},` +
    `atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[a]`;
  return [...shots, visual, audio].join(";");
}

export function buildMusicMixFilter(volume: number): string {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new RangeError("Volume da música fora de 0-1");
  }
  return `[1:a]volume=${volume}[music];` +
    `[music][0:a]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=350[ducked];` +
    `[0:a][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`;
}

export interface AudioAssetLike {
  url: string;
}

export interface SceneAssetLike {
  type?: string;
  url: string;
  metadata?: Record<string, unknown> | null;
}

export function plannedRenderedDuration(
  sceneOrders: number[],
  assets: SceneAssetLike[],
  gapSeconds: number,
): number {
  let duration = 0;
  for (const order of sceneOrders) {
    const asset = assets.find((item) => item.type === "audio" && item.metadata?.scene_order === order);
    const seconds = Number(asset?.metadata?.duration_seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Áudio da cena ${order} sem duração medida`);
    duration += seconds + gapSeconds;
  }
  return duration;
}

export function padSceneOrder(order: number): string {
  return String(order).padStart(3, "0");
}

export function sceneIntermediatePath(
  episodeId: string,
  sceneOrder: number,
  orientation: Orientation,
  revision?: string,
): string {
  return `episodes/${episodeId}/render/intermediate/${revision ? `${revision}/` : ""}scene_${padSceneOrder(sceneOrder)}_${orientation}.mp4`;
}

export function finalRenderPath(
  episodeId: string,
  orientation: Orientation,
  revision: string,
): string {
  return `episodes/${episodeId}/render/final/${revision}/episode_${orientation}.mp4`;
}

export function conventionalSceneAudioPath(
  episodeId: string,
  sceneOrder: number,
): string {
  return `episodes/${episodeId}/audio/scene_${padSceneOrder(sceneOrder)}.mp3`;
}

export function conventionalWordBoundariesPath(
  episodeId: string,
  sceneOrder: number,
): string {
  return `episodes/${episodeId}/audio/scene_${padSceneOrder(sceneOrder)}_word_boundaries.json`;
}

export function sceneProgress(
  completedScenes: number,
  totalScenes: number,
): number {
  if (totalScenes <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, Math.round((completedScenes / totalScenes) * 100)),
  );
}

export function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function storagePublicUrl(
  baseUrl: string,
  bucket: string,
  path: string,
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${normalizedBase}/storage/v1/object/${bucket === "studio-private" ? "authenticated" : "public"}/${bucket}/${encodedPath}`;
}

export function isMissingOptionalStorageObject(
  status: number,
  body: string,
): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  try {
    const error = JSON.parse(body) as {
      statusCode?: string | number;
      code?: string;
    };
    return Number(error.statusCode) === 404 || error.code === "NoSuchKey";
  } catch {
    return false;
  }
}

export function isTransientStorageStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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
  const candidates = [
    `scene_${padded}`,
    `scene-${padded}`,
    `scene_${sceneOrder}`,
    `scene-${sceneOrder}`,
  ];
  const match = assets.find((asset) => {
    if (type && asset.type !== type) return false;
    const lower = asset.url.toLowerCase();
    return (
      candidates.some((candidate) => lower.includes(candidate)) &&
      (!orientation || lower.includes(orientation))
    );
  });
  return match?.url ?? null;
}

export function buildConcatList(paths: string[]): string {
  return paths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n") + "\n";
}
