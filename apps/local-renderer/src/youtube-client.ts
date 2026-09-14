// ADR-019: no automatic POST retries; resume only the persisted Google session.
export type HttpFetch = typeof fetch;
export class YoutubeError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;
  constructor(message: string, status = 0, retryAfterMs = 0) { super(message); this.status = status; this.retryAfterMs = retryAfterMs; }
}
export async function safeFetch(http: HttpFetch, url: string, init: RequestInit = {}): Promise<Response> {
  try { return await http(url, { ...init, redirect: init.redirect ?? "error", signal: AbortSignal.timeout(60_000) }); }
  catch { throw new YoutubeError("Falha de rede; retome a sessão persistida (detalhes sensíveis omitidos)"); }
}
export function sessionUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/upload/youtube/v3/videos"
    || !url.searchParams.get("upload_id") || url.username || url.password || url.hash) throw new YoutubeError("Sessão YouTube inválida");
  return url.href;
}
export interface YoutubeAuth { clientId: string; clientSecret: string; refreshToken: string; channelId: string }
export class YoutubeClient {
  private token = "";
  private readonly auth: YoutubeAuth;
  private readonly http: HttpFetch;
  constructor(auth: YoutubeAuth, http: HttpFetch = fetch) { this.auth = auth; this.http = http; }
  async connect(): Promise<void> {
    const res = await safeFetch(this.http, "https://oauth2.googleapis.com/token", { method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: this.auth.clientId,
        client_secret: this.auth.clientSecret, refresh_token: this.auth.refreshToken }) });
    if (!res.ok) throw new YoutubeError(`OAuth recusado (${res.status}); confira consentimento e credenciais`, res.status);
    const data = await res.json() as { access_token?: unknown };
    if (typeof data.access_token !== "string" || !data.access_token) throw new YoutubeError("OAuth sem access token");
    this.token = data.access_token;
    const channel = await this.call("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true");
    if (!channel.ok) throw new YoutubeError(`Falha ao validar canal (${channel.status})`, channel.status);
    const channels = await channel.json() as { items?: { id: string }[] };
    if (channels.items?.length !== 1 || channels.items[0]?.id !== this.auth.channelId) throw new YoutubeError("OAuth pertence a outro canal");
  }
  private call(url: string, init: RequestInit = {}): Promise<Response> {
    return safeFetch(this.http, url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${this.token}` } });
  }
  async start(body: unknown, bytes: number): Promise<string> {
    const res = await this.call("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status,paidProductPlacementDetails&notifySubscribers=false", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(bytes) },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new YoutubeError(`Início do upload recusado (${res.status})`, res.status);
    return sessionUrl(res.headers.get("Location") ?? "");
  }
  async status(url: string, bytes: number): Promise<UploadProgress> {
    return await uploadProgress(await this.call(sessionUrl(url), { method: "PUT",
      redirect: "manual",
      headers: { "Content-Length": "0", "Content-Range": `bytes */${bytes}` } }), bytes);
  }
  async chunk(url: string, bytes: Uint8Array<ArrayBuffer>, offset: number, total: number): Promise<UploadProgress> {
    return await uploadProgress(await this.call(sessionUrl(url), { method: "PUT", redirect: "manual", body: bytes,
      headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength),
        "Content-Range": `bytes ${offset}-${offset + bytes.byteLength - 1}/${total}` } }), total);
  }
}
export type UploadProgress = { offset: number; retryAfterMs: number; videoId?: never } | { videoId: string; offset?: never };
function retryDelay(res: Response): number {
  const retry = res.headers.get("Retry-After");
  return retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) || 0 : 0;
}
async function uploadProgress(res: Response, total: number): Promise<UploadProgress> {
  if (res.status === 308) {
    const range = res.headers.get("Range");
    const match = range?.match(/^bytes=0-([0-9]+)$/);
    if (range && !match) throw new YoutubeError("Range de upload inválido");
    const offset = match ? Number(match[1]) + 1 : 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total) throw new YoutubeError("Progresso de upload inválido");
    return { offset, retryAfterMs: retryDelay(res) };
  }
  if (res.status === 200 || res.status === 201) {
    const result = await res.json() as { id?: string; status?: { privacyStatus?: string } };
    if (!result.id || !/^[\w-]{11}$/.test(result.id) || result.status?.privacyStatus !== "private") throw new YoutubeError("Confirmação sem ID/privacidade privada; reconcilie a sessão");
    return { videoId: result.id };
  }
  if (res.status === 404 || res.status === 410) throw new YoutubeError("Sessão expirada; reconcilie no YouTube Studio antes de qualquer novo upload", res.status);
  throw new YoutubeError(`Upload interrompido (${res.status}); sessão preservada`, res.status, retryDelay(res));
}

export async function resumeUpload(client: YoutubeClient, url: string, media: Uint8Array<ArrayBuffer>,
  guard: () => Promise<void>, sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  let failures = 0;
  let offset: number | undefined;
  while (true) {
    await guard();
    try {
      const result = offset === undefined ? await client.status(url, media.length)
        : await client.chunk(url, media.slice(offset, offset + 8 * 1024 * 1024), offset, media.length);
      if (result.videoId !== undefined) return result.videoId;
      if (offset !== undefined && result.offset <= offset) throw new YoutubeError("Upload não avançou");
      offset = result.offset;
      if (result.retryAfterMs > 60_000) throw new YoutubeError("Provedor pediu pausa longa; retome a sessão mais tarde", 429, result.retryAfterMs);
      if (result.retryAfterMs) await sleep(result.retryAfterMs);
    } catch (error) {
      if (!(error instanceof YoutubeError) || (error.status !== 0 && error.status !== 429 && error.status < 500)
        || error.retryAfterMs > 60_000 || ++failures > 3) throw error;
      offset = undefined; // Query server before resending any bytes after ambiguity.
      await sleep(Math.max(error.retryAfterMs, 1000 * 2 ** failures));
    }
  }
}
