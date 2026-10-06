# ADR-049 — Teste de movimento a partir da imagem aprovada

Data: 06/10/2026. Status: amostra gerada e QA técnico concluído; sem habilitação de produção.

## O — Objetivo

Gerar uma amostra de movimento usando a imagem humanizada aprovada como referência de entrada e verificar preservação de personagens, figurino e ambiente. Responder ao pedido explícito do operador de testar esse visual em vídeo.

## C — Contexto

O operador aprovou o conceito descrito em [referência visual v1](../stories/novela-frutas-visual-v1.md). A prova Blender do ADR-048 reutiliza outros modelos e não produz esse visual. No início do experimento, o renderer tratava visuais como imagens; a aprovação de um conceito não habilita vídeo generativo automaticamente. O ADR-050 acrescenta suporte à montagem de clipes no código local.

O modelo oficial Wan2.2-TI2V-5B tem suporte a image-to-video e licença Apache-2.0. O checkpoint convertido para Diffusers é público e não exige credencial Hugging Face. O exemplo de carregamento automático da ficha usa uma pipeline de texto; foi conferido o código versionado do Diffusers para usar `WanImageToVideoPipeline`, com `expand_timesteps` do checkpoint e sem encoder CLIP obrigatório.

## S — Solução

Experimento isolado `scripts/modal-wan-probe.py`, com uma chamada explícita `--run`. Entrada restrita pelo SHA-256 da imagem aprovada. Modelo `Wan-AI/Wan2.2-TI2V-5B-Diffusers`, revisão `b8fff7315c768468a5333511427288870b2e9635`; Diffusers 0.36.0 e dependências fixadas. A primeira preparação falhou antes de usar GPU: Diffusers 0.40.0 exige huggingface-hub >=1.23, incompatível com o pin 0.36.0. O código da versão 0.36.0 foi conferido e preserva o suporte necessário (`expand_timesteps` e encoder de imagem opcional).

Uma GPU L40S, no máximo um contêiner, limite de 4 cores e 24 GiB de RAM, prazo de processamento de 900 s, sem retry automático, sem volumes persistentes. Os pesos são preparados na imagem do contêiner; o worker roda sem rede e com acesso à API Modal restrito. Resultados em blocos inline de 128 KiB, com sequência, tamanho e SHA-256 verificados, reaproveitando a estratégia validada pelo ADR-048.

Tomada vertical de 704 × 1248, 49 quadros / 24 fps, 30 etapas de geração, seed 42. A cena pede gestos discretos, olhar e expressão, câmera fixa e continuidade de rosto, cabelo, roupas e biscoito. Não simular fala sem um modelo/etapa que use o áudio como condicionamento. A amostra é silenciosa.

A segunda tentativa concluiu as 30 etapas, mas o helper de exportação do Diffusers tentou usar OpenCV ausente. A exportação foi corrigida para enviar RGB diretamente ao FFmpeg já instalado, preservando a imagem de contêiner com pesos em cache. Essa falha consumiu processamento; não contar a tentativa como gratuita adicional ou capacidade produzida.

A terceira tentativa também concluiu a inferência, mas a validação de exportação detectou arrays NumPy: a pipeline 0.36.0 tem `output_type='np'` como padrão. A geração agora solicita `output_type='pil'` explicitamente. O exportador foi isolado e testado localmente com três quadros coloridos, metadados e decodificação completa; o worker faz uma exportação preliminar antes de carregar o modelo. As duas tentativas com inferência não geraram arquivo entregável e entram no consumo do experimento.

O teste consome compute da franquia existente. A conta foi comprovada com limite de utilização de US$ 30 e de gastos de US$ 0; não alterar esses controles. Tempo de inicialização, preparação dos pesos e processamento não são uma consulta à fatura. Crédito extra solicitado continua sem aprovação conhecida.

## P — Prevenção e validação

- Confirmar duração, resolução, número de quadros, integridade e decodificação completa.
- Inspecionar quadros inicial, intermediários e final, observando rosto, mãos, figurino, cenário, biscoito e mudanças de identidade.
- Conferir movimento temporal; quadros distintos não bastam para aprovar atuação ou ausência de deformações.
- Não afirmar sincronização labial, qualidade final, capacidade mensal ou consistência entre episódios com base neste teste.
- Não transformar aprovação visual em habilitação automática no Studio. Faltam orquestração durável, orçamento por workspace e revisão do episódio completo. O suporte a clipes no renderer foi implementado separadamente no ADR-050.
- Nenhuma criação/consumo de pauta, episódio, revisão enviada ou publicação nesta execução.
- A produção automatizada dos próprios quadros de referência continua uma dependência; a ferramenta de imagens usada no chat não é uma API já conectada ao produto.

## Resultado medido

A execução `ap-5IGr3D5iD6QcnRCbVuVwl0` gerou `output/humanized-motion-probe/malu-laranjito-motion-v1.mp4`: 704 × 1248, H.264/yuv420p, 49 quadros a 24 fps, 2,042 s, sem áudio; 2.146.278 bytes. SHA-256: `7358e40fceaeaf7256fef19e77749a6111555190935c4bdb39b92d6c2ec56e54`.

NVIDIA L40S, pico de memória alocada CUDA 24,890 GiB; carga do modelo 27,088 s; inferência com decodificação VAE 115,482 s; worker 144,287 s; cliente 174,254 s. A medição desta execução começou após a exportação preliminar; a versão seguinte do script inclui essa etapa no cronômetro. O consumo contabilizado de todas as tentativas não foi consultado na fatura. Não extrapolar essa medição para 24 GB sem offload ou para um capítulo completo.

Integridade SHA-256, metadados e decodificação completa passaram no worker e localmente. Os 49 quadros decodificados são distintos. Foram inspecionados cinco quadros completos (0, 12, 24, 36, 48), um quadro intermediário em resolução original e uma sequência de 17 recortes temporais (a cada três quadros). Elenco, cabelo, figurino, iluminação e cenário ficaram predominantemente consistentes; há mudança de olhar, piscada, sobrancelhas e pose. A inspeção não mostrou uma troca evidente de identidade, mas uma tomada de dois segundos não valida continuidade entre planos nem atuação longa. Não anunciar perfeição dos dedos ou ausência de artefatos sutis.

É uma tomada de reação, sem diálogo: movimentos espontâneos da boca não são sincronização com TTS. A validação local não usa o QA editorial de episódio como se um clipe de dois segundos cumprisse o mínimo de 60 s. Não houve episódio, envio ao Telegram, publicação ou alteração de fila. O app encerrou ao fim da execução; a listagem autenticada da Modal confirmou `state=stopped`, `tasks=0`.

Fontes: [modelo convertido e licença](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B-Diffusers), [pipeline I2V versionada](https://github.com/huggingface/diffusers/blob/v0.36.0/src/diffusers/pipelines/wan/pipeline_wan_i2v.py), [limites da Modal](https://modal.com/docs/guide/budgets).

Atualização: depois de o operador considerar a amostra aceitável, o ADR-051 amplia o worker para tomadas parametrizadas com uma whitelist fechada das três referências do piloto. A execução medida acima permanece a prova histórica L40S/49 quadros. A versão atual pode reutilizar o modelo em memória durante a sessão e tem idle de 30 s; o app ainda encerra ao terminar. Nenhuma habilitação no Studio decorre dessa ampliação.
