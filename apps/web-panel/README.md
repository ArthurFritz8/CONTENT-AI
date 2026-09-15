# Fritz Inova Content Studio

Aplicação operacional Next.js dentro do monorepositório. A interface usa dados reais do Supabase; não há modo demonstrativo de produção ou contadores fictícios.

## Funcionalidades

- Login por e-mail/senha Supabase, acesso administrativo por UUID autorizado e cookie HttpOnly.
- Português brasileiro padrão, inglês e espanhol; tema claro, escuro ou do sistema, persistidos por navegador.
- Contagens completas, fila pendente, atividade e indicação de produção pausada/ativa.
- Criar, editar, priorizar e retirar pautas; links HTTPS de produtos/afiliados; auditoria e idempotência de gravações.
- Busca, filtro por etapa, paginação e exportação CSV da página atual (com proteção contra fórmulas).
- Detalhes da geração: players vertical/horizontal, roteiro por cena, fontes, mídias/licenças, falhas e revisões.
- Envios registrados, incluindo privados, com link para YouTube quando disponível.
- Pausa/ativação do scheduler, teto diário e foco editorial. Ativação exige confirmação dentro da interface.
- Atualização a cada 30 segundos nas telas de consulta visíveis. Formulários não são atualizados enquanto se edita.

O conteúdo das pautas/roteiros mantém o idioma original. A aprovação continua no Telegram. TikTok Shop permanece manual; este painel não cria links comissionados nem representa aprovação da API. Analytics, edição de roteiro após geração, publicação pública e gestão de outros operadores não estão implementados aqui. Termos/privacidade descrevem o uso interno atual e precisam ser revistos antes da oferta a terceiros.

## Desenvolvimento

Na raiz:

```sh
npm ci
cp apps/web-panel/.env.example apps/web-panel/.env.local
npm run dev --workspace=@content-ai/web-panel
```

Preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `WEB_PANEL_ALLOWED_USER_IDS` (UUIDs separados por vírgula). A chave anon é usada somente para autenticação; a chave service permanece no servidor. `APP_URL` deve corresponder à origem exata acessada, inclusive porta (`http://localhost:3000`). Crie a conta administrativa no Supabase Auth e configure seu UUID; o painel não oferece cadastro público. Não habilitar políticas públicas de leitura no banco.

Aplicar `20260914050000_web_panel.sql` pelo processo de migrations antes de usar a fila/configurações. A migração não inicia o scheduler nem altera pautas existentes.

## Render gratuito

1. Entre no Render e conecte o GitHub que acessa `ArthurFritz8/CONTENT-AI`.
2. Crie um **Blueprint** usando o repositório e o arquivo `render.yaml`. Ele declara explicitamente `plan: free` e não cria banco ou disco.
3. Preencha os quatro valores de ambiente solicitados. A origem é obtida automaticamente de `RENDER_EXTERNAL_URL`; se usar domínio próprio, configure `APP_URL` com esse domínio.
4. Aguarde o build e abra `/api/health`, `/login` e `/studio`. A resposta de saúde mostra o commit e confirma somente o servidor, não a disponibilidade do Supabase.
5. Em Render → serviço → Settings, copie o **Deploy Hook**. Salve-o como secret `RENDER_DEPLOY_HOOK` no GitHub. Salve o endereço público como variável `PANEL_PUBLIC_URL`.
6. O workflow `Deploy web panel` é acionado por CI concluído com sucesso em push para main. Ele verifica se o commit ainda é o mais recente, pede deploy desse SHA e só confirma sucesso após o `/api/health` mostrar o mesmo SHA. Sem hook/URL, informa que a implantação ainda não foi configurada.

O Render pode adormecer após 15 minutos sem tráfego; a abertura seguinte pode levar cerca de um minuto. FFmpeg, scheduler e armazenamento continuam no GitHub/Supabase. Não há serviço de keep-alive para contornar essa restrição. O plano Pro+ de outro produto não é usado como crédito de hospedagem.

As URLs públicas após a implantação são `<origem>/`, `<origem>/terms` e `<origem>/privacy`. Para verificação do TikTok por arquivo, colocar o arquivo fornecido pelo portal em `apps/web-panel/public/` e fazer deploy; validar o conteúdo publicado antes de confirmar no portal. Não inventar arquivo ou código de verificação.

## Verificação

```sh
npm test --workspace=@content-ai/web-panel
npm run build --workspace=@content-ai/web-panel
npx playwright install chromium
npm run test:browser --workspace=@content-ai/web-panel
```

O CI inclui testes de autenticação/origem, entradas maliciosas, redaction, paridade de tradução, navegador e transações PostgreSQL. O teste SQL `supabase/tests/web-panel.sql` roda dentro de transação revertida em banco descartável. Não executar bootstrap em banco Supabase real.

Testes de produção são somente leitura; criar e excluir um usuário temporário de teste não deve alterar os usuários existentes. Nunca usar a service key em um estado de autenticação do navegador ou salvá-la como variável pública.
