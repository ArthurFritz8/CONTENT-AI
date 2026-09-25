import { createHash, randomUUID } from "node:crypto";
import { youtubePlan } from "@content-ai/core";
import { safeFetch, YoutubeClient, resumeUpload, type HttpFetch, type YoutubeAuth } from "./youtube-client.ts";

export interface PublishRow {
  id: string; status: string; external_id: string | null; review_snapshot: unknown; upload_config: unknown;
  session_url: string | null; media_sha256: string | null; media_bytes: number | null; channel_id: string | null;
}
export interface PublishStore {
  claim(episodeId: string, owner: string): Promise<PublishRow>;
  guard(id: string, owner: string): Promise<void>;
  authorizeSession(id: string, owner: string): Promise<void>;
  checkpoint(id: string, owner: string, session: string, hash: string, bytes: number, channelId: string): Promise<void>;
  finish(id: string, owner: string, videoId: string): Promise<void>;
}

export async function downloadApprovedMedia(url: string, hash: string, maxBytes: number, http: HttpFetch): Promise<Uint8Array<ArrayBuffer>> {
  const res = await safeFetch(http, url);
  if (!res.ok || !res.body) throw new Error("Download do render falhou");
  const length = Number(res.headers.get("Content-Length"));
  if (length > maxBytes) { await res.body.cancel(); throw new Error("Render excede limite configurado"); }
  const chunks: Uint8Array[] = [];
  const reader = res.body.getReader();
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) throw new Error("Render excede limite configurado");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const media = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { media.set(chunk, offset); offset += chunk.length; }
  if (!size || createHash("sha256").update(media).digest("hex") !== hash) throw new Error("Bytes do vídeo divergem do render aprovado");
  return media;
}

export async function publishYoutube(args: { episodeId: string; supabaseUrl: string; auth: YoutubeAuth; store: PublishStore;
  target: { variant: "landscape" | "portrait"; privacy: "private" | "public" };
  http?: HttpFetch; sleep?: (ms: number) => Promise<void> }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.episodeId)) throw new Error("UUID inválido");
  if (!/^UC[\w-]{22}$/.test(args.auth.channelId)) throw new Error("YOUTUBE_CHANNEL_ID inválido");
  const owner = randomUUID();
  const row = await args.store.claim(args.episodeId, owner);
  if (row.status === "published") {
    if (!row.external_id || !/^[\w-]{11}$/.test(row.external_id)) throw new Error("Registro concluído sem ID válido");
    return { videoId: row.external_id, alreadyUploaded: true };
  }
  const plan = youtubePlan(row.review_snapshot, row.upload_config, args.supabaseUrl, args.target);
  const http = args.http ?? fetch;
  const media = await downloadApprovedMedia(plan.url, plan.hash, plan.maxBytes, http);
  const client = new YoutubeClient(args.auth, http);
  await client.connect();
  const guard = () => args.store.guard(row.id, owner);
  await guard();
  let session = row.session_url;
  if (session) {
    if (row.media_sha256 !== plan.hash || row.media_bytes !== media.length || row.channel_id !== args.auth.channelId) {
      throw new Error("Checkpoint pertence a outro arquivo/canal");
    }
  } else {
    await args.store.authorizeSession(row.id, owner);
    session = await client.start(plan.body, media.length);
    // Never send media before the durable checkpoint is confirmed by PostgreSQL.
    await args.store.checkpoint(row.id, owner, session, plan.hash, media.length, args.auth.channelId);
  }
  const videoId = await resumeUpload(client, session, media, guard, args.sleep, args.target.privacy);
  await args.store.finish(row.id, owner, videoId);
  return { videoId, alreadyUploaded: false };
}

export function publishYoutubePrivate(args: Omit<Parameters<typeof publishYoutube>[0], "target">) {
  return publishYoutube({ ...args, target: { variant: "landscape", privacy: "private" } });
}
