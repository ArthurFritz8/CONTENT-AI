import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const envFile = process.argv[2] ?? ".env.cloud";
const redirectUri = "http://127.0.0.1:42813/oauth2/callback";

function envValue(name) {
  const line = readFileSync(envFile, "utf8").split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim();
  if (!value || /^(CHANGE|TODO|YOUR|<)/.test(value)) throw new Error(`${name} não está configurado em ${envFile}.`);
  return value;
}

function saveEnvValue(name, value) {
  const contents = readFileSync(envFile, "utf8");
  if (!new RegExp(`^${name}=`, "m").test(contents)) throw new Error(`${name} não existe em ${envFile}.`);
  writeFileSync(envFile, contents.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`));
}

const clientId = envValue("YOUTUBE_CLIENT_ID");
const clientSecret = envValue("YOUTUBE_CLIENT_SECRET");
const expectedChannel = envValue("YOUTUBE_CHANNEL_ID");
const state = randomBytes(24).toString("base64url");
const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authorizationUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  access_type: "offline",
  prompt: "consent",
  state,
}).toString();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", redirectUri);
    if (url.pathname !== "/oauth2/callback") {
      response.writeHead(404).end("Página não encontrada.");
      return;
    }
    if (url.searchParams.get("state") !== state) throw new Error("Estado OAuth inválido. Feche esta página e execute novamente.");
    if (url.searchParams.get("error")) throw new Error(`Autorização recusada: ${url.searchParams.get("error")}.`);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("O Google não retornou o código de autorização.");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || typeof token.access_token !== "string" || typeof token.refresh_token !== "string") {
      throw new Error(`OAuth recusado (${tokenResponse.status}). Revogue o acesso em sua conta Google e tente novamente.`);
    }

    const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const channel = await channelResponse.json();
    const actualChannel = channel.items?.[0]?.id;
    if (!channelResponse.ok || actualChannel !== expectedChannel) {
      throw new Error("A autorização pertence a outro canal. Entre com a conta do Fritz Inova e selecione a identidade correta.");
    }
    saveEnvValue("YOUTUBE_REFRESH_TOKEN", token.refresh_token);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>Conexão do YouTube concluída.</h1><p>Você pode fechar esta janela e voltar ao Codex.</p>");
    console.log("OAuth validado para o canal configurado. Refresh token salvo localmente.");
    server.close();
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>Não foi possível concluir a autorização.</h1><p>Volte ao Codex para ver a orientação.</p>");
    console.error(error instanceof Error ? error.message : error);
  }
});

server.listen(42813, "127.0.0.1", () => {
  console.log("Abra este link no navegador e entre com contentfritza@gmail.com:");
  console.log(authorizationUrl.toString());
});
