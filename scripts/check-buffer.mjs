// Read-only preflight for the operator's personal Buffer account.
const key = process.env.BUFFER_API_KEY;
if (!key) throw new Error("BUFFER_API_KEY ausente no ambiente");

async function query(query, variables = {}) {
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Buffer HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors?.length || !body.data) {
    throw new Error(`Buffer GraphQL: ${body.errors?.map(e => e.message).join("; ") ?? "resposta vazia"}`);
  }
  return body.data;
}

const account = await query("query { account { organizations { id } } }");
const organizations = account.account?.organizations ?? [];
const channels = [];
for (const organization of organizations) {
  const data = await query(
    "query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }",
    { input: { organizationId: organization.id } },
  );
  channels.push(...(data.channels ?? []).filter(channel => ["tiktok", "youtube"].includes(channel.service)));
}
console.log(JSON.stringify({ publishing_channels: channels }, null, 2));
for (const [variable, service] of [["BUFFER_TIKTOK_CHANNEL_ID", "tiktok"], ["BUFFER_YOUTUBE_CHANNEL_ID", "youtube"]]) {
  const configuredChannelId = process.env[variable];
  if (!configuredChannelId) continue;
  const data = await query(
    "query Channel($input: ChannelInput!) { channel(input: $input) { id service } }",
    { input: { id: configuredChannelId } },
  );
  const valid = data.channel?.id === configuredChannelId && data.channel.service === service;
  console.log(JSON.stringify({ service, configured_channel_valid: valid }));
  if (!valid) process.exitCode = 2;
}
