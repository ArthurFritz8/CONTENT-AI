# Fontes gratuitas - verificacao em 20/10/2026

Pesquisa de documentacao publica, sem cadastro, compra, contato com suporte,
geracao remota ou liberacao de fontes. Gratuidade de site nao equivale a API.

## Resultado pratico

Nao foi comprovada nesta pesquisa uma segunda API pronta para capitulos nativos
com voz e continuidade no mesmo padrao Puter. O caminho imediato implementado e
HQ local: imagens/quadros, audio escolhido, legendas e camera por FFmpeg. Nao e
animacao corporal ou lipsync e nao substitui automaticamente o 3D.

## Fontes

| Fonte | Evidencia publica | Decisao |
| --- | --- | --- |
| Cloudflare Workers AI | Free: 10.000 neurons/dia, renova 00h UTC; acima disso Free falha, Paid cobra. API REST para imagens. | Candidata para quadros e referencias, nao video nativo. Exigir conta Free, quota e modelo conferidos. |
| Cloudflare FLUX.1 schnell | Texto para imagem; documentacao mostra prompt/steps, nao condicionamento por referencia. | Nao prometer identidade de personagem. |
| Cloudflare FLUX.2 klein 4B | Geracao e edicao de imagem; preco por tiles de entrada/saida. | Candidata a avaliar com referencia, sem homologacao ou chamada nesta entrega. |
| Pollinations Classic | Imagem anonima gratuita, uma por vez e pelo menos 45s entre pedidos; maximo de area 768x768, logo e cache por URL publico. Texto tambem tem limite por IP. | Alternativa de imagens nao confidenciais; nao enviar biblia privada, referencias ou segredos em URLs. Nao e segunda fonte de video. |
| Pollinations enter | Oferece modelos de imagem/audio/video; Pollen de quests e compra. Anuncia mudanca de chaves publicaveis em 01/11. | Nao comprovou franquia recorrente de video API; nao integrar como carteira gratuita. |
| A2E | Free 30 creditos/dia no site. Tabela API: Free=No, Pro/Ultra=Yes. | Vetado para rodizio API zero-budget. |
| Vidnoz | Free 8 creditos/dia, 720p e marca; tabela de site nao demonstra API gratuita. | Apenas uso manual a avaliar, sem promessa de integracao. |
| EaseMate | Basic anuncia 5 imagens + 2 videos/dia; tambem creditos de cadastro separados. | API gratuita recorrente nao comprovada. |
| Hugging Face Inference Providers | Free sem creditos mensais; uso requer compra ou plano. | Nao e carteira gratuita recorrente. |
| Hugging Face ZeroGPU | Free 5 minutos/dia por conta, reset 24h apos primeiro uso; fila e quota compartilhadas, xlarge custa 2x. | Distinto de Inference Providers. Nao multiplicar por Space nem retentar LTX/CNAPS para contornar resultado incerto. |

## Fontes oficiais consultadas

- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
- https://developers.cloudflare.com/workers-ai/models/flux-2-klein-4b/
- https://github.com/pollinations/pollinations/blob/master/APIDOCS.md
- https://enter.pollinations.ai/
- https://a2e.ai/pricing
- https://www.vidnoz.com/pricing.html
- https://www.easemate.ai/pricing
- https://huggingface.co/docs/api-inference/pricing
- https://huggingface.co/docs/hub/spaces-zerogpu

## Restricoes

Precos e limites mudam. Verificar licenca e termos do modelo e da hospedagem
antes de produto para terceiros. Quantidade de imagens ou segundos garantidos
nao pode ser inferida apenas dos neurons ou do nome Free. Nenhum fornecedor foi
ativado, nenhuma imagem privada foi enviada e nenhum credito Puter foi usado.