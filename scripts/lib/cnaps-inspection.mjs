/** Discovery only: no flow creation, uploads, generation, billing, or general tool runner. */
const ENDPOINT = 'https://mcp.cnaps.ai/mcp';
const PROTOCOL = '2025-06-18';
const MAX_BYTES = 4 * 1024 * 1024;
const READS = ['get_workspace_info', 'get_usage', 'list_models'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class CnapsInspectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new CnapsInspectionError(code); };

function parse(text) {
  try { return JSON.parse(text); } catch { fail('invalid_json'); }
}
function rpcResult(message, id) {
  if (!record(message) || message.jsonrpc !== '2.0' || message.id !== id ||
      Object.hasOwn(message, 'method')) fail('invalid_rpc_reply');
  if (Object.hasOwn(message, 'error')) fail('provider_rpc_error');
  if (!Object.hasOwn(message, 'result')) fail('invalid_rpc_reply');
  return message.result;
}

/** Reads a bounded response; SSE stops at this request's reply, not at connection close. */
async function readReply(response, id) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!['application/json', 'text/event-stream'].includes(type)) fail('unexpected_content_type');
  const reader = response.body?.getReader();
  if (!reader) fail('missing_response_body');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let bytes = 0, text = '', pendingCR = false;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (value) {
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) fail('response_too_large');
      }
      let chunk = decoder.decode(value, {stream: !done});
      if (type === 'application/json') text += chunk;
      else {
        // SSE accepts CR, LF, and CRLF, including a CRLF split across chunks.
        if (pendingCR && chunk.startsWith('\n')) chunk = chunk.slice(1);
        if (chunk.length) pendingCR = chunk.endsWith('\r');
        text += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let end;
        while ((end = text.indexOf('\n\n')) >= 0) {
          const event = text.slice(0, end); text = text.slice(end + 2);
          const data = event.split('\n').filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (!data) continue;
          const message = parse(data);
          if (record(message) && message.id === id) return rpcResult(message, id);
          // Ignore notifications and other IDs; never execute server requests.
        }
      }
      if (done) {
        if (type === 'application/json') return rpcResult(parse(text), id);
        fail('missing_rpc_reply');
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* Do not expose transport details. */ }
    reader.releaseLock();
  }
}

/** Only types and a small vocabulary of field names leave memory; no account values. */
function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (depth >= 5) return Array.isArray(value) ? 'array' : typeof value;
  if (Array.isArray(value)) return {type: 'array', length: value.length,
    first: value.length ? shape(value[0], depth + 1) : null};
  if (!record(value)) return typeof value;
  const allowed = /^(data|result|workspace|plan|subscription|usage|limits|capacity|gpu|models|items|pagination|id|model_id|name|status|type|tier|is_trial|trial|trial_ends_at|expires_at|reset_at|reset_time|remaining|used|total|percentage|limit|seconds|minutes|hours|period|next_reset|input_type|output_type|parameters|watermark|features|has_more|next_cursor)$/;
  const entries = Object.entries(value);
  const retained = entries.filter(([key]) => allowed.test(key)).slice(0, 40);
  return {type: 'object', fields: Object.fromEntries(retained.map(([key, item]) =>
    [key, shape(item, depth + 1)])), omitted_fields: entries.length - retained.length};
}
function toolData(result) {
  if (!record(result) || result.isError === true) fail('provider_tool_error');
  if (record(result.structuredContent)) return result.structuredContent;
  if (Array.isArray(result.content) && result.content.length === 1 &&
      result.content[0]?.type === 'text' && typeof result.content[0].text === 'string') {
    // JSON is data only; prose/instructions are neither printed nor executed.
    return parse(result.content[0].text);
  }
  fail('unknown_tool_response');
}

