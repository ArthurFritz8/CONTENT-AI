# Auray — primeira conexão e avaliação real

Data: 14/10/2026. Resultado técnico: uma geração concluída; avaliação artística e produção pendentes.

## Conta e custo

A leitura autenticada confirmou plano Free, franquia mensal de 50 créditos, saldo inicial de 50 exclusivamente do plano e nenhum crédito comprado/concedido. A chave padrão tem teto de 50; ADR-075 permite esse teto com orçamento local de cinco por avaliação. Não houve alteração de plano, pagamento, recarga, configuração remota ou uso de Modal.

Uma solicitação com o plano `docs/stories/auray-action-audition.json` foi aceita e concluída: cinco créditos cobrados e liquidados, saldo final de 45. Esperou a fila do serviço; não houve reenvio da geração. A confirmação e os assets foram consultados pela API oficial, com a chave somente em configuração ignorada. Não registrar chave, links assinados ou identificadores da conta neste relatório versionado.

## Arquivo obtido

- Modelo solicitado: `auray-ai/minimax-h3/text-to-video`, primeiro quadro próprio com SHA-256 fixo, duração solicitada de cinco segundos e seed 7007.
- Entrega: MP4, vídeo de 5,166667 s, 768 × 1344, 24 FPS codificados e 124 quadros decodificados; 1.946.397 bytes.
- SHA-256 do MP4 original: `0eed81fc5166c0e69ec948e436e8bdda9b49e4d93f34586d5e6bce86008e4f87`.
- O contêiner contém AAC estéreo 32 kHz de cerca de 5,26 s e áudio não silencioso. Não foi fornecido nosso WAV, nem foi validada fala por escuta ou sincronismo com as vozes aprovadas.
- O primeiro download foi bloqueado pela validação de destino: o serviço entregou um endpoint R2 regional dos EUA. Corrigida a lista restrita de destinos segundo a documentação Cloudflare; retomado o mesmo job. Não houve segunda geração. Cada pedido de links de assets conta tráfego diário do serviço, não créditos de geração.

Os arquivos ficam em `output/auray-video-jobs/a4e75bff8795061808b306e4b0e22f0dbc8088beb7e175fd76cd4d7316ece47c/`, ignorados pelo Git: `original.mp4`, `qa.json`, `state.json`, folha de 20 quadros e amostra em 3,5 s. A prévia `teste-visual-sem-audio.mp4` remove somente o áudio por cópia do fluxo de vídeo. Comparação dos hashes de todos os 124 quadros decodificados comprovou pixels idênticos ao original; não houve reencodificação, interpolação ou aumento de resolução/FPS.

## Revisão visual e limites

Na folha de quadros e na amostra ampliada, o cenário, roupa e identidade geral dos dois personagens permanecem reconhecíveis; a mulher cruza os braços e muda a expressão, e o homem reage. Isso não comprova anatomia perfeita em todos os quadros ou movimento equivalente ao master anterior de 60 FPS. A mulher abre a boca em parte da atuação, apesar do pedido de boca fechada; por isso não classificar como tomada silenciosa aprovada nem diálogo sincronizado.

O vídeo é uma prévia para revisão do usuário, não uma segunda fonte de capítulos liberada. FPS nativo de movimento não foi atestado. O serviço não expõe revisão imutável dos pesos; a resposta de job trouxe `engine: null`. Não atribuir ao hash do contrato a garantia de pesos ou de continuidade artística. Não somar os 45 créditos a dólares Modal nem prometer capítulos completos a partir desse teste.

Antes de integrar: revisão audiovisual pelo usuário, resolver comportamento de boca/áudio, verificar licença/atribuição MiniMax, comprovar continuidade por perfil, conectar carteira/roteamento da fonte e preservar as vozes aprovadas. Flags e carteiras de produção permanecem inalteradas.

Fontes técnicas: [contrato oficial Auray](https://api.auray.ai/v1/models/auray-ai/minimax-h3/text-to-video/openapi.json), [créditos e liquidação](https://auray.ai/docs/credits), [endpoints regionais R2](https://developers.cloudflare.com/r2/api/tokens/), [anúncio da jurisdição US](https://developers.cloudflare.com/changelog/post/2026-08-17-r2-us-jurisdiction/).
