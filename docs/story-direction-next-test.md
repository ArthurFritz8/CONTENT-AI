# Próxima prévia — atuação corporal e cobertura da cena

Status: plano editorial para revisão, não executado. Nenhuma nova imagem, TTS, GPU, episódio ou publicação. Base: trecho da prévia `guided-acting-conversation` aceito pelo operador; revisão integral não confirmada.

## O que muda

Manter Malu e Laranjito, roupas, texturas, vozes e a mesma rua ao pôr do sol. O humor vem da contradição entre a desculpa de Laranjito e a reação de Malu. Dar propósito a cada plano; não trocar o cenário apenas para acrescentar movimento. Um novo local só entra quando a história deslocar os personagens.

Os quatro diálogos abaixo já têm WAV e marcação de palavras em `output/audio-driven-conversation/`. Reutilizar a voz evita novo TTS; tomadas de fala devem continuar condicionadas pelo áudio. Movimentos maiores exigem geração e avaliação novas, não são obtidos aumentando FPS ou cortando outro trecho da mesma imagem.

## Cobertura proposta — aproximadamente 22,4 s

| Ordem | Duração | Plano e função | Atuação e áudio | Material necessário |
|---|---:|---|---|---|
| 1 | 1,50 s | Plano conjunto: situar os dois na rua e mostrar a distância entre eles. | Ambos em silêncio; Laranjito conserva o biscoito escondido. Câmera fixa. | Referência conjunta própria, coerente com os rostos/roupas aprovados; ainda precisa ser escolhida e conferida. |
| 2 | 4,75 s | Plano médio de Laranjito: tornar a desculpa visível no corpo. | “Eu só provei um pedacinho. Precisava garantir que estava bom.” Uma transferência curta de peso para trás, com resposta de ombros/tronco e recuperação; mãos preservadas. | WAV existente da fala 06. A tomada corporal nova é a primeira prioridade de teste; referência atual e guia próprio compatível precisam de inspeção. |
| 3 | 1,50 s | Reação silenciosa de Malu: deixar a mentira repercutir. | Ela endurece os ombros, observa a mão escondida e volta o olhar para ele. Um único arco de reação, sem gesticular continuamente. | Não extrair de uma fala como se fosse silêncio. Tomada silenciosa nova ou arte própria assumidamente estática; suporte de animação sem fala ainda não foi validado no worker atual. |
| 4 | 3,75 s | Plano médio de Malu: cobrança com gesto pontual. | “Você protegeu o biscoito com a boca? Era um presente!” | Tomada 07 guiada existente, reaproveitável por hash. Não declarar um gesto novo. |
| 5 | 1,00 s | Detalhe do biscoito quebrado: a prova da desculpa. | Sem fala nem mãos no quadro; breve respiro cômico. | Arte própria ainda não criada; manter o formato do biscoito da referência. Pode ser imagem estática com movimento de câmera, identificado como tal, sem usar GPU de vídeo. |
| 6 | 4,50 s | Contraplano de Laranjito: falsa confiança. | “Já resolvi! Levei um pacote novo para a dona Cida.” | Tomada 08 existente. Um novo ângulo exige nova referência/render; recorte digital não será descrito como nova câmera. |
| 7 | 4,20 s | Aproximação de Malu: descobrir a contradição. | “Você levou? Em que hora? Eu passei lá e estava fechado.” | Tomada 09 existente. Recorte leve opcional na edição, sem inventar detalhes, respeitando resolução e área da legenda. |
| 8 | 1,20 s | Reação final de Laranjito: gancho para a próxima desculpa. | Silêncio, hesitação corporal breve. Não repetir uma boca em movimento depois da fala. | Precisa de tomada silenciosa própria validada ou encerrar no fim da fala 09; não congelar/loopar automaticamente. |

Durações das quatro falas vêm dos cortes atuais: 4,75 + 3,75 + 4,50 + 4,20 = 17,20 s. Com as quatro inserções propostas, 22,40 s. As novas pausas são uma hipótese editorial; avaliar ritmo antes de mantê-las. Esta prévia curta não atende ao contrato de episódio >=60 s e não deve ser inflada com repetições.

## Primeiro experimento que vale os créditos

Gerar apenas a nova tomada corporal de Laranjito (ordem 2), com o mesmo WAV, identidade, roupa, seed, modelo, 40 passos e duração da fala 06. A referência aprovada já mostra ombros e tronco; confirmar que o recorte permite a ação proposta. Se não permitir, preparar uma referência mais aberta, revisar identidade e proveniência e aprovar seu hash no contrato experimental antes da inferência. O contrato atual permite somente duas referências por hash; uma referência nova não está liberada automaticamente.

Desenhar guia próprio de ombros/tronco/quadril alinhado à referência. Uma ação corporal com preparação, impulso e recuperação; evitar torção de punho, mãos cruzadas, pegar/entregar objetos ou caminhar durante a fala neste primeiro teste. Não reutilizar as coordenadas manuais de Malu em Laranjito. Só considerar movimento de câmera após confirmar que o corpo e as mãos mantêm coerência.

O worker existente aceita 80 quadros a 16 fps para essa fala, com até 297 quadros de entrega a 60 fps sem extrapolar o último quadro nativo. Não prometer mais poses independentes ou nova taxa nativa. Uma tomada nova de até 4,95 s, uma chamada, sem retry. Custo depende do tempo real; estimativas históricas e timeout excluem overhead/fatura. US$ 11,70 é o último saldo informado, não saldo verificado agora. Antes da execução, reservar orçamento da chamada e conferir os limites do provedor. O benchmark de duas tomadas repetidas permanece fora da prioridade.

## Continuidade e revisão

- Preservar direção dos olhares, posições esquerda/direita e luz ao alternar planos. Mudança de ângulo exige referência coerente, não morph durante uma fala.
- Manter a posição do biscoito e a ordem da revelação; detalhe da ordem 5 não pode mostrar um objeto incompatível ou um pacote novo antes de aparecer na história.
- Apenas o personagem em foco fala; reação silenciosa não precisa sincronização de boca, mas precisa permanecer realmente silenciosa. Voz fora de quadro só quando editorialmente planejada.
- Inspecionar quadros nativos e interpolados de mãos, tronco, roupa, oclusões e retorno da ação. QA de transporte não certifica movimento corporal.
- Revisar todos os segundos, inclusive cortes e pausas, antes de aceitar a prévia completa. Aprovação do trecho anterior não cobre as tomadas futuras.

## Integração futura

Isto já existe em `packages/core/src/stories/schema.ts`: contexto, elenco, local, emoção e objeto. Ainda não há contrato de enquadramento/ação corporal/cobertura. `buildStoryScript` em `packages/core/src/stories/script.ts` transforma cada cena em 12 s fixos; não usar esses valores como duração medida de fala ou tomada S2V.

Separar cena dramática de tomada audiovisual: uma cena pode conter fala, reação e detalhe, com cobertura e duração próprias. A implementação deve reutilizar o contexto e os tipos do core, acrescentar direção opcional apenas no modo história e planejar cobertura real antes de renderizar. Gadgets e vídeos independentes continuam com seus fluxos atuais. Este documento não altera schema, prompts de produção ou renderer e não declara essas capacidades implementadas.
