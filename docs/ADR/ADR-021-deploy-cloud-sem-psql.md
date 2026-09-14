# ADR-021 — Bootstrap cloud sem dependência local de psql

## Contexto

O deploy remoto já usa a Supabase CLI para migrations, seed, secrets e Edge Functions. A etapa final ainda exigia `psql` apenas para criar o bucket, preencher o Vault e instalar o `pg_cron`. Isso bloqueou uma estação Windows que consegue executar a CLI e acessar o projeto, mas não possui o cliente PostgreSQL.

## Decisão

- Aplicar migrations e `seed.sql` juntos com `supabase db push --include-seed`.
- Criar extensões e o bucket `assets` por migration idempotente.
- Expor `configure_content_ai_scheduler(project_url, service_role_key)` somente ao papel `service_role`.
- Enviar as duas credenciais por HTTPS autenticado após o deploy das funções. A RPC valida os valores, grava-os no Vault e recria apenas o job `orchestrator-tick`.
- Passar explicitamente o import map e usar o empacotador remoto no deploy das Edge Functions.
- Manter `pipeline.enabled=false`; instalar o scheduler não inicia geração.

## Consequências

O deploy cloud passa a funcionar sem Docker e sem `psql` local. A chave de serviço não entra em migration, log ou Git; permanece no ambiente do operador, nos secrets e no Vault. A função administrativa continua disponível para reconfiguração idempotente, mas `public`, `anon` e `authenticated` não podem executá-la.

## Rollback

Desagendar `orchestrator-tick` em `cron.job` e revogar a execução da RPC para `service_role`. Preservar as entradas do Vault até confirmar que nenhum job depende delas.
