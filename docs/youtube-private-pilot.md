# Primeiro upload privado no YouTube

O piloto envia o vídeo **horizontal**, com título, descrição e tags da revisão aprovada. O vídeo fica privado e o episódio permanece em `review`. Aprovar no Telegram não dispara upload: você inicia este piloto quando estiver pronto.

## Preparar o ambiente

1. Aplicar todas as migrations em ordem, incluindo `20260912010000_youtube_private.sql` e `20260912020000_youtube_preflight_recovery.sql`, e executar `supabase/verify-migrations.sql`. Nunca aplicar `supabase/tests/bootstrap.sql` no cloud.
2. Terminar o [setup do Telegram](telegram-review.md), gerar um episódio, assistir às duas versões e aprovar. Renders antigos sem hash no caminho precisam ser refeitos e aprovados novamente.
3. Habilitar YouTube Data API v3 no seu projeto Google. Configurar consentimento OAuth e obter um refresh token com acesso offline para o proprietário do canal e os escopos `https://www.googleapis.com/auth/youtube.upload` e `https://www.googleapis.com/auth/youtube.readonly`. Selecionar a identidade correta se houver Brand Account. Não enviar credenciais em chat, issues ou commits. Consulte o [fluxo OAuth oficial](https://developers.google.com/identity/protocols/oauth2/web-server).
4. Preencher `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` e `YOUTUBE_CHANNEL_ID` no ambiente local ignorado pelo Git. O ID do canal começa com `UC`; não é o @handle. Além dos dois secrets Supabase existentes, estes quatro valores devem estar nos **GitHub Actions secrets**. `deploy.sh` transfere os valores presentes quando `CONFIGURE_GITHUB_ACTIONS_SECRETS=1`; não apaga secrets opcionais ausentes. O uploader roda no Actions e não depende do PC ligado.
5. Em consentimento externo no estado Testing, o refresh token normalmente expira em sete dias para esses escopos. Se ocorrer `invalid_grant`, renovar o consentimento e atualizar o secret; não apagar registros de upload. Veja as [regras oficiais de expiração OAuth](https://developers.google.com/identity/protocols/oauth2).

## Conferir a configuração

No SQL Editor da Supabase, leia `select value from public.system_config where key='youtube';`. O padrão é desativado, três inícios de sessão/dia UTC, arquivo de até 50 MiB, `made_for_kids=false` e categorias `Education → 27` e `Science & Technology → 28`.

Confirme se a classificação de público infantil e a categoria correspondem ao vídeo. Categoria desconhecida bloqueia o upload; não recebe um valor silencioso. Consulte [videoCategories.list](https://developers.google.com/youtube/v3/docs/videoCategories/list) para outros IDs. Quotas efetivas aparecem no Google Cloud Console; o limite interno é uma proteção adicional.

Somente quando credenciais, episódio e configuração estiverem prontos:

```sql
update public.system_config
set value = value || '{"enabled":true}'::jsonb
where key = 'youtube';
```

## Executar e conferir

1. No GitHub, abrir **Actions → YouTube Private Pilot → Run workflow**, selecionar `main` e informar o UUID do episódio aprovado. Alternativamente, o backend pode fazer POST autenticado com service role em `publish-youtube`, body `{"episode_id":"UUID"}`. Nunca colocar a service role em frontend.
2. A execução registra o ID do vídeo e o link do YouTube Studio. Abra o link com a conta do canal e espere o processamento terminar.
3. Confira privacidade **Privado**, título, descrição, tags, categoria, marcação de mídia sintética e divulgação comercial quando aplicável. Assista ao vídeo inteiro: áudio, cortes, sincronização das legendas, enquadramento e resolução. O YouTube transcodifica: o hash garante o arquivo enviado, não igualdade binária com a cópia processada.
4. Execute novamente com o mesmo UUID após o primeiro job terminar. O retorno deve indicar `alreadyUploaded=true`, com o mesmo ID, sem novo upload. Consulte o ledger abaixo.
5. Registre o resultado dessa validação antes de pensar em publicação pública. O workflow não muda a privacidade posteriormente. Shorts/TikTok não fazem parte deste piloto.

```sql
select id, episode_id, variant, privacy, status, external_id,
       media_sha256, media_bytes, channel_id, lease_until, published_at
from public.publishes
where platform = 'youtube'
order by created_at desc;
```

Não usar `select *` em logs compartilhados: `session_url` e o snapshot editorial são privados. `status=published` neste ledger representa upload aceito; o processamento do YouTube ainda precisa ser conferido. O estado do episódio continua `review`.

## Retomar falhas

- Erro de rede ou 5xx: o worker consulta a mesma sessão antes de retransmitir e limita o backoff. Se o job falhar, aguarde a lease de 20 minutos e execute o mesmo UUID. O registro e a sessão são preservados.
- Crash entre início e checkpoint: nenhuma mídia foi enviada. Uma nova tentativa pode iniciar outra sessão vazia, sujeita ao limite diário. Crash após upload e antes da confirmação no banco: consultar a sessão recupera o ID enquanto ela estiver válida.
- Sessão expirada, resultado incompatível, conteúdo alterado ou aprovação revogada: parar e reconciliar no YouTube Studio/ledger. Não apagar o registro nem trocar a sessão para forçar um novo vídeo. Recuperação administrativa para esses casos ainda é manual; não há promessa de exatamente uma entrega se o provedor já descartou a sessão.
- Canal incorreto, categoria sem mapeamento, arquivo grande ou hash divergente: corrigir a configuração/episódio. Se já houver sessão, manter os valores congelados e reconciliar antes de mudanças. Uma versão nova não sobrescreve um upload existente.
- Para pausar, definir `youtube.enabled=false`. Isso bloqueia os próximos guards; uma chamada que já está em trânsito pode terminar e será registrada. Não edite a revisão enquanto o envio estiver em andamento.

O teste real depende da sua Supabase, do canal e do consentimento OAuth. A CI usa HTTP simulado e PostgreSQL descartável; não envia vídeos ao YouTube.
