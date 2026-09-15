# ADR-028 — Painel web operacional com acesso administrativo no servidor

## Contexto

O projeto era operado apenas pelo Telegram e por comandos técnicos. O pacote `apps/web-panel` estava reservado, mas não havia uma interface pública para apresentar o produto nem uma superfície administrativa para acompanhar a fila e as gerações.

## Decisão

Publicar o **Fritz Inova Content Studio** como aplicação web separada do runtime de geração, mantendo Supabase Edge Functions, Postgres e GitHub Actions como motor do pipeline.

- `/`, `/terms` e `/privacy` são públicos e servem como apresentação e propriedades oficiais do aplicativo.
- `/dashboard` exige login e uma allowlist de operador aplicada no servidor.
- A service role do Supabase fica somente no ambiente do Worker hospedado; nunca é enviada ao navegador.
- O painel lê episódios, fila e configuração diretamente do Supabase pelo servidor.
- A interface permite cadastrar uma pauta comercial e pausar ou retomar o consumo da fila.
- Revisão editorial e decisão de publicação continuam obedecendo aos gates existentes; o painel não contorna Telegram, fingerprints de aprovação nem as transições protegidas no banco.

## Superfície inicial

1. Indicadores de pautas pendentes, produções ativas, revisões e publicações.
2. Lista de episódios com estado, progresso e link do render quando disponível.
3. Fila de pautas comerciais.
4. Cadastro de pauta com URL HTTPS do produto.
5. Controle explícito de `pipeline.enabled`.

## Segurança

A aplicação usa autenticação do host para identificar o visitante e verifica a allowlist novamente em todas as rotas de leitura e escrita. Toda chamada ao PostgREST ocorre no servidor. As tabelas continuam com RLS fechada para `anon` e `authenticated`.

## Consequências

O operador passa a ter uma interface funcional sem expor credenciais administrativas. A vinculação final do produto no TikTok Shop e a aprovação do vídeo continuam manuais, conforme as limitações documentadas nos ADRs anteriores.
