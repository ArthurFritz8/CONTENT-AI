# Novela de frutas — referência visual aprovada v1

Data: 05/10/2026. Aprovação do operador: "se for baseada nessa imagem que você gerou está ótima". Aprovação da aparência; continuidade, animação e sincronização labial ainda não aprovadas nem demonstradas.

Referência local: `output/humanized-fruit-concept/malu-laranjito-concept-v1.png`.

SHA-256: `498303a7c798119cf1763c84c656c9044ac8bb2fd97c242e5b49afccbde02ef6`.

É imagem gerada pela ferramenta integrada da sessão, não cena/rig Blender. Não é asset de produção registrado. O prompt original e a proveniência estão na pasta do conceito; ela é ignorada pelo Git.

## Identidade dos personagens

**Malu:** mulher adulta humanizada com face de maçã vermelha e textura de casca integrada ao rosto. Olhos castanhos, sobrancelhas expressivas, cabelo castanho ondulado até os ombros. Vestido midi creme com flores vermelhas e folhas verdes, cinto fino, sandálias marrons de salto, brincos de argola e acessórios dourados discretos. Corpo, braços, mãos e pés de proporções humanas; postura assertiva e gesto de questionamento. Preservar volume do rosto, linha do cabelo e padrão do vestido nas tomadas seguintes.

**Laranjito:** homem adulto humanizado com rosto de laranja e microtextura da casca, olhos castanhos, cabelo curto escuro ondulado e pequeno bigode. Camisa clara de linho com mangas dobradas, jeans azul com costuras e bolsos, tênis marrons. Corpo e mãos de proporções humanas; expressão preocupada e defensiva, biscoito parcialmente comido escondido atrás do corpo. Preservar bigode, silhueta facial, figurino e posição narrativa do objeto.

## Mundo e iluminação

Rua de bairro brasileiro, telhados cerâmicos, muros de reboco com desgaste sutil, portão de ferro, plantas floridas, cadeira branca de plástico e pavimento irregular. Fim de tarde com luz quente, sombras coerentes e profundidade. Materiais reconhecíveis: tecido, jeans, couro, cabelo e superfícies do bairro. O estilo é realismo estilizado cinematográfico, com atuação de personagens adultos.

## Critérios para aceitar a próxima prova

- A tomada inicial deve partir da imagem aprovada, sem redesenho silencioso de rosto, cabelo ou figurino.
- Em três tomadas, conferir identidade, proporções, padrão das flores, camisa, bigode, acessórios, horário e cenário.
- No movimento, conferir olhos, mãos/dedos, boca, pés, tecido, estabilidade do fundo e continuidade do biscoito.
- Movimento precisa ser dos personagens e expressões; zoompan sozinho não valida atuação.
- Animação facial espontânea não comprova sincronização fonética com TTS. Sincronização exige teste separado com áudio e personagem falando.
- Só integrar ao Studio após amostra visual e movimento aprováveis, QA técnico e consumo medido.
- Gadgets e vídeos convencionais permanecem independentes deste modo opcional.

## Rota de animação a experimentar

Wan2.2-TI2V-5B é um candidato para image-to-video condicionado ao frame aprovado. Fontes oficiais mostram licença Apache-2.0 e execução image-to-video com offload em GPU de pelo menos 24 GB. Isso justifica investigar a Modal; não comprova ainda memória, tempo, custo ou qualidade neste projeto. A prova Blender/A10 do ADR-048 não testou esse modelo.

O TI2V-5B não deve ser anunciado como modelo de sincronização labial. O modelo oficial S2V-14B é outro checkpoint e sua receita de execução individual informa pelo menos 80 GB de VRAM. Não extrapolar a exigência de um modelo para outro nem anunciar fala sincronizada após um teste apenas de movimento.

Primeira execução futura: uma tomada curta, um único worker, sem publicação, sem retries indiscriminados e com limite de consumo coberto por crédito verificado. Downloads e carga do modelo também entram na medição. Não remover limite de gastos nem usar endpoint pago como fallback. A geração automatizada de imagens nesse padrão para outros clientes continua sendo uma dependência a validar.

Fontes: [modelo e licença](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B), [receitas TI2V e S2V](https://github.com/Wan-Video/Wan2.2), [pipelines oficiais Diffusers](https://huggingface.co/docs/diffusers/api/pipelines/wan).
