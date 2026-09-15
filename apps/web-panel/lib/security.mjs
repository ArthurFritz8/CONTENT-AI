export class PanelError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const statuses = [
  "idea",
  "research",
  "script",
  "assets",
  "rendered",
  "review",
  "published",
  "analyze",
  "failed",
];
export function uuid(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new PanelError("Identificador inválido.");
  return value;
}
export function allowedUser(id, configured = "") {
  return (
    typeof id === "string" &&
    configured
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .includes(id)
  );
}
export function assertOrigin(request, configured) {
  let expected;
  try {
    expected = new URL(configured).origin;
  } catch {
    throw new PanelError("Endereço do painel não configurado.", 503);
  }
  if (
    request.headers.get("origin") !== expected ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new PanelError("Origem da requisição não autorizada.", 403);
}
export function httpsUrl(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      value.length <= 2048
    )
      return u.href;
  } catch {
    /* handled below */
  }
  throw new PanelError("Informe um link HTTPS válido, sem credenciais.");
}
export function mediaUrl(value, supabaseUrl) {
  try {
    const u = new URL(value),
      base = new URL(supabaseUrl);
    return u.origin === base.origin &&
      u.protocol === "https:" &&
      !u.search &&
      !u.hash &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith("/storage/v1/object/public/")
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function redact(value, secrets = []) {
  let text = String(value ?? "").slice(0, 6000);
  for (const secret of secrets.filter(
    (x) => typeof x === "string" && x.length > 6,
  ))
    text = text.split(secret).join("[oculto]");
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [oculto]")
    .replace(
      /(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:sbp|ghp|gho|ghs|github_pat)_[\w-]{15,}|GOCSPX-[\w-]+|AIza[\w-]+)/g,
      "[oculto]",
    )
    .replace(/https?:\/\/[^\s"<>]+/g, (raw) => {
      try {
        const u = new URL(raw);
        u.username = "";
        u.password = "";
        if (u.search) u.search = "redacted";
        return u.href;
      } catch {
        return "[URL oculta]";
      }
    });
}
export function pagination(params) {
  const page = Number(params.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new PanelError("Página inválida.");
  const search = (params.get("search") ?? "").trim();
  if (search.length > 100 || /[(),*%\\]/.test(search))
    throw new PanelError("Busca inválida; use palavras ou parte do título.");
  const status = params.get("status") ?? "";
  if (status && !statuses.includes(status))
    throw new PanelError("Estado inválido.");
  return { page, search, status, limit: 20, offset: (page - 1) * 20 };
}
export function mutation(input) {
  if (!input || typeof input !== "object")
    throw new PanelError("Dados inválidos.");
  const requestId = uuid(input.requestId),
    action = input.action;
  const p = input.payload;
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw new PanelError("Dados inválidos.");
  const result = {};
  if (["add", "edit", "cancel"].includes(action)) {
    if (action !== "add") {
      result.id = uuid(p.id);
      result.revision = p.revision;
      if (!Number.isInteger(p.revision) || p.revision < 0)
        throw new PanelError("Versão da pauta inválida.");
    }
    if (action !== "cancel") {
      if (
        typeof p.briefing !== "string" ||
        p.briefing.trim().length < 20 ||
        p.briefing.trim().length > 2000
      )
        throw new PanelError(
          "A pauta precisa ter entre 20 e 2.000 caracteres.",
        );
      if (!Number.isInteger(p.priority) || p.priority < 1 || p.priority > 1000)
        throw new PanelError("Prioridade deve ser de 1 a 1.000.");
      result.briefing = p.briefing.trim();
      result.priority = p.priority;
      result.product_url = httpsUrl(p.product_url);
    }
  } else if (action === "pipeline") {
    if (
      typeof p.enabled !== "boolean" ||
      !Number.isInteger(p.max_episodes_per_day) ||
      p.max_episodes_per_day < 1 ||
      p.max_episodes_per_day > 10
    )
      throw new PanelError("Limite diário deve ser de 1 a 10.");
    if (
      typeof p.revision !== "string" ||
      !Number.isFinite(Date.parse(p.revision))
    )
      throw new PanelError("Atualize as configurações antes de salvar.");
    Object.assign(result, {
      enabled: p.enabled,
      max_episodes_per_day: p.max_episodes_per_day,
      revision: p.revision,
    });
  } else if (action === "niche") {
    if (
      typeof p.focus !== "string" ||
      p.focus.trim().length < 10 ||
      p.focus.length > 500 ||
      typeof p.revision !== "string" ||
      !Number.isFinite(Date.parse(p.revision))
    )
      throw new PanelError(
        "Foco editorial deve ter entre 10 e 500 caracteres.",
      );
    Object.assign(result, { focus: p.focus.trim(), revision: p.revision });
  } else throw new PanelError("Operação não disponível.");
  return { requestId, action, payload: result };
}
