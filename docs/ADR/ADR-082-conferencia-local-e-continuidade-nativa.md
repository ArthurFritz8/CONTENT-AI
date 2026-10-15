# ADR-082 — Continuidade e conferência local dos capítulos nativos

Data: 15/10/2026. Status: implementação para novas gerações e revisão dos resultados existentes. Complementa o ADR-081.

O primeiro capítulo real preservou os quadros e o áudio na montagem, mas apresentou mudança de cor do figurino e possível fala extra. Integridade do arquivo não comprova fidelidade ao roteiro ou aparência. Não aprovar o piloto nem gastar o saldo restante para ocultar essas falhas.

Novos rascunhos recebem `generation_policy: reference_dialogue_v2` antes de serem congelados. A tomada inclui a aparência cadastrada na bíblia, preservação explícita de roupa, estampa, cores e acessórios e uma semente estável por referência/personagem. A direção pede um gesto simples, movimentos de postura e olhar coerente. O pedido de áudio usa somente a frase prevista, sem o cabeçalho experimental anterior, e proíbe introduções ou murmúrios. Isso é uma melhoria de instrução, não uma garantia de resultado ou identidade vocal.

A versão faz parte do rascunho e da identidade do job. Rascunhos antigos sem a versão mantêm exatamente a construção anterior do prompt, sementes e chaves. Nunca aplicar a nova política sobre checkpoints já congelados ou reenviar um job aceito para trocar seu prompt.

Após a montagem, `review_native_media.py` analisa somente arquivos existentes, sem editar vídeo, invocar geração ou usar GPU. A transcrição usa faster-whisper base em CPU, com revisão dos pesos fixada. O preparo baixa pesos públicos sem token; o processo de análise é offline. Falta de dependência, pesos ou decodificação aparece como indisponível, nunca como checagem aprovada. O workflow evita baixar pesos nas recuperações sem episódio. Falhas na análise não escondem o filme pronto.

A comparação das palavras sinaliza possíveis acréscimos ou omissões. Um histograma de cores em seis quadros da região inferior central sinaliza mudança de cor dentro da tomada. A hipótese de figurino pode errar com iluminação, enquadramento, pele, cenário ou pose. Não há reconhecimento de identidade, detecção de dedos ou verificação de sincronia labial. Mesmo sem avisos, a revisão humana continua obrigatória. Nenhum aviso gera nova tomada automaticamente.

O relatório está vinculado ao hash do filme e de cada clipe, personagem e frase do rascunho. `studio_native_media_reviews` é privada e imutável no fluxo de cadastro. Somente o worker/operador grava por RPC de serviço; a leitura exige membro do workspace e filme correspondente. O painel valida o formato e o hash do filme novamente, mostra os avisos depois do player e antes da decisão, e permite comparar roteiro e transcrição. O relatório não concede aprovação artística ou permissão de publicar.

`scripts/audit-native-story-chapter.mts ID --local-only` verifica bytes privados e produz o relatório local de um resultado existente. Sem essa flag, registra a análise no Studio. Não contém chamadas de geração. Pode analisar o piloto antigo sem alterar seu vídeo, roteiro, resumo ou aprovação.

Implantação: aplicar `20261015030000_native_media_review.sql`, publicar worker/painel e implantar `generate-research`, `generate-script`, `orchestrator` e `studio-story` na mesma versão. Não habilitar Modal ou outra fonte por causa desta entrega. Não gerar novo piloto sem autorização de orçamento.

Validação: o relatório local do piloto apontou possível fala extra nas cenas 1 e 2 e mudança de cor na cena 3, sem novo consumo de vídeo. Testes cobrem indisponibilidade, alteração de bytes, comparações de palavras/cores, isolamento, vínculo ao filme/tomadas, imutabilidade e leitura pelo painel em tela móvel. A política nova ainda precisa de uma geração autorizada para avaliar sua qualidade artística.
