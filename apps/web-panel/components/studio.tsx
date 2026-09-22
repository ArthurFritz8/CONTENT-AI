"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  ExternalLink,
  FileText,
  Film,
  LayoutDashboard,
  Link2,
  ListVideo,
  LoaderCircle,
  LogOut,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  X,
  Video as Youtube,
} from "lucide-react";
import { Preferences, usePreferences } from "./preferences";
import { statuses } from "../lib/security.mjs";

type Row = Record<string, any>;
const nav = [
  ["overview", LayoutDashboard],
  ["queue", ListVideo],
  ["episodes", Clapperboard],
  ["publishes", Youtube],
  ["settings", Settings2],
] as const;
function useData(
  resource: string,
  query: string,
  refresh: number,
  poll: boolean,
) {
  const [state, setState] = useState<{
    data: any;
    error: string;
    loading: boolean;
    time: Date | null;
  }>({ data: null, error: "", loading: true, time: null });
  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    setState({ data: null, error: "", loading: true, time: null });
    async function load() {
      if (running) return;
      running = true;
      try {
        const r = await fetch(`/api/control?resource=${resource}&${query}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (r.status === 401 || r.status === 403) {
          location.assign("/login");
          return;
        }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (active)
          setState({ data: d, error: "", loading: false, time: new Date() });
      } catch (e) {
        if (active)
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : "Error",
            loading: false,
          }));
      } finally {
        running = false;
      }
    }
    void load();
    const timer = poll
      ? setInterval(() => {
          if (document.visibilityState === "visible") void load();
        }, 30000)
      : undefined;
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [resource, query, refresh, poll]);
  return state;
}
function Status({
  value,
  publish = false,
}: {
  value: string;
  publish?: boolean;
}) {
  const { t } = usePreferences();
  const key = publish
    ? (
        {
          published: "publishedStatus",
          pending: "pendingStatus",
          failed: "failedStatus",
        } as Row
      )[value] || value
    : (
        {
          review: "reviewStage",
          published: "publishedStage",
          failed: "failedStage",
        } as Row
      )[value] || value;
  return (
    <span className={`badge status-${value}`}>
      <i />
      {t(key)}
    </span>
  );
}
function Empty({
  text,
  children,
}: {
  text?: string;
  children?: React.ReactNode;
}) {
  const { t } = usePreferences();
  return (
    <div className="empty">
      <Film size={32} />
      <h3>{text || t("empty")}</h3>
      {children}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { t } = usePreferences();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function PageControls({
  total,
  page,
  onPage,
}: {
  total: number;
  page: number;
  onPage: (p: number) => void;
}) {
  const { t } = usePreferences();
  return (
    <div className="pagination">
      <span>
        {total} {t("records")} · {t("page")} {page} {t("of")}{" "}
        {Math.max(1, Math.ceil(total / 20))}
      </span>
      <div>
        <button
          className="icon-button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label={t("previous")}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-button"
          onClick={() => onPage(page + 1)}
          disabled={page * 20 >= total}
          aria-label={t("next")}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
function safeLink(raw: unknown) {
  try {
    const u = new URL(String(raw));
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function ProductLink({ value }: { value: unknown }) {
  const { t } = usePreferences();
  const url = safeLink(value);
  return url ? (
    <a
      className="product-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Link2 size={14} />
      {new URL(url).hostname}
      <ArrowUpRight size={13} />
    </a>
  ) : (
    <span className="muted small">{t("noAffiliate")}</span>
  );
}
function AffiliateLinks({ links, legacy }: { links: unknown; legacy?: unknown }) {
  const { t } = usePreferences();
  const value = links && typeof links === "object" ? links as Row : {};
  const entries = [
    ["YouTube", value.youtube],
    ["TikTok", value.tiktok],
  ].filter(([, link]) => safeLink(link));
  if (!entries.length && safeLink(legacy)) {
    return (
      <div>
        <small>{t("legacyAffiliateLink")}</small>
        <ProductLink value={legacy} />
      </div>
    );
  }
  return entries.length ? (
    <div className="platform-links">
      {entries.map(([platform, link]) => (
        <div key={String(platform)}>
          <small>{platform}</small>
          <ProductLink value={link} />
        </div>
      ))}
    </div>
  ) : <ProductLink value={null} />;
}

export default function Studio({
  section,
  episodeId,
  email,
}: {
  section: string;
  episodeId?: string;
  email: string;
}) {
  const { t, language } = usePreferences();
  const [menu, setMenu] = useState(false),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [refresh, setRefresh] = useState(0),
    [editing, setEditing] = useState<Row | null>(null),
    [removing, setRemoving] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [mutationError, setMutationError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null),
    requestRef = useRef<{ payload: string; id: string } | null>(null);
  const resource =
    section === "episodes" && episodeId
      ? "episode"
      : nav.some(([key]) => key === section)
        ? section
        : "overview";
  const params = new URLSearchParams({
    page: String(page),
    search,
    status,
    ...(episodeId ? { id: episodeId } : {}),
  });
  const { data, error, loading, time } = useData(
    resource,
    params.toString(),
    refresh,
    !editing && !removing && section !== "settings",
  );
  const date = (value: string, short = false) =>
    value
      ? new Intl.DateTimeFormat(language, {
          dateStyle: short ? "short" : "medium",
          ...(!short ? { timeStyle: "short" as const } : {}),
        }).format(new Date(value))
      : "—";
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName,
        ) &&
        !editing &&
        !removing
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editing, removing]);
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timeout);
  }, [message]);
  const mutate = useCallback(
    async (action: string, payload: Row) => {
      setBusy(true);
      setMutationError("");
      const serialized = JSON.stringify({ action, payload });
      if (requestRef.current?.payload !== serialized)
        requestRef.current = { payload: serialized, id: crypto.randomUUID() };
      try {
        const r = await fetch("/api/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            payload,
            requestId: requestRef.current.id,
          }),
        });
        const result = await r.json();
        if (r.status === 401) {
          location.assign("/login");
          return false;
        }
        if (!r.ok) {
          if (r.status === 409) requestRef.current = null;
          throw new Error(result.error);
        }
        requestRef.current = null;
        setMessage(
          t(
            action === "add"
              ? "added"
              : action === "cancel"
                ? "cancelled"
                : "saved",
          ),
        );
        setRefresh((n) => n + 1);
        return true;
      } catch (e) {
        setMutationError(e instanceof Error ? e.message : t("connectionError"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [t],
  );
  async function logout() {
    await fetch("/api/session", { method: "DELETE" });
    location.assign("/login");
  }
  function newIdea() {
    setMutationError("");
    setEditing({
      briefing: "",
      affiliate_links: { youtube: "", tiktok: "" },
      priority: 100,
    });
  }
  function exportRows() {
    const rows = data?.items || [];
    const keys =
      section === "queue"
        ? ["id", "briefing", "affiliate_links", "priority", "created_at"]
        : section === "publishes"
          ? [
              "id",
              "episode_id",
              "platform",
              "status",
              "privacy",
              "external_id",
              "created_at",
            ]
          : ["id", "title", "status", "render_progress", "created_at"];
    const escape = (value: any) => {
      let s = typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value ?? "");
      if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const csv =
      "\uFEFF" +
      [
        keys.join(","),
        ...rows.map((r: Row) => keys.map((k) => escape(r[k])).join(",")),
      ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `fritz-${section}-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage(t("exported"));
  }
  const known = nav.some(([key]) => key === section);
  const settings = data?.settings || [],
    pipeline = settings.find((s: Row) => s.key === "pipeline")?.value;
  return (
    <div className="studio-shell">
      <aside className={`sidebar ${menu ? "visible" : ""}`}>
        <Link className="brand" href="/studio">
          <span className="brand-symbol">
            F<span>↗</span>
          </span>
          <div>
            FRITZ INOVA<small>CONTENT STUDIO</small>
          </div>
        </Link>
        <div className="sidebar-label">{t("workspace")}</div>
        <nav>
          {nav.map(([key, Icon]) => (
            <Link
              key={key}
              href={key === "overview" ? "/studio" : `/studio/${key}`}
              className={section === key ? "selected" : ""}
              onClick={() => setMenu(false)}
              aria-current={section === key ? "page" : undefined}
            >
              <Icon size={19} />
              {t(key)}
              {section === key && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-note">
            <span className="online-dot" />
            <span>
              Fritz Inova<small>{t("restricted")}</small>
            </span>
          </div>
          <Link className="sidebar-site" href="/" target="_blank">
            {t("openWebsite")}
            <ExternalLink size={14} />
          </Link>
        </div>
      </aside>
      {menu && (
        <button
          className="menu-overlay"
          aria-label={t("close")}
          onClick={() => setMenu(false)}
        />
      )}
      <div className="studio-main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label={t("openMenu")}
            >
              <Menu size={21} />
            </button>
            <span>Studio</span>
            <span>/</span>
            <strong>{t(section)}</strong>
            {episodeId && (
              <>
                <span>/</span>
                <span>{episodeId.slice(0, 8)}</span>
              </>
            )}
          </div>
          <div className="top-actions">
            <Preferences compact />
            <span className="user-avatar" title={email}>
              {email?.slice(0, 1).toUpperCase() || "F"}
            </span>
            <button
              className="icon-button"
              onClick={logout}
              title={t("logout")}
              aria-label={t("logout")}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="studio-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FRITZ INOVA / {t("operation")}</div>
              <h1>
                {episodeId
                  ? t("details")
                  : t(section === "overview" ? "welcome" : section)}
              </h1>
              <p>
                {!episodeId &&
                  t(
                    section === "overview"
                      ? "overviewSubtitle"
                      : `${section}Subtitle`,
                  )}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                onClick={() => setRefresh((n) => n + 1)}
                disabled={loading}
              >
                <RefreshCw size={16} className={loading ? "spin" : ""} />
                <span>{t("refresh")}</span>
              </button>
              {["overview", "queue"].includes(section) && (
                <button className="button primary" onClick={newIdea}>
                  <Plus size={18} />
                  {t("newIdea")}
                </button>
              )}
            </div>
          </div>
          {message && (
            <div className="toast" role="status">
              <Check size={18} />
              {message}
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              <TriangleAlert size={19} />
              <div>
                <strong>{t(data ? "stale" : "connectionError")}</strong>
                <p>{t(error)}</p>
              </div>
              <button
                className="button secondary"
                onClick={() => setRefresh((n) => n + 1)}
              >
                {t("retry")}
              </button>
            </div>
          )}
          {loading && !data ? (
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" size={25} />
              {t("loading")}
            </div>
          ) : !known ? (
            <Empty text={t("notFound")}>
              <Link href="/studio">{t("home")}</Link>
            </Empty>
          ) : (
            data && (
              <>
                {section === "overview" && (
                  <>
                    <div className="metrics">
                      {(
                        [
                          "pending",
                          "active",
                          "review",
                          "published",
                          "failed",
                        ] as const
                      ).map((key, i) => (
                        <Link
                          className={`metric metric-${key}`}
                          href={
                            key === "pending"
                              ? "/studio/queue"
                              : key === "published"
                                ? "/studio/publishes"
                                : "/studio/episodes"
                          }
                          key={key}
                        >
                          <div>
                            <span>{t(key)}</span>
                            {
                              [
                                <ListVideo />,
                                <Clapperboard />,
                                <ShieldCheck />,
                                <Youtube />,
                                <TriangleAlert />,
                              ][i]
                            }
                          </div>
                          <strong>
                            {new Intl.NumberFormat(language).format(
                              data.counts[key],
                            )}
                          </strong>
                          <ArrowUpRight size={16} />
                        </Link>
                      ))}
                    </div>
                    <p className="count-note">{t("countNote")}</p>
                    <div
                      className={`pipeline-banner ${pipeline?.enabled ? "running" : ""}`}
                    >
                      <div className="pipeline-symbol">
                        {pipeline?.enabled ? (
                          <Play size={22} />
                        ) : (
                          <Pause size={22} />
                        )}
                      </div>
                      <div>
                        <h2>
                          {t("pipeline")}{" "}
                          <span>
                            {t(pipeline?.enabled ? "enabled" : "paused")}
                          </span>
                        </h2>
                        <p>
                          {t(pipeline?.enabled ? "enabledHint" : "pausedHint")}
                        </p>
                      </div>
                      <Link
                        className="button secondary"
                        href="/studio/settings"
                      >
                        {t("manage")}
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                    <div className="overview-grid">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>{t("recent")}</h2>
                          <Link href="/studio/episodes">
                            {t("seeAll")}
                            <ArrowRight size={15} />
                          </Link>
                        </div>
                        <EpisodeRows rows={data.recent} date={date} />
                      </section>
                      <section className="panel activity-panel">
                        <div className="panel-heading">
                          <h2>{t("activity")}</h2>
                          <Clock3 size={18} />
                        </div>
                        <Events events={data.events} date={date} compact />
                      </section>
                    </div>
                    <section className="flow-strip">
                      <span>{t("productionFlow")}</span>
                      {[
                        "idea",
                        "research",
                        "script",
                        "assets",
                        "rendered",
                        "reviewStage",
                      ].map((step, i) => (
                        <div key={step}>
                          <b>{String(i + 1).padStart(2, "0")}</b>
                          {t(step)}
                          {i < 5 && <ChevronRight size={14} />}
                        </div>
                      ))}
                    </section>
                  </>
                )}
                {section === "queue" && (
                  <section className="panel">
                    <Toolbar
                      searchRef={searchRef}
                      search={search}
                      onSearch={(s) => {
                        setSearch(s);
                        setPage(1);
                      }}
                      onExport={exportRows}
                    />
                    {data.items.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>{t("briefing")}</th>
                              <th>{t("product")}</th>
                              <th>{t("priority")}</th>
                              <th>{t("created")}</th>
                              <th>{t("actions")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.items.map((r: Row) => (
                              <tr key={r.id}>
                                <td className="wide-cell">
                                  <strong>{r.briefing}</strong>
                                  <small>#{r.id.slice(0, 8)}</small>
                                  {r.source === "trend_discovery" && !r.validated_at && <small>{t("candidateHint")}</small>}
                                </td>
                                <td>
                                  <AffiliateLinks
                                    links={r.affiliate_links}
                                    legacy={r.product_url}
                                  />
                                </td>
                                <td>
                                  <span className="priority">{r.priority}</span>
                                </td>
                                <td className="nowrap">
                                  {date(r.created_at, true)}
                                </td>
                                <td>
                                  <div className="row-actions">
                                    <button
                                      className="button small secondary"
                                      onClick={() => {
                                        setMutationError("");
                                        setEditing({
                                          ...r,
                                          affiliate_links: {
                                            ...(r.affiliate_links || {}),
                                            youtube:
                                              r.affiliate_links?.youtube ||
                                              r.product_url ||
                                              "",
                                            tiktok:
                                              r.affiliate_links?.tiktok || "",
                                          },
                                        });
                                      }}
                                    >
                                      {t("edit")}
                                    </button>
                                    <button
                                      className="icon-button danger-text"
                                      title={t("cancelIdea")}
                                      aria-label={`${t("cancelIdea")}: ${r.briefing}`}
                                      onClick={() => {
                                        setMutationError("");
                                        setRemoving(r);
                                      }}
                                    >
                                      <X size={18} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty text={search ? t("noResults") : t("queueEmpty")}>
                        <button className="button primary" onClick={newIdea}>
                          <Plus size={16} />
                          {t("newIdea")}
                        </button>
                      </Empty>
                    )}
                    <PageControls
                      page={page}
                      total={data.total}
                      onPage={setPage}
                    />
                  </section>
                )}
                {section === "episodes" && !episodeId && (
                  <section className="panel">
                    <Toolbar
                      searchRef={searchRef}
                      search={search}
                      onSearch={(s) => {
                        setSearch(s);
                        setPage(1);
                      }}
                      onExport={exportRows}
                    >
                      <select
                        aria-label={t("filter")}
                        value={status}
                        onChange={(e) => {
                          setStatus(e.target.value);
                          setPage(1);
                        }}
                      >
                        <option value="">{t("all")}</option>
                        {statuses.map((s) => (
                          <option key={s} value={s}>
                            {t(
                              s === "review"
                                ? "reviewStage"
                                : s === "failed"
                                  ? "failedStage"
                                  : s === "published"
                                    ? "publishedStage"
                                    : s,
                            )}
                          </option>
                        ))}
                      </select>
                    </Toolbar>
                    <EpisodeRows rows={data.items} date={date} />
                    <PageControls
                      page={page}
                      total={data.total}
                      onPage={setPage}
                    />
                  </section>
                )}
                {section === "episodes" && episodeId && (
                  <EpisodeDetail data={data} date={date} />
                )}
                {section === "publishes" && (
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>{t("publishes")}</h2>
                      <button
                        className="icon-button"
                        title={t("downloadList")}
                        aria-label={t("downloadList")}
                        onClick={exportRows}
                      >
                        <ArrowDownToLine size={18} />
                      </button>
                    </div>
                    <PublishRows rows={data.items} date={date} />
                    <PageControls
                      page={page}
                      total={data.total}
                      onPage={setPage}
                    />
                  </section>
                )}
                {section === "settings" && (
                  <Settings
                    data={data}
                    mutate={mutate}
                    busy={busy}
                    error={mutationError}
                  />
                )}
              </>
            )
          )}
          {time && (
            <div className="last-updated">
              <span className="online-dot" />
              {t("updated")}{" "}
              {new Intl.DateTimeFormat(language, {
                timeStyle: "medium",
              }).format(time)}
            </div>
          )}
        </main>
      </div>
      {editing && (
        <Modal
          title={t(editing.id ? "edit" : "newIdea")}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await mutate(editing.id ? "edit" : "add", editing))
                setEditing(null);
            }}
          >
            <label>
              {t("briefing")}
              <textarea
                autoFocus
                required
                minLength={20}
                maxLength={2000}
                rows={5}
                value={editing.briefing}
                onChange={(e) =>
                  setEditing({ ...editing, briefing: e.target.value })
                }
              />
              <small>
                {t("briefingHint")}{" "}
                <span className="char-count">
                  {editing.briefing.length}/2000
                </span>
              </small>
            </label>
            <label>
              {t("youtubeAffiliateLink")}
              <input
                type="url"
                placeholder="https://…"
                maxLength={2048}
                value={editing.affiliate_links?.youtube || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    affiliate_links: {
                      ...(editing.affiliate_links || {}),
                      youtube: e.target.value,
                    },
                  })
                }
              />
              <small>{t("youtubeLinkHint")}</small>
            </label>
            <label>
              {t("tiktokAffiliateLink")}
              <input
                type="url"
                placeholder="https://…"
                maxLength={2048}
                value={editing.affiliate_links?.tiktok || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    affiliate_links: {
                      ...(editing.affiliate_links || {}),
                      tiktok: e.target.value,
                    },
                  })
                }
              />
              <small>{t("tiktokLinkHint")}</small>
            </label>
            <label>
              {t("priority")}
              <input
                type="number"
                min={1}
                max={1000}
                required
                value={editing.priority}
                onChange={(e) =>
                  setEditing({ ...editing, priority: Number(e.target.value) })
                }
              />
              <small>{t("priorityHint")}</small>
            </label>
            {mutationError && (
              <div className="error" role="alert">
                {t(mutationError)}
              </div>
            )}
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                {t("cancel")}
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? t("saving") : t(editing.id ? (editing.source === "trend_discovery" && !editing.validated_at ? "validateIdea" : "save") : "createIdea")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title={t("confirmCancel")}
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <p>{t("confirmCancelHint")}</p>
          <blockquote>{removing.briefing}</blockquote>
          {mutationError && (
            <div className="error" role="alert">
              {t(mutationError)}
            </div>
          )}
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              {t("cancel")}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await mutate("cancel", {
                    id: removing.id,
                    revision: removing.revision,
                  })
                )
                  setRemoving(null);
              }}
            >
              {t(busy ? "saving" : "confirm")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Toolbar({
  search,
  searchRef,
  onSearch,
  onExport,
  children,
}: {
  search: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSearch: (s: string) => void;
  onExport: () => void;
  children?: React.ReactNode;
}) {
  const { t } = usePreferences();
  return (
    <div className="toolbar">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(String(new FormData(e.currentTarget).get("search") || ""));
        }}
        className="search"
      >
        <Search size={17} />
        <input
          ref={searchRef}
          name="search"
          type="search"
          maxLength={100}
          placeholder={t("search")}
          aria-label={t("search")}
          defaultValue={search}
        />
        <button type="submit" className="icon-button" aria-label={t("search")}>
          <ArrowRight size={16} />
        </button>
      </form>
      <div className="toolbar-right">
        {children}
        <button
          className="icon-button"
          onClick={onExport}
          title={t("downloadList")}
          aria-label={t("downloadList")}
        >
          <ArrowDownToLine size={18} />
        </button>
      </div>
    </div>
  );
}
function EpisodeRows({
  rows,
  date,
}: {
  rows: Row[];
  date: (v: string, s?: boolean) => string;
}) {
  const { t } = usePreferences();
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("briefing")}</th>
            <th>{t("status")}</th>
            <th>{t("progress")}</th>
            <th>{t("created")}</th>
            <th>
              <span className="sr-only">{t("open")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="wide-cell">
                <Link
                  href={`/studio/episodes/${r.id}`}
                  className="episode-title"
                >
                  <span className="episode-icon">
                    <Film size={18} />
                  </span>
                  <span>
                    <strong>{r.title || t("noTitle")}</strong>
                    <small>#{r.id.slice(0, 8)}</small>
                  </span>
                </Link>
              </td>
              <td>
                <Status value={r.status} />
              </td>
              <td>
                <div className="progress">
                  <span
                    style={{
                      width: `${Math.max(0, Math.min(100, r.render_progress))}%`,
                    }}
                  />
                </div>
                <small>{r.render_progress}%</small>
              </td>
              <td className="nowrap muted">{date(r.created_at, true)}</td>
              <td>
                <Link
                  className="icon-button"
                  href={`/studio/episodes/${r.id}`}
                  aria-label={`${t("open")}: ${r.title}`}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text={t("noResults")} />
  );
}
function Events({
  events,
  date,
  compact = false,
}: {
  events: Row[];
  date: (v: string, s?: boolean) => string;
  compact?: boolean;
}) {
  const { t } = usePreferences();
  return events.length ? (
    <ol className={`timeline ${compact ? "compact-timeline" : ""}`}>
      {events.map((e) => (
        <li key={e.id}>
          <span className={`timeline-dot ${e.error_message ? "bad" : ""}`} />
          <div>
            <strong>{eventLabel(e.event_type, t)}</strong>
            <time>{date(e.created_at)}</time>
            {e.error_message && (
              <p className="event-error">{e.error_message}</p>
            )}
            {!compact && e.model_used && <small>{e.model_used}</small>}
            {compact && e.episode_id && (
              <Link href={`/studio/episodes/${e.episode_id}`}>
                #{e.episode_id.slice(0, 8)} <ArrowUpRight size={12} />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <Empty text={t("noEvents")} />
  );
}
function eventLabel(value: string, t: (s: string) => string) {
  return t(
    (
      {
        research_completed: "research",
        script_generated: "script",
        assets_generated: "assets",
        render_started: "active",
        render_completed: "rendered",
        publish_completed: "published",
        publish_started: "processing",
        approval_received: "approved",
        approval_rejected: "rejected",
        failed: "failedStage",
        state_transition: "eventTransition",
        render_checkpoint_saved: "eventCheckpoint",
        qa_passed: "eventQaPassed",
        qa_failed: "eventQaFailed",
        tts_fallback_triggered: "eventVoiceFallback",
        tts_engine_selected: "eventVoiceSelected",
        images_generated: "eventImages",
        tts_generated: "eventVoice",
        subtitles_generated: "eventSubtitles",
        gemini_call: "eventAi",
        budget_exceeded: "eventBudget",
        heartbeat_sent: "eventHeartbeat",
        analyze_completed: "analyze",
      } as Row
    )[value] || value.replaceAll("_", " "),
  );
}
function PublishRows({
  rows,
  date,
}: {
  rows: Row[];
  date: (v: string, s?: boolean) => string;
}) {
  const { t } = usePreferences();
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t("platform")}</th>
            <th>{t("status")}</th>
            <th>{t("visibility")}</th>
            <th>{t("created")}</th>
            <th>{t("actions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>
                  {r.platform === "youtube" ? "YouTube" : r.platform}
                </strong>
                <small>
                  <Link href={`/studio/episodes/${r.episode_id}`}>
                    #{r.episode_id.slice(0, 8)}
                  </Link>
                </small>
                {r.affiliate_url && <ProductLink value={r.affiliate_url} />}
              </td>
              <td>
                <Status value={r.status} publish />
              </td>
              <td>{r.privacy ? t(r.privacy) : "—"}</td>
              <td>{date(r.published_at || r.created_at)}</td>
              <td>
                {r.platform === "youtube" &&
                /^[\w-]{11}$/.test(r.external_id || "") ? (
                  <a
                    className="button small secondary"
                    href={`https://www.youtube.com/watch?v=${r.external_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("viewPlatform")}
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text={t("noPublishes")} />
  );
}
function EpisodeDetail({
  data,
  date,
}: {
  data: Row;
  date: (v: string, s?: boolean) => string;
}) {
  const { t } = usePreferences();
  const [tab, setTab] = useState("player"),
    [orientation, setOrientation] = useState("portrait");
  const e = data.episode,
    script = e.script_json;
  return (
    <>
      <Link className="back-link" href="/studio/episodes">
        <ArrowLeft size={16} />
        {t("episodes")}
      </Link>
      <div className="episode-heading">
        <h2>{e.briefing?.text || t("noTitle")}</h2>
        <Status value={e.status} />
      </div>
      <div className="detail-layout">
        <section className="panel">
          <div className="tabs" role="tablist" aria-label={t("details")}>
            {["player", "script", "sources", "media", "events"].map((key) => (
              <button
                role="tab"
                aria-selected={key === tab}
                id={`tab-${key}`}
                aria-controls={`view-${key}`}
                key={key}
                onClick={() => setTab(key)}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <div
            className="tab-content"
            role="tabpanel"
            id={`view-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "player" && (
              <>
                <div className="video-controls">
                  {(e.videos?.tiktok ? ["portrait", "landscape", "tiktok"] : ["portrait", "landscape"]).map((key) => (
                    <button
                      key={key}
                      className={`button small ${orientation === key ? "dark" : "secondary"}`}
                      onClick={() => setOrientation(key)}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
                {e.videos?.[orientation] ? (
                  <>
                    <div className={`video-stage ${orientation === "tiktok" ? "portrait" : orientation}`}>
                      <video
                        key={e.videos[orientation]}
                        controls
                        preload="metadata"
                        playsInline
                        src={e.videos[orientation]}
                      />
                    </div>
                    <a
                      className="back-link"
                      href={e.videos[orientation]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={15} />
                      {t("openVideo")}
                    </a>
                  </>
                ) : (
                  <Empty text={t("videoEmpty")} />
                )}
                <p className="info-note">
                  <ShieldCheck size={18} />
                  {t("reviewHint")}
                </p>
              </>
            )}
            {tab === "script" &&
              (script ? (
                <>
                  <h3>{script.metadata?.youtube?.title}</h3>
                  {script.platform_ctas && <div className="info-note"><p>YouTube: {script.platform_ctas.youtube.narration_text}</p><p>{t("tiktok")}: {script.platform_ctas.tiktok.narration_text}</p></div>}
                  <p className="preserve">
                    {script.metadata?.youtube?.description}
                  </p>
                  <div className="scene-list">
                    {script.scenes?.map((s: Row) => (
                      <article key={s.id}>
                        <div className="scene-label">
                          {t("scene")} {s.order + 1}{" "}
                          <span>
                            {s.duration_seconds}s · {s.role}
                          </span>
                        </div>
                        <p>{s.narration_text}</p>
                        <small>{s.visual?.description}</small>
                      </article>
                    ))}
                  </div>
                  {script.disclosures?.commercial_disclosure_text && (
                    <div className="info-note">
                      {script.disclosures.commercial_disclosure_text}
                    </div>
                  )}
                </>
              ) : (
                <Empty text={t("scriptEmpty")} />
              ))}
            {tab === "sources" &&
              (script?.sources?.length ? (
                <div className="sources">
                  {script.sources.map((s: Row, i: number) => (
                    <article key={i}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      <div>
                        <p>{s.claim}</p>
                        {safeLink(s.source_url) && (
                          <a
                            href={safeLink(s.source_url)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {new URL(s.source_url).hostname}
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty />
              ))}
            {tab === "media" &&
              (data.assets.length ? (
                <div className="media-grid">
                  {data.assets.map((a: Row) => (
                    <article key={a.id}>
                      {a.type === "image" && a.url ? (
                        <img
                          src={a.url}
                          alt={`${t("media")} · ${a.source}`}
                          loading="lazy"
                        />
                      ) : (
                        <div className="asset-icon">
                          <FileText size={25} />
                        </div>
                      )}
                      <div>
                        <strong>{a.type}</strong>
                        <p>
                          {t("license")}: {a.license}
                        </p>
                        <small>
                          {a.source}
                          {a.author ? ` · ${a.author}` : ""}
                        </small>
                        {a.url && (
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {t("openVideo")}
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty text={t("noMedia")} />
              ))}
            {tab === "events" && <Events events={data.events} date={date} />}
          </div>
        </section>
        <aside className="detail-side">
          {e.failure_reason && (
            <section className="panel failure-panel">
              <h3>
                <TriangleAlert size={18} />
                {t("failure")}
              </h3>
              <p>{e.failure_reason}</p>
              <small>
                {t("failureAt")}: {t(e.failure_from_status || "unknown")}
              </small>
            </section>
          )}
          <section className="panel info-panel">
            <h3>{t("details")}</h3>
            <dl>
              {[
                [t("created"), date(e.created_at)],
                [t("progress"), `${e.render_progress}%`],
                [t("qa"), e.qa_score ?? "—"],
                [t("voice"), e.tts_engine || "—"],
                [t("prompt"), e.prompt_version || "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="panel info-panel">
            <h3>{t("reviewHistory")}</h3>
            {data.reviews.length ? (
              data.reviews.map((r: Row) => (
                <div className="review-record" key={r.id}>
                  <Status value={r.decision} />
                  <small>{date(r.decided_at || r.created_at)}</small>
                  <small>{t(r.delivery_status)}</small>
                </div>
              ))
            ) : (
              <p className="muted">{t("noReview")}</p>
            )}
          </section>
        </aside>
      </div>
      <section className="panel detail-publications">
        <div className="panel-heading">
          <h2>{t("publishes")}</h2>
        </div>
        <PublishRows rows={data.publishes} date={date} />
      </section>
    </>
  );
}
function Settings({
  data,
  mutate,
  busy,
  error,
}: {
  data: Row;
  mutate: (a: string, p: Row) => Promise<boolean>;
  busy: boolean;
  error: string;
}) {
  const { t } = usePreferences();
  const pipeline = data.settings.find((s: Row) => s.key === "pipeline"),
    niche = data.settings.find((s: Row) => s.key === "niche"),
    budget = data.settings.find((s: Row) => s.key === "budget");
  const [enableConfirm, setEnableConfirm] = useState<Row | null>(null);
  return (
    <div className="settings-grid">
      <div>
        <section className="panel settings-panel">
          <h2>
            <SlidersHorizontal size={21} />
            {t("operationSettings")}
          </h2>
          <form
            key={pipeline?.updated_at}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                payload = {
                  revision: pipeline.updated_at,
                  enabled: f.get("enabled") === "on",
                  max_episodes_per_day: Number(f.get("limit")),
                };
              if (payload.enabled && !pipeline.value.enabled)
                setEnableConfirm(payload);
              else await mutate("pipeline", payload);
            }}
          >
            <label className="switch-label">
              <span>
                {t("pipeline")}
                <small>{t("activationHint")}</small>
              </span>
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={!!pipeline?.value.enabled}
              />
            </label>
            <label>
              {t("dailyLimit")}
              <input
                type="number"
                name="limit"
                min={1}
                max={10}
                required
                defaultValue={pipeline?.value.max_episodes_per_day || 1}
              />
            </label>
            <div className="locked-settings">
              <span>
                <ShieldCheck size={15} />
                {t("approvalRequired")}
              </span>
              <span>
                <Pause size={15} />
                {t("autoPublishOff")}
              </span>
            </div>
            <button disabled={busy || !pipeline} className="button primary">
              {t(busy ? "saving" : "save")}
            </button>
          </form>
        </section>
        <section className="panel settings-panel">
          <h2>{t("editorial")}</h2>
          <form
            key={niche?.updated_at}
            onSubmit={async (e) => {
              e.preventDefault();
              await mutate("niche", {
                revision: niche.updated_at,
                focus: new FormData(e.currentTarget).get("focus"),
              });
            }}
          >
            <label>
              {t("focus")}
              <textarea
                name="focus"
                rows={4}
                required
                minLength={10}
                maxLength={500}
                defaultValue={niche?.value.focus}
              />
            </label>
            <button disabled={busy || !niche} className="button secondary">
              {t(busy ? "saving" : "save")}
            </button>
          </form>
        </section>
        {error && (
          <div className="error" role="alert">
            {t(error)}
          </div>
        )}
        <section className="panel settings-panel">
          <h2>{t("appearance")}</h2>
          <p className="muted">{t("appearanceHint")}</p>
          <Preferences />
        </section>
        <section className="panel settings-panel">
          <h2>{t("audit")}</h2>
          {data.audit.length ? (
            <div className="audit-list">
              {data.audit.map((a: Row) => (
                <div key={a.request_id}>
                  <strong>
                    {t(
                      (
                        {
                          pipeline: "pipelineAction",
                          niche: "nicheAction",
                          edit: "editAction",
                          cancel: "cancelAction",
                        } as Row
                      )[a.action] || a.action,
                    )}
                  </strong>
                  <small>{a.result?.code}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{t("auditEmpty")}</p>
          )}
        </section>
      </div>
      <div>
        <section className="panel settings-panel">
          <h2>{t("integrations")}</h2>
          {[
            ["YouTube", "existingFlow", "youtubeHint"],
            ["TikTok Shop", "manual", "tiktokHint"],
            ["Telegram", "existingFlow", "telegramHint"],
            ["GitHub Actions", "existingFlow", "actionsHint"],
          ].map(([name, state, hint]) => (
            <article className="integration" key={name}>
              <div>
                <strong>{name}</strong>
                <span>{t(state)}</span>
              </div>
              <p>{t(hint)}</p>
            </article>
          ))}
        </section>
        <section className="panel settings-panel">
          <h2>{t("limits")}</h2>
          <p className="muted">{t("limitsHint")}</p>
          <dl className="budget-list">
            {Object.entries(budget?.value || {})
              .filter(([key, value]) => typeof value === "number")
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll("_", " ")}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
          </dl>
        </section>
      </div>
      {enableConfirm && (
        <Modal
          title={t("confirmEnable")}
          onClose={() => {
            if (!busy) setEnableConfirm(null);
          }}
        >
          <p>{t("confirmEnableHint")}</p>
          {error && (
            <div className="error" role="alert">
              {t(error)}
            </div>
          )}
          <div className="modal-footer">
            <button
              disabled={busy}
              className="button secondary"
              onClick={() => setEnableConfirm(null)}
            >
              {t("cancel")}
            </button>
            <button
              disabled={busy}
              className="button primary"
              onClick={async () => {
                if (await mutate("pipeline", enableConfirm))
                  setEnableConfirm(null);
              }}
            >
              {t(busy ? "saving" : "confirm")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
