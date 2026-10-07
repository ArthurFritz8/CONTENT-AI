# ADR-055 — Poses próprias para mãos estáveis

Data: 2026-10-06. Status: movimentos da prévia aprovados pelo operador, amplitude ainda insuficiente; não habilitada em produção.

## O — Objetivo

Gerar uma nova amostra para o operador após reprovação da variante expressiva por mãos deformadas. Priorizar preservação de anatomia e fala, com atuação moderada, sem substituir a conversa aprovada.

## C — Contexto

O defeito do ADR-054 aparece no quadro nativo: interpolação não reconstrói dedos corretos. Só pedir mais gestos no texto não produziu controle suficiente. Isto já existe em `scripts/modal-speech-motion-probe.py`: imagem/áudio por hash, S2V, RIFE, reserva exclusiva e limite de uma chamada. Reutilizar. Wan S2V aceita `pose_video` junto do áudio; o worker antes passava `None`.

O usuário autorizou uma versão melhorada para revisar. Não autorizou publicação ou habilitação automática no Studio. Episódios seguem mínimo de 60 s e renderer de produção a 30 fps. Esta é uma prévia de quatro segundos, sem banco ou estados novos.

## S — Solução

Conectar bytes e hash de um guia de poses opcional ao worker. Validar antes de criar app e novamente antes de carregar o modelo: checksum, até 2 MiB, H.264 sem áudio, 704 × 1280, 64 quadros a 16 fps, origem zero e decode integral. Guia curto, retimado ou alterado é rejeitado. Defaults anteriores continuam sem guia.

`prepare-stable-hand-guide.py` produz um mapa técnico próprio de corpo e duas mãos com 21 pontos cada, anotados manualmente sobre a referência própria ajustada à entrada do modelo. Não é edição artística do personagem nem um detector automático de dedos. Geometria de dedos permanece constante: sem flexão/rotação individual. Mão na cintura ancorada; palma visível se desloca menos de 12 px, cotovelo/ombros e cabeça fazem movimentos pequenos. Guias não desenham membros inferiores fora do quadro. Inspecionar o alinhamento na referência antes de criar a chamada. O primeiro rascunho de anotação foi arquivado em `output/stable-hands-guide-draft/` e refinado antes de qualquer inferência.

`--pose-controlled` usa pasta separada `output/stable-hands-motion-probe/`, mesmo PNG, WAV/voz, seed 2007, pesos fixados, 40 passos, resolução e FPS do controle. Duas variáveis experimentais declaradas: prompt simplificado e condicionamento por pose. Não declarar uma comparação de somente prompt. Mais sentimento vem de olhar, sobrancelhas, cabeça, postura e ombros; evitar mãos perto da face, dedos girando e braços cruzados. A forma esquemática das mãos no guia não garante a anatomia do resultado; cor/projeção e aderência desse guia sintético precisam de validação visual real.

Uma chamada de até 2.100 s, sem retries, limites do provedor inalterados. Estimativa máxima só do worker US$ 2,712, excluindo startup/build/idle, não representa saldo ou fatura. Sem serviço pago adicional, nova API TTS, imagem de personagem ou biblioteca. Processamento técnico do guia em CPU; animação em nuvem, sem exigir GPU no aparelho do cliente. Reutilizar auditor e comparador, identificando a pose recebida pelo worker. Não interpolar entre cortes ou remendar uma mão estática sobre uma cena em movimento.

## P — Prova

- Quatorze testes locais passaram: contratos anteriores e rejeição de guia alterado, curto ou retimado; preservação da geometria das duas mãos/âncoras por quadro.
- Inspeção do mapa sobre referência: ajustar olhos/nariz e mão da cintura antes da geração; preservar o rascunho e os controles anteriores.
- Conferir hash do guia no relatório do worker, mesmas entradas/configuração, decode, áudio sem deslocamento e timestamps/quantidade de quadros.
- Inspecionar nativo e interpolado durante toda a tomada, com foco em mãos, punhos, face e recuperação do gesto. QA técnico não certifica anatomia ou fonemas.
- Entregar arquivo e comparação ao operador, registrar tempos/custo e confirmar app parado/zero tarefas. Se ainda houver defeitos, informar a limitação e não promover a variante para capítulos.

### Resultado observado

Uma chamada concluída: `output/stable-hands-motion-probe/malu-fluid.mp4`, 3,950 s, 704 × 1280, 237 quadros a 60 fps interpolados de 64 quadros nativos a 16 fps. SHA-256 `f8be7c3937e1cf4806e779060c0c9b2062a26693b411c4e60483df6ea4489d2f`. O worker confirmou o condicionamento e o SHA do guia `1f729b535a2440571aa3902ba431eae23e1f93687fcb5a2e4a2837048a723d77`.

Decode, integridade, origem zero e áudio passaram: deslocamento medido 0 s, correlação PCM 0,999937773; erro máximo da grade de timestamps 0 s no nativo e 0,000000333 s na versão interpolada. `audit-stable-hand-probe.py` também produziu quatro folhas contendo os pares de mãos de todos os 64 quadros nativos. Inspeção dessas folhas, dos 12 momentos de cada versão e dos quadros completos de 3,04 s: mãos temporalmente estáveis, sem a perda/deformação forte observada no teste rejeitado. Isso não certifica anatomia perfeita ou sincronização fonética. O movimento corporal ficou muito contido; maior amplitude de gestos continua sem validação. Não atribuir sucesso exclusivamente à pose: prompt e guia mudaram juntos.

Comparação com o **controle original aprovado**, não com a variante expressiva rejeitada: `comparacao-gestos.mp4`, SHA-256 `deb7e4ac589db73c070a36f50df1b9f9ff77f1204180956b013c3a46025c643c`. Relatórios `qa.json`, `comparison-qa.json`, `hand-review-qa.json` e `visual-review.json` separados da futura aprovação humana.

Worker: 1.328,406 s; estimativa US$ 1,716 só de compute do worker, sem build/startup/idle e sem consulta à fatura/saldo. App `ap-fqV7IZoVLCY3Okpro1bXi9` confirmado `stopped`, zero tarefas. Quatorze testes locais passaram; não houve execução de CI remota, alteração de banco, publicação ou habilitação no Studio.

### Revisão do operador e próximo experimento

O operador avaliou: “fez pouco movimento, mais os movimentos que fez ficaram bons!”. Registrar em `output/stable-hands-motion-probe/operator-review.json`, vinculado ao hash do vídeo. Isso aprova a qualidade dos movimentos observados, mantendo a amplitude insuficiente; não constitui certificação anatômica, nova aprovação fonética, aprovação de capítulo ou autorização para publicar.

Preservar esta amostra como referência de estabilidade. O próximo experimento deve ampliar um único gesto de braço/cotovelo, com palma e dedos na mesma orientação, mantendo voz, prompt, seed, pesos e demais parâmetros. Olhar/cabeça/ombros podem ganhar expressividade em uma etapa posterior, sem mudar tudo simultaneamente. Comparar diretamente com esta amostra, revisar guia antes da GPU e mãos nos quadros nativos após a geração. Mais FPS não substitui direção de atuação. Este registro não inicia outra inferência nem comprova que maior amplitude será estável.

Fonte primária: [Wan S2V — pose e áudio](https://huggingface.co/Wan-AI/Wan2.2-S2V-14B#run-speech-to-video-generation), [implementação usada](https://github.com/Wan-Video/Wan2.2/blob/1ea34ff48f87168174e12956e200b1d908b1c5ff/wan/speech2video.py).
