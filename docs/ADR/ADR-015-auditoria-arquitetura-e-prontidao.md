# ADR-015 — Auditoria, correções de segurança e critérios reais de prontidão

## Objetivo

Auditar o projeto sem substituir sua arquitetura; corrigir falhas verificáveis e definir a sequência de implementação e validação em Supabase + GitHub Actions. Relatório completo: [auditoria](../auditoria-2026-09-11.md). Dependências e critérios de aceite: [plano](../plano-implementacao.md).

## Contexto

Auditoria em 2026-09-11, a partir do commit `d19c6ea`. Foram lidos os arquivos de produção, testes, configuração, migrations, workflows e **13 ADRs existentes (001–013)**. Não existe ADR-014 nessa revisão. O histórico confirma a renumeração do deploy para 013. Este documento usa **015 por solicitação explícita**, sem inventar um ADR-014 histórico.

O contexto externo confundia intenção e implementação: não havia OpenRouter, bot de aprovação, publishers, analytics ou heartbeat; o orchestrator somente consumia a fila. A matriz real de roles é `hook | content | cta`. Áudio e legenda são recursos em `assets.metadata`, não campos editoriais adicionais. O repositório é público; nenhum GitHub Actions secret estava cadastrado na consulta de leitura.

O operador autorizou escolher a correção para o conflito de TTS: endpoints Edge/Piper inexistentes versus proibição de infraestrutura adicional. O código existente de assets é reutilizado no Actions, mantendo Gemini na Edge e todos os estados atuais.

## Solução

### Vetos e emendas explícitas

1. **Veto a “zero bloqueantes” sem evidência.** Testes locais não comprovam OAuth, quotas reais, Supabase Storage/pg_net nem APIs de publicação. Pendências externas e módulos não implementados continuam explicitamente bloqueantes no relatório.
2. **Emenda ao ADR-002:** inserts começam em `idea`; retry de `failed` volta exclusivamente a `failure_from_status`. Isso inclui recuperação após falha em `published/analyze`, antes impossível. Publicação requer `approval_user`, `approval_date` e `render_url`; disclosure sintético é imposto no banco e comercial quando o episódio é afiliado. Transições passam a produzir eventos transacionais. `review → script` regenera assets do roteiro atual; não significa gerar novo roteiro.
3. **Emenda aos ADR-003/012:** Edge TTS/Piper executam no Actions, usando o mesmo handler de assets. A Edge devolve `202 ASSETS_RUNNER_REQUIRED`; o orchestrator reserva e dispara `assets.yml`. Piper usa `piper1-gpl` via `piper-tts==1.3.0`, modelo pt_BR-faber-medium e configuração verificados por SHA-256. O model card informa dataset CC0; engine GPL-3.0. Nenhum servidor HTTP adicional. Python é somente adaptador dos binários já previstos, não uma nova camada de aplicação.
4. **Emenda aos ADR-008/009:** reservas Gemini são atômicas e anteriores a cada tentativa, inclusive retries e falhas. Há limites por categoria e por modelo, compartilhando research/text quando usam o mesmo modelo, além de RPM. Dia Gemini segue `America/Los_Angeles`; cap editorial permanece UTC. Config/modelo desconhecido bloqueia. TPM e quotas fora deste projeto exigem medição no AI Studio e continuam fora da garantia local.
5. **Veto à geração de imagem paga:** a função e a RPC não habilitam Nano Banana mesmo com flag antiga verdadeira; imagens do produto, quando autorizadas, e Pexels mantêm o fluxo. Nenhuma troca por modelo pago.
6. **Emenda aos ADR-004/011:** dispatch reservado antes do POST; não repetir automaticamente POST de resultado ambíguo. TTL, lease e teto de três dispatches automáticos limitam duplicação; `force` segue exclusivo do service worker. Checkpoints do renderer recebem hash dos inputs completos/configuração e geração de refação. Música respeita `music.volume`. Falhas atrasadas não alteram episódios fora de `assets`.
7. **Emenda ao ADR-012:** uma imagem ou um áudio novo por invocação, com persistência antes do `202 CHECKPOINT_PENDING`. Pre-flight é checkpoint separado; áudio existente com engines conflitantes é invalidado. As legendas só são geradas após conjunto consistente. Reutilizar o handler exigiu extraí-lo de `index.ts`; não é um segundo engine.
8. **Emenda ao ADR-013:** pipeline começa desabilitado; cron passa a executar um passo por minuto e retomar episódios antes de consumir ideias novas. `--check` é local; `--smoke-test` valida infraestrutura sem consumir a fila ou publicar. Não enviar secrets com prefixo reservado `SUPABASE_` para o runtime hospedado. `verify-migrations.sql` falha quando invariantes estruturais faltam. Supabase local via CLI requer Docker; para respeitar a restrição desta tarefa, os testes SQL usam PostgreSQL nativo isolado. Isso não equivale a testar Supabase local completo.
9. **Emenda de segurança aos ADR-001/009:** autenticação service-only dentro de cada worker, além da validação JWT do gateway. `.env.*` fica ignorado, exceto `.env.example`; scan de padrões no código/histórico. Imagem afiliada requer `product_compliance.image_rights_confirmed=true` e hostname HTTPS explicitamente permitido em `assets.affiliate_image_hosts`; redirects, credenciais na URL e formatos ativos são rejeitados; tamanho é limitado durante a leitura. URL comercial não prova propriedade da imagem.
10. **Emenda pontual ao ADR-005/010:** array de cenas vazio produz erro Zod, sem exceção incidental; IDs de cenas são únicos; contagem de tags considera aspas implícitas; timestamp ASS transporta centésimos para o segundo/minuto seguinte. Hash editorial existente é preservado.

