"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { Globe2, Monitor, Moon, Sun } from "lucide-react";
import { messages, type Language } from "../lib/messages";
import {errorTranslations} from '../lib/error-messages';
type Theme = "light" | "dark" | "system";
const Context = createContext({
  language: "pt-BR" as Language,
  theme: "system" as Theme,
  setLanguage: (_v: Language) => {},
  setTheme: (_v: Theme) => {},
  t: (key: string) => key,
});
export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguage] = useState<Language>("pt-BR"),
    [theme, setTheme] = useState<Theme>("system"),
    [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const l = localStorage.getItem("fritz.language"),
        th = localStorage.getItem("fritz.theme");
      if (l && l in messages) setLanguage(l as Language);
      if (["light", "dark", "system"].includes(th || "")) setTheme(th as Theme);
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = language;
    try {
      localStorage.setItem("fritz.language", language);
    } catch {}
  }, [language, ready]);
  useEffect(() => {
    if (!ready) return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (mq.matches ? "dark" : "light") : theme;
    };
    apply();
    mq.addEventListener("change", apply);
    try {
      localStorage.setItem("fritz.theme", theme);
    } catch {}
    return () => mq.removeEventListener("change", apply);
  }, [theme, ready]);
  const t = (key: string) => messages[language][key] || (language!=='pt-BR' ? errorTranslations[key]?.[language==='en'?0:1] : undefined) || messages['pt-BR'][key] || key;
  return (
    <Context.Provider value={{ language, theme, setLanguage, setTheme, t }}>
      {children}
    </Context.Provider>
  );
}
export const usePreferences = () => useContext(Context);
export function Preferences({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  return (
    <div className={`preferences ${compact ? "compact" : ""}`}>
      <label className="language-control">
        <Globe2 size={16} />
        <span className="sr-only">{t("language")}</span>
        <select
          aria-label={t("language")}
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          <option value="pt-BR">Português (BR)</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </label>
      <div className="theme-control" role="group" aria-label={t("theme")}>
        {(
          [
            ["light", Sun],
            ["dark", Moon],
            ["system", Monitor],
          ] as const
        ).map(([value, Icon]) => (
          <button
            type="button"
            key={value}
            aria-label={t(value)}
            title={t(value)}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
    </div>
  );
}
