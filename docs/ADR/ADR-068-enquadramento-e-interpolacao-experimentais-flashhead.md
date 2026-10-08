# ADR-068 — Enquadramento e interpolação experimentais para FlashHead

Data: 2026-10-08. Status: prévia comparativa implementada; reprovada como correção definitiva dos olhos. Complementa ADR-067.

## O — Objetivo

Investigar o relato do operador de olhos borrados e movimento truncado na prévia gratuita, sem gastar nova quota de geração e sem apresentar 60 FPS codificados como 60 poses nativas.

## C — Contexto

Isto já existe em `scripts/assemble-free-story-preview.mts`: montagem auditada de três cortes, legendas e voz original, com saída de revisão isolada. Isto já existe em `scripts/modal-speech-motion-probe.py`: RIFE para vídeos Modal, dependente daquele worker; não recriar esse serviço nem consumir seu saldo nesta investigação. O adaptador FlashHead permanece `preview` pelo ADR-067.

O bruto FlashHead tem 512×512 a 25 FPS. O corte vertical anterior preenchia 480×832, ampliando a altura por aproximadamente 1,625×, e o filtro `fps=60` repetia quadros. O frame bruto em 1,2 s **já apresenta olhos borrados**: o defeito não surgiu na montagem nem na recompressão do áudio. Um teste de [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) sobre esse frame aprimorou bordas, mas não recuperou pupilas/íris; aplicá-lo a todos os quadros poderia enfatizar o erro e não foi integrado. [GFPGAN](https://github.com/TencentARC/GFPGAN) informa alteração possível de identidade; não foi presumido como reparo automático para a personagem.

## S — Solução

1. Adicionar `--flashhead-enhanced` **somente** ao montador de prévias. Preservar as saídas originais e criar pasta distinta.
2. Estimar quadros intermediários com o filtro local [FFmpeg `minterpolate`](https://ffmpeg.org/ffmpeg-filters.html), separadamente em cada tomada. Clonar no máximo a pequena cauda necessária para manter duração e contagem verificadas; não interpolar entre cortes.
3. Na fala quadrada, limitar a ampliação do primeiro plano a 672×672, recortar lateralmente a 480×672 e preencher as faixas superior/inferior com fundo desfocado. Aplicar nitidez discreta à imagem principal. A apresentação reduz a ampliação dos olhos para ~1,31×, mas **não os restaura**.
4. Reutilizar o WAV, as legendas, os hashes de entrada, o auditor de áudio e a revisão humana. Registrar na QA que 60 FPS são estimados, não geração de novos gestos. Não mudar renderer, Studio, banco, publicação ou o master aprovado.

## P — Prova

- A saída `output/free-story-sequence-flashhead-enhanced/a-mala-acao-fala-reacao-flashhead-enhanced.mp4` foi gerada localmente sem nova chamada à GPU remota: 6,817 s, 480×832, 409 quadros codificados/60 FPS, três cortes, decode completo, voz com atraso medido zero e correlação PCM 0,999904. O contact sheet foi inspecionado em todos os trechos; mãos/cabeça e continuidade artística ainda exigem reprodução pelo operador.
- Comparação curta lado a lado: `output/provider-research-deep-2026-10-08/flashhead-audition-2/before-after-fps-frame.mp4` (esquerda: ampliação/duplicação anterior; direita: enquadramento menor/interpolação). 3,25 s, 195 quadros codificados/60 FPS, decode completo, atraso de voz zero, correlação PCM 0,999866.
- O olho borrado continua visível nos frames de origem e da variante. Logo, a prévia **não passa** como solução de qualidade final; a solução de fundo precisa de geração com olhos estáveis e resolução/atuação nativas melhores. Interpolação pode deformar olhos, boca e dedos em quadros intermediários, portanto o flag `production_enabled` permanece falso.
- O processamento usa FFmpeg local de código aberto, sem conta adicional; num produto multiusuário, a CPU/GPU do servidor e sua quota ainda precisariam de capacidade medida. Não prometer custo operacional zero nem usar o hardware do navegador do cliente como requisito.