### Impacto e reversibilidade

- Migration nova e aditiva; migrations históricas preservadas. `failure_from_status`, `api_budget_usage` e `episode_leases` são novos dados operacionais, sem novos estados de episódio.
- Episódios legados já em `failed` não têm origem recuperável automaticamente. O operador precisa reconciliar a origem a partir dos eventos antes do retry; não adivinhar.
- Refação em `review → script` arquiva os registros anteriores no evento `approval_rejected.metadata.previous_assets` antes de retirar os registros ativos de `assets`; invalida aprovação/output. Objetos Storage antigos não são apagados por esta migration; retenção é uma entrega separada. O snapshot permite restauração administrativa dos registros. `review → assets` preserva assets e invalida checkpoints de render por geração.
- Deploy de código antigo contra a migration nova não é suportado: o antigo budget guard não faz reservas. Reversão operacional: desabilitar `pipeline.enabled`, manter dados e reimplantar versão compatível; não executar down migration destrutiva.
- Seed é insert-only. Projetos com seed anterior devem acrescentar `budget.gemini_models` deliberadamente; o verificador bloqueia ausência, sem sobrescrever limites já calibrados. Para projetos novos, valores são tetos internos conservadores, não cotas prometidas pelo fornecedor.
- Configurações de endpoints TTS antigos deixam de ter efeito. Geração Gemini de imagem fica indisponível por política de custo. Fallback Piper depende de download inicial dos pesos; depois a síntese é offline.

## Prevenção

- CI verifica core **e renderer**, todos os entrypoints Deno, autenticação, checkpoint de áudio, regras SQL e concorrência com 12 clientes.
- Teste real FFmpeg com Storage/PostgREST simulados verifica dois formatos, trilha de áudio, duração e reutilização de intermediários. CI também testa síntese real Piper, sem credenciais cloud.
- `scripts/preflight.mjs --production` falha enquanto faltarem módulos obrigatórios; não confundir deploy técnico de cinco workers com pipeline pronto para publicação.
- [Relatório](../auditoria-2026-09-11.md) mantém severidade, evidência, correção e pendência. [Plano](../plano-implementacao.md) define a evidência exigida para encerrar cada bloqueio.
- Nenhuma publicação, mensagem Telegram ou alteração cloud foi executada nesta auditoria. Commit/push foram solicitados pelo operador e ficam condicionados a testes e scan passarem.
