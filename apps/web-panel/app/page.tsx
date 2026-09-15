"use client";
import Link from "next/link";
import { Preferences, usePreferences } from "../components/preferences";
import {
  ArrowUpRight,
  Clapperboard,
  ListVideo,
  ScanEye,
  Workflow,
} from "lucide-react";
export default function Home() {
  const { t } = usePreferences();
  return (
    <div className="public">
      <header>
        <Link className="brand" href="/">
          <span className="brand-symbol">
            F<span>↗</span>
          </span>{" "}
          FRITZ INOVA
        </Link>
        <div>
          <Preferences />
          <Link className="button dark" href="/studio">
            {t("login")} <ArrowUpRight size={17} />
          </Link>
        </div>
      </header>
      <main>
        <div className="eyebrow">{t("publicEyebrow")}</div>
        <h1>{t("publicTitle")}</h1>
        <p className="lead">{t("publicLead")}</p>
        <Link className="button primary" href="/studio">
          {t("openStudio")} <ArrowUpRight size={18} />
        </Link>
        <div className="public-grid">
          {[
            [ListVideo, "organize"],
            [Clapperboard, "produce"],
            [ScanEye, "check"],
            [Workflow, "track"],
          ].map(([Icon, key]: any, i) => (
            <article key={key}>
              <Icon size={28} />
              <h2>
                0{i + 1} / {t(key)}
              </h2>
              <p>{t(`${key}Text`)}</p>
            </article>
          ))}
        </div>
        <section className="public-note">
          <h2>{t("publicNote")}</h2>
          <p>{t("publicNoteText")}</p>
        </section>
      </main>
      <footer>
        <span>Fritz Inova Content Studio</span>
        <nav>
          <Link href="/terms">{t("terms")}</Link>
          <Link href="/privacy">{t("privacy")}</Link>
        </nav>
      </footer>
    </div>
  );
}
