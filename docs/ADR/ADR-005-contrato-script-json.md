# ADR-005 — Contrato Definitivo do script_json

## Objetivo
Definir o contrato de dados central do pipeline — a interface entre `generate-script` (produz), `generate-assets` (enriquece), renderer CLI (consome linha do tempo) e `publish-*` (extrai metadata) — de forma que os 4 módulos possam ser construídos em etapas sem quebrar uns aos outros.

## Contexto
- Decisões do usuário: (1) template híbrido — estrutura fixa (hook → claims com evidência → CTA → disclosure) com graus de liberdade controlados para o Gemini (3–8 cenas, 5–45s por cena, transição, Ken Burns, ordem dos claims); (2) um único `script_json` gera 16:9 + 9:16 + TikTok — uma narração, uma música, dois renders, um `script_hash` para idempotência em todas as plataformas.
- A proposta externa do contrato tinha dois bugs de design detectados no peer review.

## Solução
Schema Zod em `packages/core/src/schemas/script-json.ts` (fonte única de verdade, tipos inferidos) + utilitários de hash em `packages/core/src/validators/hash-utils.ts`.

**Correções sobre a proposta externa:**
1. **Campos `transition` e `ken_burns` ausentes** — a proposta declarava esses graus de liberdade no design mas omitia no contrato; o renderer não saberia o que aplicar. Adicionados como enums obrigatórios por cena.
2. **Contrato estagiado** — a proposta exigia `asset_*.url` preenchida, mas `generate-script` roda antes de `generate-assets` (violaria a máquina de estados do ADR-002). Corrigido: `asset_landscape`/`asset_portrait`/`music` são `nullable` até o estado `assets`; cada cena ganha `visual: { description, search_query }` (prompt para Nano Banana + query de fallback para Pexels); helper `isRenderReady()` impede render com asset faltando.

**Decisões de hash (idempotência):**
- `computeScriptHash` cobre apenas conteúdo **editorial** (metadata, narração, cenas sem assets, sources, disclosures) e exclui `episode_id`, `prompt_version`, `music` e assets — o mesmo roteiro em outro episódio/versão de prompt colide em `episodes.script_hash` (UNIQUE), bloqueando duplicata.
- `canonicalStringify` com chaves ordenadas garante hash determinístico; SHA-256 via Web Crypto roda idêntico em Deno e Node.

**Invariantes (superRefine):** `scenes[].order` contíguo 0..n-1; `commercial_content=true` exige `commercial_disclosure_text`; tags YouTube ≤ 500 chars totais (limite real da API); `contains_synthetic_media` é literal `true`; `sources` mínimo 1 (formato exige evidência). Enums de license/source espelham os CHECKs da tabela `assets`.

**Nota de toolchain:** testes Node com type-stripping exigem imports relativos com extensão `.ts` + `allowImportingTsExtensions`/`rewriteRelativeImportExtensions` no tsconfig (TS 5.7) — aplicado na base para todos os workspaces.

## Prevenção
- Constraints numéricos exportados como constantes (`SCENE_COUNT`, `SCENE_DURATION_SECONDS`) — o prompt do Gemini citará os mesmos valores; mudança em um lugar só.
- 15 casos de teste cobrindo violações (cenas < 3, duração fora do range, order duplicado, disclosure comercial faltante, script sem fontes, estabilidade/exclusões do hash) rodando no CI a cada push.
- Qualquer mudança de campo no contrato exige novo ADR — 4 módulos dependem dele.
