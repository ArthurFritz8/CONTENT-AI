# ADR-017 — Evidência de grounding rastreável antes do roteiro

## Objetivo

Preservar e validar as citações reais da resposta Gemini antes de promover pesquisa ou gastar com roteiro/assets. Sem novo serviço, dependência ou estado.

## Contexto

O ADR-016 confere pares claim/URL contra `research_data`, mas o worker de pesquisa descartava `groundingMetadata` e aceitava URLs escritas pelo modelo. Solicitar Google Search não comprova que houve busca nem que uma afirmação possui citação.

A [referência Gemini](https://ai.google.dev/api/generate-content#Segment) define offsets em bytes dentro de cada Part. O [guia de grounding](https://ai.google.dev/gemini-api/docs/generate-content/google-search) relaciona segmentos a índices de fontes e inclui consultas e Search Suggestions. Nenhum desses campos equivale a verificação factual independente.

## Solução

- Capturar partes visíveis preservando seus índices e metadata de grounding da mesma candidate. Não concatenar pensamentos à saída JSON.
- Exigir consultas, chunks web e supports válidos. Validar offsets UTF-8, texto do segmento e índices. Cada claim precisa estar integralmente coberto por uma citação; não inferir suporte por semelhança textual ou posição aproximada.
- Derivar `research_data.source_url` dos chunks citados: preferir a URL do modelo quando corresponder a um deles, senão usar o primeiro chunk válido. Isso acomoda links de redirecionamento do Google sem inventar equivalência com a URL do modelo. Preservar a URL original na resposta arquivada. Não seguir redirects nem buscar páginas nesta etapa.
- Adicionar `episodes.research_evidence` nullable via migration aditiva. Salvar partes originais, metadata, modelo, versão e momento da coleta junto com `research_data` e a promoção, numa única atualização condicionada ao estado `idea`.
- Evidência ausente, inválida ou sem cobertura de todos os claims impede promoção e gera falha auditável, sem repair que gastaria outro grounding. Falha de banco não vira aprovação fictícia.
- Script/assets reconstroem o resultado a partir da evidência salva e o comparam com a pesquisa atual antes de consumir providers. Evidência ausente ou pesquisa editada é bloqueada. Contrato `research_data` e máquina de estados permanecem iguais.
- Limitar snapshot a 256 KiB; rejeitar excesso sem truncar offsets. `searchEntryPoint` é armazenado como dado, nunca executado como HTML. A interface futura de revisão deve implementar as exigências de exibição do provedor.

## Impacto e reversibilidade

Pesquisas legadas sem evidência não ganham aprovação automática. Criar um novo episódio de pesquisa ou reconciliar administrativamente com evidência autêntica; não fabricar metadata. A flag de revisão humana continua obrigatória. Links podem expirar e citações podem estar erradas; ainda faltam validação real Gemini, leitura humana das fontes e QA audiovisual.

Reversão: pausar pipeline e reimplantar versão anterior compatível, preservando a coluna e os dados. A migration não apaga episódios nem altera estados existentes. Cloud não é modificado pelo desenvolvimento local.

## Prevenção

Testes de UTF-8/partes, escaping JSON, offsets inválidos, chunks inexistentes, suporte parcial/ausente, source_url inventada, limites e alteração posterior da pesquisa. Integrações HTTP testam persistência atômica, concorrência, orçamento e bloqueio antes de providers. CI mantém PostgreSQL nativo, FFmpeg e Piper.
