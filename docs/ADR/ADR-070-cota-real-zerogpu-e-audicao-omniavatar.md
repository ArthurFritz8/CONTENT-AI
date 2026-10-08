# ADR-070 — Cota real do ZeroGPU e audição OmniAvatar

Data: 2026-10-08. Status: teste concluído; tomada rejeitada para produção. Atualiza a premissa de cota do ADR-069.

## Cota e reserva

A captura de tela da conta `ContentFritz` enviada pelo operador mostrava **0,4/5 min** usados no ZeroGPU: havia aproximadamente **4,6 min** restantes. As duas tentativas registradas em `output/free-video-jobs/quota.json` eram um limite preventivo **nosso**, não a medição da Hugging Face. Foi incorreto inferir que a franquia externa havia terminado.

O cliente oficial do Gradio consultou `/update_generate_button` no Space [alexnasa/OmniAvatar](https://huggingface.co/spaces/alexnasa/OmniAvatar), revisão `e6a7899449e8a16003b0b01046ea6d29dbbd00c5`, com PNG e WAV próprios da Malu: **85 s de GPU xlarge** para 4 passos e áudio de 3,25 s. A [tarifa de quota xlarge é 2×](https://huggingface.co/docs/hub/spaces-zerogpu), logo a reserva estimada foi **170 s** da franquia de aproximadamente **276 s** restantes na captura. Essa é uma estimativa; o débito real após a chamada só deve ser lido no painel da conta.

## Resultado

Uma única chamada de `/infer_scene` foi aceita com ID persistido antes da espera. Gerou `output/free-video-jobs/omniavatar-malu-2026-10-08/clip.mp4`: 400×720, 24 fps codificados, 3,292 s, vídeo e áudio decodificáveis. A inspeção visual do contato mostra a identidade inicial preservada, mas há **embaçamento significativo dos olhos e do rosto durante o movimento**. A faixa de áudio entregue pelo Space não passou no teste de alinhamento com a voz de referência. Uma versão local que remuxa o WAV original, sem chamada de GPU, passou no teste de transporte (lag 0,000 s; correlação PCM 0,999916), mas isso **não comprova sincronização labial** e não corrige o desfoque visual.

O estado editorial é **rejeitado**. Não habilitar OmniAvatar como rota de produção, não usar a prévia em episódio e não publicar. Não repetir a chamada com o mesmo saldo. Mais passos consumiriam mais quota e poderiam melhorar detalhe, mas a qualidade não foi demonstrada e não há saldo confirmado para nova reserva com margem.

## Consequência

O gate de duas tentativas do executor permanece como proteção das rotas existentes; ele não deve ser apresentado como cota da Hugging Face. A conta tinha saldo segundo a captura e este teste consumiu uma **reserva estimada**, não um custo medido. A próxima decisão técnica requer leitura atual da quota externa e uma rota que preserve nitidez em movimento; interpolação ou upscale isolados não recuperam os olhos perdidos nos quadros gerados.
