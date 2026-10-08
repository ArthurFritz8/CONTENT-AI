# Audição da Malu no Google Flow

Status: preparada, **nenhuma geração enviada**. Conta 1 para a primeira tentativa; conta 2 preservada. Nenhum clipe entra no episódio ou é publicado sem revisão.

## Fonte e orçamento

- Referência aprovada: `output/flow-malu-audition/malu-referencia.png` (cópia idêntica de `output/suitcase-story-preview/references/malu-entryway-v1.png`), SHA-256 `d7ef0d3da2a31bd93f35988cab8b6d3fecf746cdf579277aea1e92b1e049776c`.
- Fala-alvo: **“Você fez as malas? Ia embora sem me contar?”** A locução original `output/suitcase-story-preview/02/voice.wav` dura 3,25 s; o Flow gerará a voz da audição, sem presumir que aceite o WAV como entrada.
- Confirmar no painel da **primeira conta** créditos restantes e custo exibido antes de gerar. Selecionar **um** resultado, 8 s, 9:16, Veo 3.1 Fast, modo **Ingredients/References** com a referência da Malu. Custo listado atualmente pelo Google: **20 créditos por geração**, sujeito ao valor atual na interface. Não comprar créditos. Não gerar automaticamente segunda variação.
- Se houver ferramenta **Characters**, cadastrar Malu usando a referência e uma voz feminina adulta em português brasileiro; usar `@Malu` no texto. Se a ferramenta não estiver disponível, usar a imagem como ingrediente diretamente. Não cadastrar avatar pessoal do operador.

## Prompt da tomada

> Use the uploaded image as the exact visual identity of Malu, an adult anthropomorphic apple woman. Preserve her expressive brown eyes and pupils, red apple skin with fine natural texture, curly auburn hair, gold hoop earrings, cream wrap dress with red flowers, body proportions and warm Brazilian apartment setting. One continuous cinematic medium close-up, vertical 9:16, stable camera, warm late-afternoon light. Malu sees a packed suitcase just off-camera to her right. She inhales, looks toward the unseen person, then says **exactly in Brazilian Portuguese**: “Você fez as malas? Ia embora sem me contar?” Her tone is hurt and disbelieving, natural adult female voice. Lip and jaw movement must follow each spoken word. She raises one eyebrow, makes a small shoulder withdrawal, then pauses and waits for an answer. Keep eyes and facial details sharp throughout movement; natural hair and fabric motion. No other speaker, cuts, subtitles, on-screen text, music, altered face or outfit, extra limbs, missing fingers, or strong motion blur.

## Gate de revisão

1. Conferir olhos, pupilas, rosto e textura **durante** a fala e o gesto, não só no primeiro quadro. Reprovar se houver borrão semelhante ao OmniAvatar.
2. Conferir se Malu mantém rosto, cabelo, brincos, roupa, corpo e cenário; sem membros alterados.
3. Ouvir toda a frase em português brasileiro e verificar correspondência entre voz e boca, sem fala inventada.
4. Conferir duração, resolução, taxa real de quadros, decodificação e presença de áudio no arquivo baixado. Qualidade visual e sincronização exigem revisão humana; números de fps não bastam.
5. Se falhar, registrar o motivo e **não repetir automaticamente**, nem mudar para Quality ou para a segunda conta sem nova avaliação.

## Limite de integração

O Flow utiliza os créditos da assinatura na interface. O Studio poderá importar o MP4 aprovado para montagem, revisão e postagem; a assinatura Google AI Pro não concede uso gratuito da API de vídeo. Nenhuma integração automática com o Flow foi validada.

Fontes: [créditos do Flow](https://support.google.com/flow/answer/16526234?co=GENIE.Platform%3DDesktop&hl=en-PT), [modos do Veo no Flow](https://support.google.com/flow/answer/16352836?hl=en), [Characters](https://support.google.com/flow/answer/16935308?co=GENIE.Platform%3DDesktop&hl=en), [preço da API Veo](https://ai.google.dev/gemini-api/docs/pricing).
