# ADR-059 — Direção corporal e cobertura de cenas

Data: 2026-10-07. Status: decisão e plano documentados; geração e integração pendentes. Sem nova GPU.

## O — Objetivo

Incorporar o feedback do operador: qualidade do trecho vista como muito boa, mas falta atuação corporal além da cabeça/mão e variedade de cenas/enquadramentos. Preservar a base visual aceita, transformando a próxima melhoria em direção verificável.

## C — Contexto

Prévia do ADR-058, SHA `ac18bbadaf2027b668733928c8729f909200227c1e55d3e35f9d1ad27b7f9a4e`. Operador relatou ter visto poucos segundos: aceitar somente a qualidade desse trecho, mantendo revisão integral e publicação pendentes. Feedback registrado por hash em `operator-review.json`, sem sobrescrever o vídeo ou converter aprovação parcial em aprovação de capítulo.

Isto já existe em `scripts/modal-speech-motion-probe.py`, `scripts/prepare-stable-hand-guide.py` e nos scripts de conversa: áudio condicionado, guia de pose, direção textual e edição de tomadas. Os prompts atuais pedem atuação contida/câmera estável e as referências restringem a montagem a dois enquadramentos. Ampliar FPS interpolados não cria novas ações. A variante expressiva sem guia do ADR-054 teve defeitos nas mãos; não voltar a simplesmente pedir muitos gestos simultâneos.

Isto já existe em `packages/core/src/stories/schema.ts`: elenco, contexto/continuidade, local, emoção e objeto. Não existe ali contrato de enquadramento, ação corporal ou cobertura audiovisual. `buildStoryScript` usa cenas de 12 s fixos: são durações de roteiro estimadas, não fala medida nem contrato pronto para a geração experimental S2V. O schema de referências do experimento também restringe hashes; abrir o quadro pode exigir nova referência revisada antes da inferência.

## S — Solução

Plano editorial em `docs/story-direction-next-test.md`: manter a conversa e propor cobertura de plano conjunto, fala corporal, reação, cobrança, detalhe do biscoito, contraplano, aproximação e reação final. Total hipotético 22,4 s com quatro falas existentes e inserções propostas. Não declarar novas imagens/animações geradas; animação silenciosa ainda não validada pelo worker atual. Não completar duração com loops/freeze. Min60s de episódio continua inalterado.

Primeira prioridade de GPU futura: uma tomada de Laranjito com o WAV existente da fala 06 e uma ação corporal simples de transferência de peso/recuo breve do tronco. Guia específico da referência dele, sem copiar pontos de Malu. Inspecionar mãos/roupa/oclusões/continuidade, boca e atuação na reprodução integral. Reaproveitar as demais tomadas ao avaliar a substituição. Não financiar todas as oito tomadas antes de validar essa melhoria.

Separar cena dramática de tomadas de fala/reação/detalhe, com duração medida e finalidade narrativa. Direção será opcional no modo história, reutilizando os contratos do core; gadgets e vídeos independentes permanecem disponíveis. Nenhuma alteração de produção/schema é executada neste ADR. Planejar variedade sem mudança gratuita de cenário; mudar ambiente somente por necessidade da história. Cropping digital não é outro ângulo real. Continuidade de identidade, objeto, eixo e luz é parte da revisão.

Saldo mais recente informado US$ 11,70; não consultado via API. Esta rodada não gera imagem, TTS ou inferência. Não aumentar limite nem acionar benchmark repetitivo. Orçamento por chamada e revisão de novas referências precedem qualquer teste futuro. Revisão parcial não autoriza publicação, episódio de produção ou instalação automática no Studio.

## P — Prova

Hash de master conferido contra assembly/QA antes de registrar o feedback. Contratos e prompts existentes lidos para verificar redundância e limites. Documento especifica durações reais, origem de cada material, capacidades ausentes, ação prioritária e revisão necessária. Atualização documental e registro local de aprovação parcial: nenhum código alterado, nenhuma nova capacidade ativada, nenhuma chamada remota ou banco. Não rodar novamente testes de código inalterado para simular validação de atuação que ainda não foi gerada. O último conjunto aplicável continua com 29 testes locais; nenhuma CI ou geração nova nesta rodada.
