# ADR-022 — Gemini 3.6 Flash para texto e pesquisa

## Contexto

O primeiro episódio real recebeu `404 NOT_FOUND` ao chamar `gemini-2.5-flash`. A própria API informou que esse modelo não está disponível para novos usuários e indicou `gemini-3.6-flash`. A listagem autenticada confirmou que o modelo novo suporta `generateContent`, `countTokens`, cache e batch, com janela de entrada de 1.048.576 tokens e saída de 65.536 tokens.

## Decisão

- Usar `gemini-3.6-flash` para estruturar a pesquisa e gerar o roteiro.
- Manter `gemini-2.5-flash-image` e `gemini-2.5-flash-preview-tts`, que continuam disponíveis na conta.
- Não usar Google Search grounding do Gemini 3.6 no projeto gratuito; a indisponibilidade descoberta no piloto é tratada pelo ADR-023.
- Preservar os limites internos conservadores de 5 RPM e 20 RPD até medir a cota real exibida no AI Studio.
- Atualizar defaults, seed, configuração cloud e testes. Episódios ainda em `idea` podem ser retomados sem recriação.

## Consequências

Novos projetos deixam de falhar antes da primeira pesquisa. O uso de `generateContent` continua válido porque o modelo anunciou esse método na descoberta autenticada; a migração para Interactions API fica fora deste piloto e exige avaliação separada.

## Rollback

Pausar o pipeline e selecionar outro modelo listado pela API no `system_config.gemini`, atualizando a entrada correspondente no budget guard antes de retomar.
