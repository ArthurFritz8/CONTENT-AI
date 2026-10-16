/** Bounded MCP transport for one operator audition. No billing, batch or publication tools. */
import {CnapsInspectionError, readReply, toolData} from './cnaps-inspection.mjs';
const ENDPOINT = 'https://mcp.cnaps.ai/mcp';
const VERSION = '2025-06-18';
const TOOLS = new Set(['preview_flow', 'create_flow', 'run_flow', 'get_flow', 'list_flows', 'upload_file']);
const WRITES = new Set(['create_flow', 'run_flow', 'upload_file']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new CnapsInspectionError(code); };
export function cnapsToolErrorCode(result) {
  if (result?.isError !== true) return null;
  const text = Array.isArray(result.content) && result.content.length === 1 &&
    result.content[0]?.type === 'text' ? result.content[0].text : null;
  return text === 'insufficient credits: your usage quota has been exceeded for the current billing period'
    ? 'provider_quota_exceeded' : 'provider_tool_error';
}
export function cnapsMediaUrl(value) {
  let parsed; try { parsed = new URL(value); } catch { fail('invalid_provider_media_url'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'storage.googleapis.com' || parsed.port ||
      parsed.username || parsed.password || parsed.hash) fail('untrusted_provider_media_origin');
  return parsed;
}
export async function fetchCnapsMedia(value, maximum, {fetchImpl = fetch} = {}) {
  const parsed = cnapsMediaUrl(value);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 64 * 1024 * 1024) fail('invalid_media_limit');
  try {
    const response = await fetchImpl(parsed, {redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(45_000)});
    if (!response.ok) { await response.body?.cancel(); fail('media_fetch_failed'); }
    const reader = response.body?.getReader(); if (!reader) fail('media_body_missing');
    const parts = []; let length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        length += value.byteLength; if (length > maximum) fail('media_too_large'); parts.push(value);
      }
    } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    return Buffer.concat(parts);
  } catch (error) {
    if (error instanceof CnapsInspectionError) throw error;
    fail('media_fetch_failed');
  }
}

export async function connectCnapsAudition(key, {fetchImpl = fetch, allowWrites = false,
  audit = async () => {}} = {}) {
  if (typeof key !== 'string' || key.length < 16 || key.length > 8192 || /[^\x21-\x7e]/.test(key)) {
    fail('missing_or_invalid_key');
  }
  let sequence = 0, session, initialized = false;
  async function request(method, params, notification = false) {
    const id = notification ? undefined : ++sequence;
    try {
      const response = await fetchImpl(ENDPOINT, {method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          'x-api-key': key, ...(session ? {'Mcp-Session-Id': session} : {}),
          ...(initialized ? {'MCP-Protocol-Version': VERSION} : {})},
        body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params}),
        redirect: 'error', signal: AbortSignal.timeout(35_000)});
      if (!response.ok) {
        await response.body?.cancel();
        fail(({401: 'invalid_key', 403: 'access_denied', 429: 'rate_limited'})[response.status] ?? 'provider_http_error');
      }
      if (notification) {
        await response.body?.cancel();
        if (response.status !== 202) fail('unexpected_notification_reply');
        return;
      }
      const result = await readReply(response, id);
      if (method === 'initialize') {
        const value = response.headers.get('Mcp-Session-Id');
        if (value !== null && !/^[\x21-\x7e]{1,1024}$/.test(value)) fail('invalid_session');
        session = value;
      }
      return result;
    } catch (error) {
      if (error instanceof CnapsInspectionError) throw error;
      fail('provider_transport_failed');
    }
  }
  const hello = await request('initialize', {protocolVersion: VERSION, capabilities: {},
    clientInfo: {name: 'content-ai-single-free-audition', version: '1.0.0'}});
  if (!record(hello) || hello.protocolVersion !== VERSION || !record(hello.capabilities?.tools)) {
    fail('unsupported_protocol_or_capabilities');
  }
  initialized = true;
  await request('notifications/initialized', {}, true);
  const schemas = new Map(), seen = new Set();
  let cursor;
  for (let page = 0; page < 8; page++) {
    const catalog = await request('tools/list', cursor ? {cursor} : {});
    if (!record(catalog) || !Array.isArray(catalog.tools) || catalog.tools.length > 500) fail('unknown_tool_catalog');
    for (const tool of catalog.tools) if (record(tool) && TOOLS.has(tool.name)) {
      if (schemas.has(tool.name)) fail('duplicate_tool');
      schemas.set(tool.name, tool.inputSchema);
    }
    cursor = catalog.nextCursor;
    if (cursor === undefined) break;
    if (typeof cursor !== 'string' || !cursor.length || cursor.length > 4096 || seen.has(cursor)) fail('invalid_catalog_cursor');
    seen.add(cursor);
    if (page === 7) fail('catalog_page_limit');
  }
  return {
    schemas: Object.fromEntries(schemas),
    async call(name, args) {
      if (!TOOLS.has(name) || (WRITES.has(name) && !allowWrites)) fail('forbidden_audition_tool');
      const schema = schemas.get(name);
      if (!record(args) || schema?.type !== 'object' || !record(schema.properties) ||
          (schema.required !== undefined && (!Array.isArray(schema.required) ||
            schema.required.some(field => !Object.hasOwn(args, field))))) fail('unknown_tool_contract');
      for (const [field, value] of Object.entries(args)) {
        const property = schema.properties[field];
        if (!record(property) || !['string', 'number', 'integer', 'boolean'].includes(property.type) ||
            (property.type === 'integer' ? !Number.isInteger(value) : typeof value !== property.type) ||
            (property.type === 'number' && !Number.isFinite(value))) {
          fail('unknown_tool_contract');
        }
        if (Array.isArray(property.enum) && !property.enum.includes(value)) fail('unknown_tool_contract');
      }
      // Private operator evidence only, never stdout. Bodies are not instructions.
      const result = await request('tools/call', {name, arguments: args});
      await audit(name, result);
      const errorCode = cnapsToolErrorCode(result);
      if (errorCode) fail(errorCode);
      return toolData(result);
    },
  };
}
