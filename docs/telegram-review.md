# Revisão editorial pelo Telegram

O bot apresenta uma ficha com título, resumo, natureza comercial/sintética, dois links para assistir e um documento de texto com roteiro completo, descrições, tags, fontes, licenças e alertas. Os testes usam dados simulados; a ativação real depende do seu bot e Supabase.

## Configurar

1. Crie seu bot no BotFather e guarde o token fora do Git. Envie uma mensagem ao bot pelo usuário/chat que fará as revisões. Os IDs numéricos vêm do payload dessa mensagem (`message.from.id` e `message.chat.id`, consultáveis pelo Bot API `getUpdates` antes de configurar webhook). Não use nome de usuário no lugar do ID.
2. Preencha `.env.cloud` com `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_USER_ID` e `TELEGRAM_WEBHOOK_SECRET`. O secret precisa de 32–256 caracteres aleatórios em A–Z, a–z, 0–9, `_` ou `-`, e é diferente do token do bot. O chat pode ser privado ou grupo; apenas o usuário configurado decide.
3. Aplique as migrations, incluindo `20260912000000_telegram_review.sql`, e implante os workers com `deploy.sh`. O script envia os novos secrets e implanta `telegram-bot`. Somente esse endpoint usa `verify_jwt=false`; autenticação ocorre pelo header secreto e allowlist. Não desligue JWT dos demais workers.
4. Valide as variáveis e registre o webhook, a partir da raiz do projeto:

```bash
node --env-file=.env.cloud scripts/setup-telegram.mjs --check
node --env-file=.env.cloud scripts/setup-telegram.mjs
```

O primeiro comando é local; o segundo configura o webhook no Telegram sem apagar updates pendentes. O token nunca é impresso. Esses comandos não publicam vídeos nem habilitam o pipeline.

5. Envie `/start` ao bot. Depois habilite as fichas no SQL Editor:

```sql
update public.system_config
set value=jsonb_set(value,'{enabled}','true'::jsonb)
where key='telegram';
```

O padrão é desabilitado. Para envio automático, `pipeline.enabled` também precisa estar habilitado e o cron funcionando. O orchestrator envia uma revisão pendente antes de avançar a geração. Uma ficha já enviada aguardando resposta não bloqueia a fila.

## Decidir

- **Aprovar versão:** registra usuário, data e fingerprint; mantém o episódio em `review`. Não faz upload. O publisher futuro deverá respeitar essa aprovação e a política de upload privado inicial.
- **Refazer render:** volta para `assets`, preserva roteiro/imagens/áudio e gera novos vídeos. Não reescreve o conteúdo. Exige nova aprovação.
- **Reprovar:** move para `failed`, com origem `review` e razão `human_review_rejected`. Corrigir editorialmente antes de recuperar o episódio; não há editor de roteiro no bot nesta entrega.

Assista às duas versões; confira fontes/contexto, direitos das imagens/música, títulos/descrições e disclosure. QA e grounding não garantem veracidade nem qualidade audiovisual.

## Recuperação e inspeção

`/revisar UUID_DO_EPISÓDIO` cria uma nova ficha de episódio em `review` e invalida os botões anteriores. Também revoga uma aprovação anterior dessa revisão. Use somente quando deseja reabrir a decisão ou recuperar uma entrega não confirmada.

O sistema reserva `review_requests` antes de enviar. Timeout fica `uncertain`; crash pode deixar `sending`. Não há retry automático que possa duplicar mensagem. Envie `/revisar` como uma nova mensagem para recuperar. Um callback sem `message_id` confirmado não aprova.

Em `review_requests`, examine `delivery_status`, `delivery_error`, `decision` e `fingerprint`; em `job_events`, examine `approval_received`/`approval_rejected`. `telegram_updates` deduplica callbacks; `telegram_commands` deduplica comandos. Mudanças na pesquisa, roteiro, assets, render ou política invalidam callbacks antigos e bloqueiam publicação com aprovação obsoleta.

Erros de configuração ou dossiê inválido ficam registrados sem liberar botões de aprovação. Revise a configuração/QA e solicite outra ficha. Campos de aprovação preenchidos manualmente não substituem o ledger aprovado.

Antes da rotina, valide uma ficha real: outro usuário/chat deve ser recusado; clique repetido deve gerar uma decisão; edição posterior deve exigir nova revisão. Aprovações legadas sem ledger precisam de reconciliação. O escopo atual não inclui entrada de ideias pelo chat, editor de roteiros ou publisher.
