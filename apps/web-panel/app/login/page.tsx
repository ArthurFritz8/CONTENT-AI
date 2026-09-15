"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Preferences, usePreferences } from "../../components/preferences";
export default function Login() {
  const { t } = usePreferences();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          password: data.get("password"),
        }),
      });
      const response = await r.json();
      if (!r.ok) throw new Error(response.error);
      location.assign("/studio");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível entrar.");
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="login-story">
        <Link className="brand" href="/">
          <Image src="/brand.png" alt="" width={40} height={40} sizes="40px" className="brand-image" priority />
          FRITZ INOVA
        </Link>
        <div>
          <div className="eyebrow">{t("workspace")}</div>
          <h1>{t("loginStory")}</h1>
          <p>{t("loginStorySubtitle")}</p>
        </div>
        <span>CONTENT STUDIO / {t("restricted")}</span>
      </div>
      <main>
        <Preferences />
        <div className="login-form">
          <ShieldCheck size={30} />
          <h2>{t("loginTitle")}</h2>
          <p className="muted">{t("loginSubtitle")}</p>
          <form method="post" action="/api/session" onSubmit={submit}>
            <label>
              {t("email")}
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                placeholder="seu@email.com"
              />
            </label>
            <label>
              {t("password")}
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={200}
              />
            </label>
            {error && (
              <div role="alert" className="error">
                {t(error)}
              </div>
            )}
            <button className="button dark" disabled={busy || !ready}>
              {t(busy ? "checking" : "login")}
              <ArrowRight size={18} />
            </button>
          </form>
          <small>{t("loginHint")}</small>
          <div className="legal-links">
            <Link href="/terms">{t("terms")}</Link>
            <Link href="/privacy">{t("privacy")}</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
