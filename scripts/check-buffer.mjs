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
  channels.push(...(data.channels ?? []).filter(channel => channel.service === "tiktok"));
}
console.log(JSON.stringify({ tiktok_channels: channels }, null, 2));
if (channels.length !== 1) process.exitCode = 2;
