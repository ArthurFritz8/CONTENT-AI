export const studioGuide = [
  {
    id: "queue",
    title: "Criar uma pauta",
    text: "Em Pautas e produtos, abra Encontrar pautas, selecione tema e recorte e pesquise. Confira fonte, gancho e limitação. Escolher e adicionar à fila não gera um vídeo. Use Gerar vídeo na pauta escolhida. Nova pauta permite escrever manualmente. Listas genéricas precisam de um assunto específico antes de gerar.",
    href: "/studio/queue",
  },
  {
    id: "episodes",
    title: "Acompanhar e revisar",
    text: "Gerações mostra pesquisa, roteiro, mídias, render e revisão. Em um vídeo pronto, confira as versões, roteiro, fontes e licenças. Aprovar sem publicar só registra a revisão. Selecionar canais e Aprovar e agendar autoriza o envio aos canais selecionados. Reprovar encerra a versão. Refazer render mantém o roteiro. Pedir ajuste cria nova versão e exige nova revisão. Botões antigos do Telegram deixam de valer quando a versão muda.",
    href: "/studio/episodes",
  },
  {
    id: "publishes",
    title: "Entender publicação",
    text: "A aprovação não significa que já foi publicado. O Buffer usa a próxima vaga da agenda do canal. Acompanhe o resultado em Publicações e na fila do Buffer. Uma resposta incerta não deve ser reenviada automaticamente, pois pode duplicar o post.",
    href: "/studio/publishes",
  },
  {
    id: "settings",
    title: "Conectar canais e horários",
    text: "Em Configurações, Conectar Buffer abre o consentimento oficial. Você precisa conectar seus canais no Buffer. O administrador precisa cadastrar o aplicativo OAuth uma vez; o cliente não fornece chave de API. Defina os horários recorrentes na agenda do Buffer. Conectar uma conta não autoriza publicar vídeos sem revisão. Cotas gratuitas são limitadas.",
    href: "/studio/settings",
  },
  {
    id: "telegram",
    title: "Telegram opcional",
    text: "Toda revisão pode acontecer no site. Para notificações no Telegram, use Conectar Telegram e abra o bot pelo link pessoal. Para bot próprio, abra @BotFather no Telegram, use /newbot, escolha nome e usuário terminado em bot. Copie o token apenas no campo seguro da configuração, nunca no chat de suporte. Abra seu bot e pressione Iniciar. O site valida o bot e prepara o recebimento das mensagens.",
    href: "/studio/settings",
  },
  {
    id: "limits",
    title: "Cotas e privacidade",
    text: "Não há promessa de viralização nem serviço pago automático. Se a pesquisa ou a produção atingir a cota gratuita, aguarde a renovação. Nunca envie senhas, tokens ou dados pessoais para o suporte. Fia explica e consulta o contexto; não aprova, não publica e não altera sua conta.",
    href: "/studio/settings",
  },
] as const;
export function guideFor(section: string) {
  return studioGuide.find((g) => g.id === section) || studioGuide[0];
}
