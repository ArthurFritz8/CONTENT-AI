import { redirect } from "next/navigation";
import { requireUser } from "../../../lib/server";
import { PanelError } from "../../../lib/security.mjs";
import Studio from "../../../components/studio";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof PanelError && [401, 403].includes(e.status))
      redirect("/login");
    return (
      <main className="legal">
        <h1>Conexão pendente</h1>
        <p>
          O painel está instalado, mas a autenticação ainda não está disponível.
          Verifique a conexão do Supabase e o usuário autorizado no ambiente de
          hospedagem.
        </p>
        <a href="/login">Voltar ao login</a>
      </main>
    );
  }
  const { path = [] } = await params;
  return (
    <Studio
      section={path[0] || "overview"}
      episodeId={path[1]}
      email={user.email}
    />
  );
}
