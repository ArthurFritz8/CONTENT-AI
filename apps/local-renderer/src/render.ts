#!/usr/bin/env node
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  buildAssSubtitles,
  isRenderReady,
  resolveWordTimings,
  scriptJsonSchema,
  SUBTITLE_STYLE_LANDSCAPE,
  SUBTITLE_STYLE_PORTRAIT,
  type Scene,
  type ScriptJson,
  type TtsWordBoundary,
} from "@content-ai/core";
import {
  buildConcatList,
  conventionalSceneAudioPath,
  conventionalWordBoundariesPath,
  escapeFfmpegFilterPath,
  finalRenderPath,
  FPS,
  ORIENTATIONS,
  sceneIntermediatePath,
  sceneProgress,
  selectAssetUrlForScene,
  selectAudioUrlForScene,
  storagePublicUrl,
  type Orientation,
} from "./render-utils.ts";

interface EpisodeRow {
  id: string;
  status: string;
  script_json: unknown;
  render_url: string | null;
  metadata: Record<string, unknown> | null;
}

interface AssetRow {
  type: "image" | "audio" | "subtitle" | "music" | "video_clip";
  url: string;
  metadata: Record<string, unknown> | null;
}

interface RenderConfig {
  storage_bucket?: string;
  checkpoint_prefix?: string;
  crf?: number;
  preset?: string;
  cleanup_tmp?: boolean;
}

interface AssetsConfig {
  storage_bucket?: string;
}

interface RenderContext {
  episode: EpisodeRow;
  script: ScriptJson;
  assets: AssetRow[];
  bucket: string;
  workDir: string;
  client: SupabaseRestClient;
  renderConfig: Required<Pick<RenderConfig, "crf" | "preset" | "cleanup_tmp">>;
}

interface SceneLocalFiles {
  audioPath: string;
  audioDuration: number;
  wordBoundaries: TtsWordBoundary[] | null;
  imageByOrientation: Record<Orientation, string>;
  subtitleByOrientation: Record<Orientation, string>;
}

class SupabaseRestClient {
  readonly url: string;
  readonly key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/+$/, "");
    this.key = key;
  }

  private jsonHeaders(extra?: HeadersInit): HeadersInit {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async fetchEpisode(episodeId: string): Promise<EpisodeRow> {
    const rows = await this.rest<EpisodeRow[]>(
      `episodes?id=eq.${encodeURIComponent(episodeId)}&select=id,status,script_json,render_url,metadata`,
    );
    const episode = rows[0];
    if (!episode) throw new Error(`Episódio ${episodeId} não encontrado`);
    return episode;
  }

  async fetchAssets(episodeId: string): Promise<AssetRow[]> {
    return await this.rest<AssetRow[]>(
      `assets?episode_id=eq.${encodeURIComponent(episodeId)}&select=type,url,metadata`,
    );
  }

  async getSystemConfig<T>(key: string, fallback: T): Promise<T> {
    const rows = await this.rest<Array<{ value: T }>>(
      `system_config?key=eq.${encodeURIComponent(key)}&select=value`,
    );
    return rows[0]?.value ?? fallback;
  }

  async patchEpisode(episodeId: string, body: Record<string, unknown>): Promise<void> {
    await this.rest<void>(`episodes?id=eq.${encodeURIComponent(episodeId)}`, {
      method: "PATCH",
      body,
      headers: { Prefer: "return=minimal" },
    });
  }

  async event(body: Record<string, unknown>): Promise<void> {
    await this.rest<void>("job_events", { method: "POST", body, headers: { Prefer: "return=minimal" } });
  }

  storagePublicUrl(bucket: string, path: string): string {
    return storagePublicUrl(this.url, bucket, path);
  }

  async storageExists(bucket: string, path: string): Promise<boolean> {
    const res = await fetch(this.storagePublicUrl(bucket, path), { method: "HEAD" });
    if (res.status === 404) return false;
    return res.ok;
  }

  async uploadObject(bucket: string, path: string, localPath: string, contentType: string): Promise<string> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${this.url}/storage/v1/object/${bucket}/${encodedPath}`, {
      method: "POST",
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: await readFile(localPath),
    });
    if (!res.ok) throw new Error(`Upload Storage falhou (${res.status}): ${await res.text()}`);
    return this.storagePublicUrl(bucket, path);
  }

  private async rest<T>(path: string, opts?: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: HeadersInit;
  }): Promise<T> {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method: opts?.method ?? "GET",
      headers: this.jsonHeaders(opts?.headers),
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error(`Supabase REST falhou (${res.status}): ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return text ? JSON.parse(text) as T : undefined as T;
  }
}

