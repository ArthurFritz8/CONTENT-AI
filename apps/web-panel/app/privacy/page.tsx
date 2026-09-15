import Link from "next/link";
export default function Privacy() {
  return (
    <main className="legal">
      <Link href="/">← Fritz Inova</Link>
      <h1>Privacidade</h1>
      <p>Versão de 14 de setembro de 2026</p>
      <h2>Dados utilizados</h2>
      <p>
        O painel utiliza e-mail e identificador de usuário para autenticar
        contas autorizadas. Armazena pautas, links de produtos, roteiros,
        arquivos de mídia, histórico de geração e registros das alterações
        feitas pelos operadores.
      </p>
      <h2>Autenticação e segurança</h2>
      <p>
        A autenticação é processada pelo Supabase. Um cookie essencial,
        inacessível ao JavaScript da página, mantém a sessão por até uma hora.
        Credenciais de integração ficam no servidor. O painel não utiliza
        cookies de publicidade.
      </p>
      <h2>Serviços envolvidos</h2>
      <p>
        Render hospeda o painel; Supabase armazena os dados e arquivos; GitHub
        Actions executa tarefas de produção. As integrações configuradas para
        geração, revisão e publicação podem processar os dados necessários a
        cada etapa. Esses provedores podem processar dados fora do Brasil.
      </p>
      <h2>Retenção e solicitações</h2>
      <p>
        Dados de produção e auditoria são mantidos para operação e
        rastreabilidade. Solicitações de acesso, correção ou exclusão devem ser
        encaminhadas ao responsável que concedeu seu acesso. A exclusão é
        avaliada considerando necessidades operacionais e obrigações aplicáveis.
      </p>
      <h2>Conteúdo publicado</h2>
      <p>
        Vídeos e dados enviados a plataformas externas passam a estar sujeitos
        às configurações de visibilidade e políticas dessas plataformas. Excluir
        uma pauta do painel não remove automaticamente um vídeo publicado.
      </p>
    </main>
  );
}
