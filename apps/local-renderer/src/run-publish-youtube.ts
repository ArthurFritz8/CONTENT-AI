import { publishYoutube, type PublishRow, type PublishStore } from "./publish-youtube.ts";
import { safeFetch, YoutubeError } from "./youtube-client.ts";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Configuração ausente: ${name}`);
  return value;
}
async function main() {
  const supabaseUrl = new URL(env("SUPABASE_URL"));
  if (supabaseUrl.protocol !== "https:" || supabaseUrl.username || supabaseUrl.password || supabaseUrl.pathname !== "/" || supabaseUrl.search || supabaseUrl.hash) {
    throw new Error("SUPABASE_URL deve ser uma origem HTTPS");
  }
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const target = process.env.YOUTUBE_TARGET === "public_short"
    ? { variant: "portrait" as const, privacy: "public" as const }
    : { variant: "landscape" as const, privacy: "private" as const };
  const suffix = target.privacy === "public" ? "_youtube_short_upload" : "_youtube_upload";
  async function rpc<T>(name: string, body: unknown): Promise<T> {
    const res = await safeFetch(fetch, `${supabaseUrl.origin}/rest/v1/rpc/${name}`, { method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`RPC ${name} recusada (${res.status}); confira aprovação, flag e lease no banco`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const store: PublishStore = {
    claim: (episodeId, owner) => rpc<PublishRow>(`claim${suffix}`, { p_episode_id: episodeId, p_owner: owner }),
    guard: (id, owner) => rpc(`check${suffix}`, { p_id: id, p_owner: owner }),
    authorizeSession: (id, owner) => rpc(`authorize${suffix}`, { p_id: id, p_owner: owner }),
    checkpoint: (id, owner, url, hash, bytes, channel) => rpc(`save${suffix.replace("upload", "session")}`, {
      p_id: id, p_owner: owner, p_url: url, p_hash: hash, p_bytes: bytes, p_channel: channel }),
    finish: (id, owner, videoId) => rpc(`finish${suffix}`, { p_id: id, p_owner: owner, p_video_id: videoId }),
  };
  const result = await publishYoutube({ episodeId: env("EPISODE_ID"), supabaseUrl: supabaseUrl.origin, store, target,
    auth: { clientId: env("YOUTUBE_CLIENT_ID"), clientSecret: env("YOUTUBE_CLIENT_SECRET"),
      refreshToken: env("YOUTUBE_REFRESH_TOKEN"), channelId: env("YOUTUBE_CHANNEL_ID") } });
  console.log(JSON.stringify({ ...result, privacy: target.privacy, studioUrl: `https://studio.youtube.com/video/${result.videoId}/edit` }));
}
main().catch((error: unknown) => {
  // Do not print raw provider/DB exceptions: URLs, tokens and review text can occur in them.
  console.error("Upload privado interrompido. Confira configuração, aprovação e registro em publishes. A sessão foi preservada quando disponível; aguarde a lease de 20 minutos para retomar. Não apague o registro para repetir o envio.");
  if (error instanceof YoutubeError) console.error(error.message);
  process.exitCode = 1;
});
