# Auray — avaliação real de fala em português

Data: 14/10/2026. Resultado: clipe individual com áudio nativo aprovado pelo usuário; continuidade de voz entre cenas/capítulos e produção ainda pendentes.

O usuário autorizou gerar a cena. Usado `docs/stories/auray-native-dialogue-audition.json`: retrato original de Malu, cinco segundos, seed 7014, frase solicitada “Você fez as malas? Ia embora sem me contar?” e direção vocal feminina brasileira. Não foi fornecido o WAV nem um perfil da voz anteriormente aprovada. A geração de fala foi solicitada pelo prompt, com os dois opt-ins descritos no ADR-076; não foram acrescentados parâmetros inexistentes à API.

## Entrega e custo

Uma solicitação, sem reenvio: concluída e liquidada por cinco créditos gratuitos; saldo confirmado após a entrega: 40. O primeiro teste visual já havia consumido outros cinco. Nenhum consumo Modal ou API paga. A leitura da carteira continuou confirmando plano Free, créditos do plano e nenhuma compra ou promoção.

MP4 original: 1.690.486 bytes, 768 × 1344, 24 FPS codificados, 124 quadros, vídeo de 5,166667 s com áudio. SHA-256: `4ddbdf6f7e236412b909fb86f27c05a45b95627059b11ed2bef9feacd402218d`. O arquivo `output/auray-teste-com-fala-2026-10-14.mp4` é cópia integral desse MP4, preservando imagem e som originais, sem interpolação, áudio substituído ou legendas que aparentem uma fala diferente.

Checkpoint, QA e folha de 20 quadros: `output/auray-video-jobs/3f5defa1b909af32f6eba1c7d00910d8563c8076c64c3717a92f9a864053e81f/`. Todos os arquivos audiovisuais/recibos ficam ignorados pelo Git. A fonte continua fora da carteira e do roteador de produção.

## Conferência de áudio e imagem

Transcrição local com faster-whisper-base, pesos já em cache, CPU/int8, sem download, GPU ou API externa. O áudio foi decodificado pelo FFmpeg para PCM 16 kHz em memória, evitando uma incompatibilidade do PyAV instalado. Idioma detectado: português, probabilidade de idioma 0,9962; isso não é uma taxa de exatidão da frase.

Transcrição: “Você fez as malas e embora sem me contar?”. O controle positivo com o WAV aprovado transcreveu “Você fez as malas? E embora sem me contar?”. Após normalizar pontuação/acentos, ambos os resultados são iguais; ambos confundem “Ia” com “E”. Esse controle apoia a presença do conteúdo pedido, mas não certifica pronúncia literal, voz idêntica ou sincronismo. O reconhecedor marcou fala aproximadamente entre 1,28 e 4,80 s. Essa análise automática antecedeu a aprovação do usuário registrada abaixo.

A folha de quadros e a imagem em 2,4 s mostram a personagem reconhecível, articulação de boca e mudanças de sobrancelhas/expressão, com roupa e cenário consistentes de modo geral. Essa inspeção não aprova todos os quadros nem o alinhamento de fonemas. Os 24 FPS continuam diferentes do master anterior de 60; não foram inventados quadros para alegar fluidez nativa maior.

## Aprovação do usuário

Após receber o MP4 original com som, o usuário respondeu **“ficou otimo!!!”** em 14/10/2026. Aprovação audiovisual geral desta amostra, vinculada ao SHA-256 acima e registrada separadamente em `human-review.json`. O QA técnico original permanece como medido antes dessa revisão. Não interpretar o elogio como atestado quantitativo de cada fonema, de identidade com a voz Modal ou de estabilidade entre futuras gerações.

Próxima avaliação: outra frase da mesma personagem e uma resposta do segundo personagem, verificando identidade, voz, expressão, fluidez e corte entre cenas. A estabilidade da voz entre novas falas/capítulos ainda exige avaliação própria: o endpoint não oferece importar a voz anterior nem um identificador vocal persistente. Aprovação desta amostra não altera carteiras, flags ou homologação da fonte de produção. Nenhuma nova geração foi feita para registrar o feedback.