export async function inspectCnaps(key, {fetchImpl = fetch, now = () => new Date()} = {}) {
  if (typeof key !== 'string' || key.length < 16 || key.length > 8192 ||
      /[^\x21-\x7e]/.test(key)) fail('missing_or_invalid_key');
  let session, initialized = false, sequence = 0;
  const request = async (method, params, notification = false) => {
    const id = notification ? undefined : ++sequence;
    try {
      const headers = {'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'x-api-key': key};
      if (session) headers['Mcp-Session-Id'] = session;
      if (initialized) headers['MCP-Protocol-Version'] = PROTOCOL;
      const response = await fetchImpl(ENDPOINT, {method: 'POST', headers,
        body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params}),
        redirect: 'error', signal: AbortSignal.timeout(25_000)});
      if (!response.ok) {
        await response.body?.cancel();
        fail(({401: 'invalid_key', 403: 'access_denied', 429: 'rate_limited'})[response.status]
          ?? 'provider_http_error');
      }
      if (notification) {
        await response.body?.cancel();
        if (response.status !== 202) fail('unexpected_notification_reply');
        return;
      }
      const result = await readReply(response, id);
      if (method === 'initialize') {
        const candidate = response.headers.get('Mcp-Session-Id');
        if (candidate !== null) {
          if (!/^[\x21-\x7e]{1,1024}$/.test(candidate)) fail('invalid_session');
          session = candidate;
        }
      }
      return result;
    } catch (error) {
      if (error instanceof CnapsInspectionError) throw error;
      fail('provider_read_failed');
    }
  };
  const hello = await request('initialize', {protocolVersion: PROTOCOL, capabilities: {},
    clientInfo: {name: 'content-ai-readonly-discovery', version: '1.0.0'}});
  if (!record(hello) || hello.protocolVersion !== PROTOCOL || !record(hello.capabilities?.tools)) {
    fail('unsupported_protocol_or_capabilities');
  }
  initialized = true;
  await request('notifications/initialized', {}, true);
  const tools = new Map(), seen = new Set();
  let cursor;
  for (let page = 0; page < 8; page++) {
    const catalog = await request('tools/list', cursor ? {cursor} : {});
    if (!record(catalog) || !Array.isArray(catalog.tools) || catalog.tools.length > 500) {
      fail('unknown_tool_catalog');
    }
    for (const tool of catalog.tools) {
      if (record(tool) && READS.includes(tool.name)) {
        if (tools.has(tool.name)) fail('duplicate_read_tool');
        tools.set(tool.name, tool);
      }
    }
    cursor = catalog.nextCursor;
    if (cursor === undefined) break;
    if (typeof cursor !== 'string' || !cursor.length || cursor.length > 4096 || seen.has(cursor)) {
      fail('invalid_catalog_cursor');
    }
    seen.add(cursor);
    if (page === 7) fail('catalog_page_limit');
  }
  // Validate all contracts before any tool call. Discovery never calls suggested tools.
  for (const name of READS) {
    const schema = tools.get(name)?.inputSchema;
    if (!record(schema) || schema.type !== 'object' ||
        (schema.required !== undefined && !Array.isArray(schema.required))) fail('unknown_read_tool_schema');
    const args = name === 'list_models' ? {output_type: 'video'} : {};
    if (schema.required?.some(field => !Object.hasOwn(args, field)) ||
        (name === 'list_models' && schema.properties?.output_type?.type !== 'string')) {
      fail('unknown_read_tool_schema');
    }
  }
  const observations = {};
  for (const name of READS) {
    const result = toolData(await request('tools/call', {name,
      arguments: name === 'list_models' ? {output_type: 'video'} : {}}));
    observations[name] = shape(result);
  }
  return {version: 1, provider: 'cnaps', mode: 'read_only', checked_at: now().toISOString(),
    transport_verified: true, read_tools_observed: READS.slice(), response_shapes: observations,
    account_plan_verified: false, recurring_free_entitlement_verified: false,
    free_capacity: null, estimated_video_seconds: null, estimated_chapters: null,
    production_ready: false, generation_submitted: false,
    blockers: ['account_contract_mapping_required', 'base_free_vs_trial_unverified',
      'free_model_entitlement_unverified', 'watermark_and_terms_review_required',
      'quality_review_required']};
}
