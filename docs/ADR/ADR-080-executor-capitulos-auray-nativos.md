# ADR-080 — Executor durável de capítulos com diálogo nativo Auray

Data: 15/10/2026. Status: executor e contrato implementados; admissão pelo painel e ativação ainda pendentes. Nenhuma geração nova nesta etapa.

## Decisão

A API MiniMax H3 da Auray aceita imagem inicial e direção de fala, mas não recebe o WAV aprovado no fluxo Modal. Um capítulo nativo usa um contrato separado, `auray-native-1.0.0`: voz gerada pelo fornecedor, confirmação explícita de que ela pode variar e revisão obrigatória. Não converte um perfil Modal, não certifica clonagem, não declara transcrição verificada e não muda a fonte silenciosamente.

O contrato exige referências de todo o elenco, direção vocal por personagem, estilo de até 700 caracteres, exemplo privado identificado por hash e aceite de voz nativa. O plano tem três tomadas de cinco segundos, com 3–8 palavras por fala e apenas o personagem que fala em cena. A história, a bíblia e os resumos aprovados entram na impressão digital. A instrução de estilo acompanha todas as tomadas. O contrato final registra os quadros realmente medidos, não uma duração arredondada de cinco segundos.

## Execução e orçamento

`createNativeRun` exige inspeção vigente do plano Free recorrente, carteira sem créditos comprados/promocionais, teto finito da chave, contrato da API correspondente ao perfil e pelo menos 15 créditos disponíveis tanto no plano quanto na chave. São três solicitações de 5 créditos, sequenciais. A chave idempotente inclui episódio, impressão digital e índice da tomada; capítulos diferentes não reutilizam acidentalmente o mesmo job.

`studio_native_runs` guarda o estado privado com reserva integral e uma única reserva pendente por carteira física. O vínculo de carteira é o mesmo do monitor já conectado. A reserva exige episódio em pesquisa, perfil congelado, fonte Auray, política de variantes e exemplo revisado da mesma fonte, estilo e workspace. O gate `story_production.native_chapter_enabled` permanece ausente/desativado. Esta migração não fornece uma maneira de o navegador inventar saldo ou cadastrar um perfil nativo; a admissão e a configuração visual serão ligadas numa etapa posterior.

O worker compartilha a trava da conta com o monitor. As concessões de cinco minutos são renovadas; um processo com token antigo não grava nem limpa a concessão nova. Cada atualização de estado usa revisão crescente e comparação com o estado anterior. O banco preserva identidade, ordem, cobranças já vistas e clipes concluídos. Créditos nativos reservados aparecem no total reservado da carteira e são descontados da comparação de tomadas. Não são somados a dólares do Modal.

Uma atualização das tomadas invalida a validade do saldo anterior e preserva seu valor como histórico. Liberar a reserva depois da conciliação não transforma uma consulta antiga em capacidade disponível; uma nova observação da API é necessária.

O identificador esperado e a fase `submission_started` são persistidos **antes** do POST de geração. Se houver interrupção nesse ponto, o worker consulta somente esse job, inclusive quando recebe 404; não reenvia automaticamente. Uma resposta de gravação perdida após a aceitação também não autoriza outra geração. Falha, cancelamento ou aceitação incerta bloqueiam a sequência e conservam a reserva para conciliação. Não existe fallback para outra conta ou fornecedor. A cobrança pode demorar a aparecer: a reserva só é liberada depois que os três resultados estão liquidados e recolhidos, há montagem salva e os contadores verificados refletem os créditos cobrados. Uma mudança de mês impede enviar tomadas que ainda não começaram, mas permite recolher jobs antigos.

`story-native.yml` é um workflow isolado, sem agendamento, que recebe somente um episódio já admitido. `scripts/run-native-story-chapter.mts` não aceita prompt, token ou caminhos arbitrários por argumentos. Não cria uma reserva a partir de um arquivo local. O monitor `story-auray-sync.yml` continua somente de leitura. O workflow ainda não é despachado pelo pipeline normal.