function parseEpisodeId(argv: string[]): string {
  const flagIndex = argv.indexOf("--episode-id");
  const fromFlag = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const episodeId = fromFlag ?? process.env.EPISODE_ID;
  if (!episodeId) throw new Error("Informe --episode-id ou EPISODE_ID");
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(episodeId)) {
    throw new Error("episode_id não é UUID válido");
  }
  return episodeId;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente no ambiente`);
  return value;
}

async function run(command: string, args: string[], opts?: { capture?: boolean }): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: opts?.capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} saiu com código ${code}: ${stderr || stdout}`));
    });
  });
}

async function ffprobeDuration(filePath: string): Promise<number> {
  const output = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { capture: true });
  const duration = Number(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Duração inválida em ${filePath}`);
  return duration;
}

async function downloadUrl(url: string, destPath: string, optional = false): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) {
    if (optional && res.status === 404) return false;
    throw new Error(`Download falhou (${res.status}) ${url}: ${await res.text()}`);
  }
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, new Uint8Array(await res.arrayBuffer()));
  return true;
}

async function downloadOptionalWordBoundaries(url: string, destPath: string): Promise<TtsWordBoundary[] | null> {
  if (!await downloadUrl(url, destPath, true)) return null;
  const raw = JSON.parse(await readFile(destPath, "utf8"));
  if (!Array.isArray(raw)) return null;
  return raw.filter((item): item is TtsWordBoundary =>
    item && typeof item.word === "string" &&
    typeof item.offset_seconds === "number" &&
    typeof item.duration_seconds === "number"
  );
}

function sceneAssetUrl(scene: Scene, orientation: Orientation): string {
  const asset = orientation === "landscape" ? scene.asset_landscape : scene.asset_portrait;
  if (!asset) throw new Error(`Cena ${scene.order} sem asset_${orientation}`);
  return asset.url;
}

async function prepareSceneFiles(ctx: RenderContext, scene: Scene): Promise<SceneLocalFiles> {
  const sceneDir = join(ctx.workDir, `scene_${String(scene.order).padStart(3, "0")}`);
  await mkdir(sceneDir, { recursive: true });

  const audioAssets = ctx.assets.filter((a) => a.type === "audio");
  const audioUrl = selectAudioUrlForScene(audioAssets, scene.order) ??
    ctx.client.storagePublicUrl(ctx.bucket, conventionalSceneAudioPath(ctx.episode.id, scene.order));
  const audioPath = join(sceneDir, `scene_${scene.order}.mp3`);
  await downloadUrl(audioUrl, audioPath);
  const audioDuration = await ffprobeDuration(audioPath);

  const boundariesPath = conventionalWordBoundariesPath(ctx.episode.id, scene.order);
  const wordBoundaries = await downloadOptionalWordBoundaries(
    ctx.client.storagePublicUrl(ctx.bucket, boundariesPath),
    join(sceneDir, basename(boundariesPath)),
  );

  const words = resolveWordTimings({
    narration_text: scene.narration_text,
    audio_duration_seconds: audioDuration,
    word_boundaries: wordBoundaries,
  });

  const imageByOrientation = {} as Record<Orientation, string>;
  const subtitleByOrientation = {} as Record<Orientation, string>;

  for (const orientation of Object.keys(ORIENTATIONS) as Orientation[]) {
    const imagePath = join(sceneDir, `${orientation}_${basename(new URL(sceneAssetUrl(scene, orientation)).pathname) || "image"}`);
    await downloadUrl(sceneAssetUrl(scene, orientation), imagePath);
    imageByOrientation[orientation] = imagePath;

    const subtitlePath = join(sceneDir, `${orientation}.ass`);
    const subtitleUrl = selectAssetUrlForScene(ctx.assets, scene.order, "subtitle", orientation);
    if (subtitleUrl) {
      await downloadUrl(subtitleUrl, subtitlePath);
    } else {
      const subtitlePosition = orientation === "landscape" ? "bottom_left" : scene.subtitle_position;
      const style = orientation === "landscape" ? SUBTITLE_STYLE_LANDSCAPE : SUBTITLE_STYLE_PORTRAIT;
      await writeFile(subtitlePath, buildAssSubtitles([
        {
          words,
          scene_start_seconds: 0,
          highlight_words: scene.highlight_words,
          subtitle_position: subtitlePosition,
        },
      ], style));
    }
    subtitleByOrientation[orientation] = subtitlePath;
  }

  return { audioPath, audioDuration, wordBoundaries, imageByOrientation, subtitleByOrientation };
}

async function renderSceneOrientation(args: {
  imagePath: string;
  audioPath: string;
  subtitlePath: string;
  outputPath: string;
  orientation: Orientation;
  audioDuration: number;
  gapSeconds: number;
  renderConfig: RenderContext["renderConfig"];
}): Promise<void> {
  const size = ORIENTATIONS[args.orientation];
  const totalDuration = args.audioDuration + args.gapSeconds;
  const frames = Math.ceil(totalDuration * FPS);
  const subtitlePath = escapeFfmpegFilterPath(args.subtitlePath);
  const video = `[0:v]scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,` +
    `crop=${size.width}:${size.height},` +
    `zoompan=z='min(zoom+0.0015,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${frames}:s=${size.width}x${size.height}:fps=${FPS},` +
    `trim=duration=${totalDuration.toFixed(3)},setpts=PTS-STARTPTS,` +
    `subtitles='${subtitlePath}'[v]`;
  const audio = `[1:a]apad=pad_dur=${args.gapSeconds.toFixed(3)},` +
    `atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[a]`;

  await run("ffmpeg", [
    "-y",
    "-loop",
    "1",
    "-i",
    args.imagePath,
    "-i",
    args.audioPath,
    "-filter_complex",
    `${video};${audio}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    args.renderConfig.preset,
    "-crf",
    String(args.renderConfig.crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-movflags",
    "+faststart",
    args.outputPath,
  ]);
}

async function ensureSceneCheckpoints(ctx: RenderContext): Promise<Record<Orientation, string[]>> {
  const scenes = [...ctx.script.scenes].sort((a, b) => a.order - b.order);
  const localByOrientation: Record<Orientation, string[]> = { landscape: [], portrait: [] };
  let completed = 0;

  for (const scene of scenes) {
    const paths = Object.fromEntries(
      (Object.keys(ORIENTATIONS) as Orientation[]).map((orientation) => [
        orientation,
        sceneIntermediatePath(ctx.episode.id, scene.order, orientation),
      ]),
    ) as Record<Orientation, string>;
    const localPaths = Object.fromEntries(
      (Object.keys(ORIENTATIONS) as Orientation[]).map((orientation) => [
        orientation,
        join(ctx.workDir, `${basename(paths[orientation])}`),
      ]),
    ) as Record<Orientation, string>;

    const missing: Orientation[] = [];
    for (const orientation of Object.keys(ORIENTATIONS) as Orientation[]) {
      if (await ctx.client.storageExists(ctx.bucket, paths[orientation])) {
        await downloadUrl(ctx.client.storagePublicUrl(ctx.bucket, paths[orientation]), localPaths[orientation]);
      } else {
        missing.push(orientation);
      }
    }

    if (missing.length > 0) {
      const files = await prepareSceneFiles(ctx, scene);
      for (const orientation of missing) {
        await renderSceneOrientation({
          imagePath: files.imageByOrientation[orientation],
          audioPath: files.audioPath,
          subtitlePath: files.subtitleByOrientation[orientation],
          outputPath: localPaths[orientation],
          orientation,
          audioDuration: files.audioDuration,
          gapSeconds: ctx.script.gap_seconds,
          renderConfig: ctx.renderConfig,
        });
        await ctx.client.uploadObject(ctx.bucket, paths[orientation], localPaths[orientation], "video/mp4");
      }
    }

    for (const orientation of Object.keys(ORIENTATIONS) as Orientation[]) {
      localByOrientation[orientation].push(localPaths[orientation]);
    }

    completed += 1;
    const progress = sceneProgress(completed, scenes.length);
    await ctx.client.patchEpisode(ctx.episode.id, { render_progress: progress });
    await ctx.client.event({
      episode_id: ctx.episode.id,
      event_type: "render_checkpoint_saved",
      metadata: { scene: scene.order, total: scenes.length, skipped: missing.length === 0, progress },
    });
  }

  return localByOrientation;
}

async function concatOrientation(
  ctx: RenderContext,
  orientation: Orientation,
  sceneFiles: string[],
): Promise<string> {
  const concatListPath = join(ctx.workDir, `concat_${orientation}.txt`);
  const concatOutput = join(ctx.workDir, `episode_${orientation}_concat.mp4`);
  const finalOutput = join(ctx.workDir, `episode_${orientation}.mp4`);
  await writeFile(concatListPath, buildConcatList(sceneFiles));
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", concatOutput]);

  if (ctx.script.music?.url) {
    const musicPath = join(ctx.workDir, `music_${basename(new URL(ctx.script.music.url).pathname) || "bg.mp3"}`);
    await downloadUrl(ctx.script.music.url, musicPath);
    await run("ffmpeg", [
      "-y",
      "-i",
      concatOutput,
      "-stream_loop",
      "-1",
      "-i",
      musicPath,
      "-filter_complex",
      "[1:a]volume=0.1[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      finalOutput,
    ]);
  } else {
    await copyFile(concatOutput, finalOutput);
  }

  const remotePath = finalRenderPath(ctx.episode.id, orientation);
  return await ctx.client.uploadObject(ctx.bucket, remotePath, finalOutput, "video/mp4");
}

async function renderEpisode(episodeId: string): Promise<void> {
  const client = new SupabaseRestClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const episode = await client.fetchEpisode(episodeId);
  if (episode.status !== "assets") {
    throw new Error(`Episódio em '${episode.status}' — render exige status 'assets'`);
  }

  const script = scriptJsonSchema.parse(episode.script_json);
  if (!isRenderReady(script)) throw new Error("script_json não está render-ready");

  const [assets, renderCfg, assetsCfg] = await Promise.all([
    client.fetchAssets(episodeId),
    client.getSystemConfig<RenderConfig>("render", {}),
    client.getSystemConfig<AssetsConfig>("assets", {}),
  ]);
  const bucket = assetsCfg.storage_bucket ?? renderCfg.storage_bucket ?? "assets";
  const workDir = await mkdtemp(join(tmpdir(), `content-ai-render-${episodeId}-`));
  const cleanup_tmp = renderCfg.cleanup_tmp ?? process.env.KEEP_RENDER_TMP !== "1";

  const ctx: RenderContext = {
    episode,
    script,
    assets,
    bucket,
    workDir,
    client,
    renderConfig: {
      crf: renderCfg.crf ?? 23,
      preset: renderCfg.preset ?? "veryfast",
      cleanup_tmp,
    },
  };

  try {
    await client.event({
      episode_id: episodeId,
      event_type: "render_started",
      metadata: { strategy: "scene_checkpoint_concat", work_dir: workDir },
    });

    const checkpoints = await ensureSceneCheckpoints(ctx);
    const [landscapeUrl, portraitUrl] = await Promise.all([
      concatOrientation(ctx, "landscape", checkpoints.landscape),
      concatOrientation(ctx, "portrait", checkpoints.portrait),
    ]);
    const renderOutputs = {
      landscape: landscapeUrl,
      portrait: portraitUrl,
      completed_at: new Date().toISOString(),
      strategy: "scene_checkpoint_concat",
    };

    await client.patchEpisode(episodeId, {
      status: "rendered",
      render_url: portraitUrl,
      render_progress: 100,
      metadata: { ...(episode.metadata ?? {}), render_outputs: renderOutputs },
    });
    await client.event({
      episode_id: episodeId,
      event_type: "render_completed",
      metadata: renderOutputs,
    });
  } finally {
    if (cleanup_tmp) await rm(workDir, { recursive: true, force: true });
    else console.info(JSON.stringify({ level: "info", msg: "tmp preservado", workDir }));
  }
}

async function main(): Promise<void> {
  const episodeId = parseEpisodeId(process.argv.slice(2));
  try {
    await renderEpisode(episodeId);
  } catch (err) {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    try {
      const client = new SupabaseRestClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
      await client.patchEpisode(episodeId, {
        status: "failed",
        failure_reason: `Render falhou: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500),
      });
      await client.event({
        episode_id: episodeId,
        event_type: "failed",
        error_message: err instanceof Error ? err.message : String(err),
        metadata: { stage: "local_renderer" },
      });
    } catch (markErr) {
      console.error("Falha ao marcar episódio como failed", markErr);
    }
    process.exitCode = 1;
  }
}

await main();