# Configuração única para abrir o Studio a clientes

A conta atual continua usando seus canais existentes. Nenhuma chave precisa ser solicitada aos clientes.

## Buffer — aplicativo do Studio

1. No Buffer do administrador: **Settings → API → App Clients → criar aplicativo**.
2. Nome sugerido: **Fritz Inova Studio**. Tipo: aplicativo web/confidential.
3. Site: `https://fritz-inova-studio.onrender.com`.
4. Callback exato: `https://fritz-inova-studio.onrender.com/api/buffer/callback`.
5. Políticas: `/privacy` e `/terms` no mesmo site.
6. Permissões usadas: `account:read posts:read posts:write offline_access`. Não solicitar permissões adicionais sem necessidade.
7. Guardar `BUFFER_CLIENT_ID` e `BUFFER_CLIENT_SECRET` somente nos ambientes protegidos do servidor Render e das Edge Functions. O token pessoal atual não substitui o client OAuth.
8. Configurar `STUDIO_APP_URL=https://fritz-inova-studio.onrender.com` nas Edge Functions para links das notificações.
9. No Studio → Configurações → Conectar Buffer. Confirmar que lista os canais da conta autorizada e que uma segunda conta não os vê.

A agenda recorrente é editada no Buffer. A nova revisão permite também uma data específica por vídeo. A conexão atual do operador usa a agenda já configurada.

## Telegram

A configuração compartilhada usa o bot existente. O cliente abre o link pessoal e pressiona Iniciar, sem criar bot. Bot próprio é opcional: o assistente no painel guia o BotFather e valida o token no servidor. Não substitui webhook em uso. Não guardar tokens no chat da Fia.

## Liberação pública

Depois de OAuth, isolamento e preview privado verificados em produção, habilitar `system_config.studio_public.enabled=true`. `/join` só permite cadastro quando essa flag estiver ativa. Conta confirmada recebe seu próprio workspace ao primeiro login. Capacidade inicial: dez workspaces; quotas por conta e orçamento global permanecem ativos. Suporte da primeira versão: português, texto, vídeos com imagens, TikTok/YouTube orgânicos; outras redes não são anunciadas como disponíveis.

Não remover as travas de revisão ou aumentar quotas para compensar uma falha de conexão. Uma resposta incerta do Buffer exige conferir a fila, não repetir a postagem.
