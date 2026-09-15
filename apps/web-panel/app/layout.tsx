import type { Metadata } from "next";
import "./globals.css";
import { PreferencesProvider } from "../components/preferences";
export const metadata: Metadata = {
  title: "Fritz Inova • Content Studio",
  description: "Produção e gestão de vídeos de produtos.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('fritz.theme');document.documentElement.dataset.theme=t==='dark'||t==='light'?t:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}catch(e){}",
          }}
        />
      </head>
      <body>
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