## Montagem e revisão

O worker confere SHA-256, imagem PNG, proporção, limites de bytes, vídeo H.264/yuv420p 768 × 1344, áudio nativo, decodificação completa e 116–124 quadros a 24 FPS por tomada. Uma saída fora desse contrato bloqueia a montagem, sem reduzir resolução ou aumentar FPS para disfarçar a diferença.

A montagem usa `assemble_auray_sequence.py`: copia os quadros originais, normaliza timestamps do áudio, concatena e codifica AAC uma vez. Confere todos os quadros decodificados, ordem, duração, correlação do áudio e desvio de sincronismo. Não aplica interpolação, dublagem, nitidez artificial nem reencodificação de vídeo. Esses testes comprovam transporte dos quadros e do áudio; não comprovam anatomia, atuação, identidade vocal, pronúncia ou fidelidade da fala. A revisão humana continua necessária.

Vídeos, roteiro e comprovante ficam em `studio-private/episodes/<episódio>/native/<hash>`. Upload interrompido só é aceito quando os mesmos bytes são recuperados; não há sobrescrita. A conclusão no banco verifica os hashes dos textos exatos do roteiro e do comprovante, ligação às três tomadas, falas, contexto, perfil, duração e verificações da montagem. A transação passa por roteiro/assets/renderizado; não aprova nem publica. A prévia do painel já sabe assinar esse espaço privado após autorizar o episódio. O renderer comum recusa o contrato nativo para não substituir áudio ou quadros.

O comprovante inclui a política editorial realmente usada na checagem. A migração incremental `20261015010000` exige que ela ainda corresponda à configuração vigente ao concluir o capítulo. Uma alteração de política bloqueia a conclusão com QA antigo; o worker não pode chamar a função anterior para ignorar essa verificação.

## Validação e trabalho restante

Testes sem credenciais simulam saldo insuficiente, mudança de mês/conta/chave, inspeção vencida, perda de concessão, falha definitiva, timeout depois da aceitação, interrupção antes do POST, perda de resposta de persistência e atraso de faturamento. SQL verifica isolamento, reserva, concessão compartilhada, revisão concorrente, estados imutáveis, hashes dos arquivos e montagem idempotente com tomadas de 124 quadros. FFmpeg real verifica quadros e áudio offline.

Ainda faltam o formulário nativo com exemplo/aceite, finalização do perfil pelo servidor, rascunho nativo integrado ao roteirista, admissão/reserva automática, despacho/retomada pelo pipeline e apresentação de progresso específico. Portanto o executor não é anunciado como geração Auray já disponível ao usuário. Não habilitar o gate nem fabricar perfis para contornar essas etapas. A primeira validação completa pela interface deve respeitar o saldo real e exigir somente as gerações aprovadas para aquele capítulo.

A consulta somente de leitura em 15/10/2026 confirmou 30 créditos Free e 30 no teto restante da chave. O preço consultado era 5 créditos por tomada: teto orçamentário de dois capítulos de três tomadas, sem margem para falhas. Esse instantâneo não é promessa de saldo futuro ou qualidade artística. A consulta não consumiu créditos de vídeo.

A montagem offline dos três clipes nativos existentes produziu 15,5 segundos, 768 × 1344, 24 FPS e 372 quadros, todos idênticos e na mesma ordem. A maior defasagem medida entre áudio de origem e montagem foi de 0,0000625 segundo. Não houve geração nova. As 46 migrações foram aplicadas num banco local vazio, com verificação estrutural e 21 arquivos de testes SQL. A migração `20261015000000` foi aplicada transacionalmente no servidor, com zero execuções nativas, zero carteiras habilitadas e o gate nativo desativado. Recibos locais privados: `.audit-tmp/native-executor-schema-deployment.json` e `.audit-tmp/native-existing-assembly/assembly-qa.json`.
