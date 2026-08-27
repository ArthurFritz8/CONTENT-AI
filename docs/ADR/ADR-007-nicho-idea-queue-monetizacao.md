# ADR-007 — Nicho, idea_queue e Estratégia de Monetização

## Objetivo
Definir a origem do pipeline (estado `idea`): de onde vêm as ideias, qual o nicho editorial, qual o rigor factual e como o projeto monetiza — destravando `orchestrator`, `research-prompt` e `fact-checker`.

## Contexto
- Duas opções para fonte de ideias: trending-discovery automático vs. fila curada humana. Decisão: **fila curada via Telegram** — 10x mais simples, controle editorial total, zero quota de API. Trending-discovery fica como evolução futura (exigirá ADR próprio).
- Nicho sem definição bloqueava a calibragem do grounding (500 req/dia compartilhados) e o rigor do fact-checker.

## Solução

### 1. idea_queue e fluxo de consumo (`20260826000001_idea_queue.sql`)
- Tabela `idea_queue`: `briefing`, `niche`, `category`, `product_url` (opcional — link de afiliado), `priority` (**menor = consumido primeiro**, default 100), `status` (`pending|consumed|rejected`), `episode_id` (FK de rastreabilidade), `consumed_at`.
- Bot do Telegram (a implementar em `apps/local-renderer`) recebe `"PRODUTO | DESCRIÇÃO | NOTAS"` e insere em `idea_queue`.
- **Correção sobre a proposta (veto)**: o fluxo "SELECT depois UPDATE" tinha race condition — invocações paralelas consumiriam a mesma ideia e criariam episódios duplicados. Substituído por função SQL **`consume_next_idea()`** com `FOR UPDATE SKIP LOCKED`: pega ideia + cria episódio + marca `consumed` numa única transação (falha = rollback, ideia preservada).
- `product_url` presente → `episodes.product_compliance = {affiliate_link, commercial_content: true}` → obriga disclosure na publicação (encadeia com invariante do script_json, ADR-005).
- Orchestrator (`supabase/functions/orchestrator/index.ts`) respeita `pipeline.max_episodes_per_day` de `system_config` antes de consumir (aprimoramento — sem isso, fila cheia = episódios ilimitados/dia).
- Constraint `consumed_requires_episode` + índice parcial `(priority, created_at) WHERE status='pending'`.

### 2. Nicho: gadgets e produtos inovadores
- Categorias: tech gadgets, home innovations, productivity tools. Foco: produtos que resolvem problema real de forma criativa.
- Ângulo editorial: "você não vai acreditar que isso existe" → demonstração → comparação → CTA.
- Calibragem do research-prompt: grounding busca produto, funcionalidades, reviews e comparações com concorrentes; **cada fato exige claim + source_url + confidence**. Config em `system_config.niche` (seed) — o prompt lê de lá, não hardcoded.

### 3. Fact-checker nível BAIXO-MÉDIO (não-YMYL)
- **BLOQUEIA**: claims médicas (trata/cura/previne/emagrece), financeiras (melhor investimento/garante retorno), superlativos absolutos (o melhor do mundo/único no mercado).
- **PERMITE**: comparações relativas, claims de funcionalidade verificáveis, opiniões qualificadas.
- Padrões em `system_config.fact_check` (regex por categoria, `\m`/`\M` word boundaries do Postgres) — calibráveis sem deploy. Implementação do `fact-checker.ts` virá com a etapa de QA (usa esta config como fonte).

### 4. Monetização em 3 fases
- **Fase 1 (MVP)**: orgânico YouTube (canal dark + Shorts) + upload manual TikTok.
- **Fase 2**: TikTok Shop com afiliados (após auditoria da Content Posting API).
- **Fase 3**: tráfego pago (somente com renda própria do projeto — mantém zero-budget).
- Disclosure: `commercial_content=true` sempre que houver `product_url`/`affiliate_link` (imposto em cadeia: idea_queue → product_compliance → script_json → publicação).

## Prevenção
- Consumo atômico com SKIP LOCKED elimina duplicatas por concorrência — dupla camada com o `script_hash` UNIQUE.
- Cap diário config-driven protege quota do Gemini e o budget de render.
- Regras factuais como config = ajuste de rigor sem tocar código (se o nicho expandir para YMYL, novo ADR + novo perfil de risco).
- Rastreabilidade completa: ideia → episódio → eventos, auditável ponta a ponta.
