# ADR-024 — Fallback de modelo para pesquisa Gemini

## Objetivo

Evitar que indisponibilidade temporária de um modelo interrompa a fila de pesquisa.

## Contexto

O primeiro teste real, já com a busca Tavily funcionando, recebeu `503 UNAVAILABLE` do Gemini 3.6 Flash e do Gemini 3.5 Flash por alta demanda. O Gemini 3.1 Flash-Lite respondeu com baixa latência. A pesquisa extrai fatos de fontes já recuperadas e não precisa do modelo mais avançado do projeto.

## Solução

- Usar `gemini-3.1-flash-lite` como modelo padrão de pesquisa, mantendo `gemini-3.6-flash` para roteiro.
- Registrar 3.1 Flash-Lite, 3.5 Flash e 3.6 Flash no budget guard, com teto conservador de 20 RPD e 5 RPM.
- Manter a configuração em `system_config.gemini`, permitindo voltar ao 3.6 quando a disponibilidade se estabilizar sem alterar código.

## Prevenção e rollback

Toda chamada continua passando pela reserva atômica e pelo registro de uso. Para voltar ao 3.6, alterar somente `research_model` após validar disponibilidade no AI Studio; não é necessário reprocessar fontes já persistidas.
