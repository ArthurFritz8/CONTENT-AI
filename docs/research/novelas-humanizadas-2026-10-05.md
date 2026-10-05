# Pesquisa e direção visual — novelas de frutas humanizadas

Data: 2026-10-05. Escopo: diagnóstico das referências do operador, verificação técnica e plano de desenvolvimento visual. **Não é uma entrega de personagens novos nem habilita animação no Studio.**

## 1. Veredito

A amostra 3D comprovou render, montagem, duas vozes e movimento básico. Ela ainda tem uma linguagem de mascote infantil. As referências solicitam personagens com anatomia humana estilizada, identidade de fruta, figurino reconhecível, cabelo elaborado e ambientes com aparência física convincente. Esta diferença exige reconstruir personagens e cenário, além de melhorar iluminação.

Não é possível identificar qual IA, aplicativo ou processo produziu as referências apenas pelos quadros. Um vídeo com aparência 3D pode ter sido gerado a partir de imagens sem possuir qualquer modelo 3D editável. O alvo é o resultado visual e dramático, sem presumir o processo do criador.

Decisão para o próximo experimento: desenvolver **frutas humanizadas em um bairro brasileiro**, com personagens adultos e ambiente cotidiano. A referência de figuras facetadas e apartamento de luxo constitui outra direção artística; misturar cristal, casca de fruta e acabamento de brinquedo no mesmo elenco enfraqueceria a identidade visual. A referência serve para estudar acabamento, sem reproduzir seus personagens.

## 2. Diagnóstico das imagens

| Camada | Amostra atual | O que se observa nas referências | Mudança necessária |
| --- | --- | --- | --- |
| Silhueta | Fruta ocupa quase todo o corpo; pernas finas e luvas | Tronco, ombros, quadril, articulações e mãos humanos, com cabeça estilizada | Corpo articulável e distribuição de peso; cabeça de fruta integrada ao pescoço |
| Rosto | Olhos e boca aplicados como peças independentes | Pálpebras, bochechas, nariz, lábios e sobrancelhas participam da expressão | Malha facial contínua, mandíbula, expressão assimétrica e olhar dirigido |
| Cabelo | Ausente | Penteados com raiz, mechas, volume e fios destacados | Penteado autoral com curvas/mechas e material compatível com o render |
| Figurino | Avental liso, poucos detalhes e pouca espessura | Jeans, estampas, lapelas, botões, joias e tecidos com caimento | Roupa modelada, costuras, bainhas, espessura e dobras nos pontos de tensão |
| Materiais | Acabamento uniforme em grande parte das peças | Cabelo, tecido, pele/fruta, metal e mobiliário respondem de forma diferente à luz | Textura em escala correta, rugosidade, relevo e reflexos específicos por material |
| Cenário | Feira com volumes simples e árvores arredondadas | Arquitetura, vegetação, calçada, móveis e objetos em diferentes profundidades | Local habitável, detalhes selecionados, escala consistente e contatos com o chão |
| Dramaturgia | Piada curta com gestos repetidos | Relações entre personagens sugeridas por olhar, postura e composição | Objetivo, conflito, reação e consequência em cada tomada |

Estas observações são análise visual, não medições de qualidade nem evidência de desempenho orgânico.

## 3. Auditoria de redundância e do que já existe

- **Isto já existe em `output/animation-3d/build_scene.py`:** cena 3D, casca procedural, câmera com profundidade de campo, iluminação, poses e edição em quatro tomadas. AgX já está configurado. Aumentar resolução ou ativar a mesma configuração novamente seria redundante.
- `make_character` constrói boca/olhos e membros com primitivas. A boca muda de escala conforme amplitude e intervalos de fala. O script não cria um rosto com deformações faciais, cabelo ou roupa com estrutura humana.
- **Isto já existe em `packages/core/src/stories/` e no ADR-045:** ficção opcional, elenco persistente, vozes, continuidade e arte própria. O desenvolvimento visual deve aproveitar esses conceitos sem mudar episódios já aprovados.
- **Isto já existe em `apps/local-renderer/src/render.ts`:** composição com imagens, múltiplas tomadas, áudio e legendas. `video_clip` aparece no tipo, mas o processamento visual continua montando imagens com `-loop 1`. Não há suporte efetivo a clipes de personagem nesse caminho.
- O vídeo anterior tem 19,041667 s, 457 quadros em 1080×1920 a 24 fps e render EEVEE de 844,94 s nesta máquina. É um experimento curto; não satisfaz nem altera o contrato de episódio de pelo menos 60 s.

## 4. Ferramentas e viabilidade verificadas

### Corpo, figurino e identidade

MPFB permite criar uma base humana no Blender, adicionar rig, olhos, cabelo, roupas e guardar presets. A documentação informa Blender 4.2 ou superior. Seus assets centrais são CC0; código e assets têm licenças distintas. É um ponto de partida para anatomia e reutilização, não um gerador pronto de atores-fruta com qualidade final. Pacotes externos precisam de verificação individual. **MPFB não foi instalado nem testado nesta pesquisa.** [Guia oficial](https://static.makehumancommunity.org/mpfb/docs/getting_started.html), [licença](https://static.makehumancommunity.org/about/license.html).

O projeto também publica pacotes de visemas e unidades faciais. São candidatos a estudo para o rig; não há prova de que funcionem sem adaptação após transformar uma cabeça humana em fruta. [Publicação oficial](https://static.makehumancommunity.org/news/2026-02-06-asset-packs-with-visemes-and-face-units.html).

### Cabelo e materiais

O Blender oferece escultura de curvas para pentear cabelo. O material **Principled Hair BSDF é exclusivo do Cycles** na versão 4.5; não deve ser tratado como simples melhoria plugável no EEVEE atual. Curvas/mechas também podem ter uma solução própria para EEVEE, que precisaria de avaliação separada. [Curvas](https://docs.blender.org/manual/en/4.5/sculpt_paint/curves_sculpting/introduction.html), [material de cabelo](https://docs.blender.org/manual/en/4.5/render/shader_nodes/shader/hair_principled.html).

Para roupas, o Principled BSDF inclui rugosidade, normais e sheen, que ajuda na aparência de fibras. Isso complementa, mas não cria, corte, costuras e caimento. O figurino precisa funcionar primeiro em silhueta e pose, antes dos microdetalhes. [Material oficial](https://docs.blender.org/manual/en/4.5/render/shader_nodes/shader/principled.html).

### Biblioteca de cenário

Poly Haven disponibiliza assets CC0. A API oficial consultada em 05/10/2026 permite uso comercial gratuito, com identificação da aplicação e crédito visível quando o produto usa o serviço. O anúncio atual é de 18/07/2026; instruções antigas sobre restrição comercial da API não devem prevalecer sobre esses termos atuais. Não é necessário usar um add-on pago para consultar o catálogo. [API](https://polyhaven.com/our-api), [termos](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md).

Foram realizadas chamadas reais ao catálogo e a quatro manifestos de arquivos, todas com HTTP 200. Não foram baixados nem incorporados modelos/texturas ao piloto nesta etapa.

| Asset confirmado no catálogo | Aplicação proposta | Limite da verificação |
| --- | --- | --- |
| [Denim Fabric](https://polyhaven.com/a/denim_fabric) | Calça/saia jeans, em escala compatível com a peça | Manifesto contém mapas em 2K; UV e resultado visual ainda não testados |
| [Blue Plaster Weathered](https://polyhaven.com/a/blue_plaster_weathered) | Fachada com reboco e desgaste | Manifesto disponível; cor e repetição precisam de direção artística |
| [Courtyard](https://polyhaven.com/a/courtyard) | Fonte de luz ambiente para teste | HDRI não é cenário navegável nem prova de localização brasileira |
| [Wooden Chair 01](https://polyhaven.com/a/WoodenChair_01) | Mobiliário secundário | Manifesto inclui modelo e materiais; importação e escala ainda não verificadas |

ambientCG é outra fonte de materiais CC0. Não foi necessário adicionar uma segunda integração agora, pois a primeira já oferece recursos para o teste. [Licença oficial](https://docs.ambientcg.com/license/).

### Boca e atuação

Rhubarb produz cues temporais de boca e pode servir como entrada para poses faciais. Para português, sua opção `phonetic` é independente de idioma, mas o próprio projeto informa precisão inferior ao reconhecimento inglês. Não cria um rig, não gera atuação e não garante sincronização convincente em rostos de frutas. Deve ser comparado com a amostra atual e corrigido onde necessário. **Não foi executado nem integrado.** [Documentação oficial](https://github.com/DanielSWolf/rhubarb-lip-sync).

### Vídeo generativo: alternativa real, capacidade ainda não demonstrada

Wan2.2 oferece geração de vídeo a partir de texto/imagem. O comando oficial do modelo TI2V-5B documenta pelo menos 24 GB de VRAM. Isso descreve aquela implementação, não prova que toda alternativa quantizada seja impossível em outra placa; tampouco comprova uma execução gratuita e adequada nesta RX 6600. [Repositório oficial](https://github.com/Wan-Video/Wan2.2).

A família LTX documenta geração condicionada por imagens, interpolação de quadros de referência e outras modalidades. A documentação orienta descrever ação, personagem, ambiente, câmera e luz com precisão. Não foi validada sua execução nesta máquina nem uma API gratuita para o Studio. Requisitos de **treinamento** encontrados na pesquisa não foram usados como se fossem limites de **inferência**. [Repositório oficial](https://github.com/Lightricks/LTX-2).

Conclusão: manter vídeo generativo como opção de pesquisa. Trocar APIs pode aumentar alternativas, mas não assegura a mesma roupa, rosto, movimento e voz entre tomadas. Cada alternativa precisa comprovar direitos, acesso automatizado permitido, qualidade e capacidade gratuita efetiva; uma demonstração em site não representa cota disponível para o produto.

## 5. Teste de hardware realizado

Foi executado Blender 4.5.14 LTS portátil, em processo separado, com cena de fábrica, Cycles, GPU HIP, 64×64 e quatro amostras. O dispositivo CPU ficou desabilitado para render nesse teste. A Radeon RX 6600 foi detectada como HIP e o PNG foi concluído. A chamada de render levou aproximadamente **1,285 s**, incluindo preparação dessa cena mínima.

Este resultado comprova funcionamento básico do caminho Cycles/HIP neste ambiente. **Não mede cabelo, roupas, cena final ou velocidade em Full HD.** Nenhuma preferência do usuário foi salva. A série RX 6000 consta na documentação de GPU suportada. [Manual oficial](https://docs.blender.org/manual/pt/4.5/render/cycles/gpu_rendering.html).

Evidências locais, fora do Git: `output/animation-research/probe-cycles.py`, `cycles-device-probe.json`, `cycles-device-probe.png`, `asset-source-check.json` e manifestos Poly Haven.

## 6. Direção de arte proposta para o próximo estudo

Esta é uma proposta de aparência V2 para um experimento separado. Não modifica o elenco ou o histórico de nenhuma série em produção.

**Malu:** adulta, identidade de maçã preservada na forma e na cor da cabeça, rosto integrado, sobrancelhas expressivas e olhos com pálpebras. Cabelo castanho-acobreado em mechas onduladas até os ombros, blusa verde-petróleo de tecido fosco, jeans escuro e sandálias de couro. Postura firme, gestos econômicos. Conferir identidade também em luz neutra para evitar que a iluminação quente esconda as cores.

**Laranjito:** adulto, rosto de laranja com textura sutil, cabelo curto escuro, barba curta se a malha facial permitir bom acabamento. Camisa clara de linho com mangas dobradas, calça azul-marinho e sapatos marrons. Corpo e mãos humanos estilizados. A defesa aparece no olhar e na postura; não precisa balançar o corpo durante toda a fala.

**Cenário:** fachada lateral de uma pequena feira, calçada irregular, grade, vasos, cadeiras e uma porta com interior visível. Arquitetura autoral com referências brasileiras, sem afirmar retratar um lugar real. Compor primeiro plano, atores e fundo. Usar objetos que contam algo sobre quem trabalha ali; não preencher o enquadramento com detalhes aleatórios.

**Luz:** final de tarde como direção inicial, com rosto legível, sombra de contato e preenchimento mais frio. Exposição consistente entre planos. Testar versão neutra para verificar materiais e versão dramática para composição. Desfoque não deve esconder mãos, defeitos do rosto ou toda a ambientação.

**Câmera:** altura próxima à dos olhos, plano médio para gestos, close para reação e tomada de conjunto para estabelecer o espaço. Manter direção do olhar e lado de tela; alterar ângulo ou escala com intenção. Reenquadrar 16:9 separadamente, aproveitando a mesma cena 3D, em vez de prometer que um recorte resolve todos os formatos.

### Construção por camadas

1. Corpo, cabeça e mãos em material neutro: silhueta, articulação, peso e pose.
2. Face contínua: pálpebras envolvendo os olhos, boca com volume, bochechas e mandíbula; expressões independentes de fonemas.
3. Figurino com espessura, gola, costuras, dobras nos ombros/cotovelos/cintura e contato correto com cadeira/corpo. Usar deformação controlada no primeiro teste; simulação completa só onde trouxer ganho visível.
4. Cabelo com raiz, direção, grupos de mechas e variação moderada. Evitar fios demais antes de testar memória e ruído entre quadros.
5. Materiais diferenciados e mapas na escala da peça. Textura de alta resolução não substitui geometria ou caimento.
6. Cenário, luz e enquadramento. Avaliar ator no ambiente real do teste, não apenas em fundo vazio.

## 7. Experimento de atuação proposto

Primeiro, produzir três imagens finais: close de Malu, plano médio de Laranjito e plano de conjunto dos dois na feira. Depois, um trecho de aproximadamente 10–12 s, com duração final medida no áudio.

Situação autoral de ficção: Malu encontra uma carta e acredita que Laranjito negociou a feira sem avisá-la. Ela pergunta: “Você ia vender a feira sem me contar?”. Ele olha para a carta antes de responder: “Eu estava tentando salvar nossa casa.” A reação dela antecede a última pergunta: “Então por que só tem o seu nome?”. O conflito permanece aberto.

O papel, a mão que o segura, a troca de olhar e a pausa são parte da atuação. Uma fala não deve automaticamente acionar o mesmo gesto em todos os personagens. Preparar vozes por intenção e conferir ritmo; variar API de voz sem preservar identidade não resolve interpretação. Este trecho é teste de personagem, não episódio de produção nem novo roteiro aprovado.

## 8. Critérios para avançar

| Etapa | Evidência exigida | Problemas que exigem correção |
| --- | --- | --- |
| Aparência | Três imagens com os mesmos assets, roupa, penteado e proporções; leitura em tela de celular | Aparência ainda de mascote, olhos colados, cabelo de plástico, material uniforme |
| Anatomia e roupa | Mãos e rosto em close, corpo sentado/em pé, braços dobrados | Dedos defeituosos, rosto desconectado, roupa atravessando corpo, pés flutuando |
| Expressão | Neutro, suspeita, defesa e surpresa em ângulo frontal e 3/4 | Só sobrancelhas mexem; mandíbula e lábios deformam de forma incoerente |
| Movimento | Trecho curto visto em velocidade normal e quadro a quadro | Roupa/cabelo tremendo, pés deslizando, olhares sem alvo, gestos repetidos |
| Fala | Áudio final com poses labiais, escuta e reação do interlocutor | Boca apenas abre/fecha, boca ativa no silêncio, nomes ou pronúncia errados |
| Capacidade | Tempo, memória, tamanho dos assets, falhas e tentativas do teste real | Extrapolar a velocidade do cubo ou da amostra antiga para a nova cena |
| Produto | Só após as etapas anteriores: render com clipes, duração, formatos, áudio, retomada e revisão | Mostrar animação como disponível antes de existir um fluxo completo validado |

A inspeção artística é humana; contagem de quadros, resolução e codec não substituem esse julgamento. Os mesmos assets devem sobreviver a mudanças de ângulo e expressão. Uma imagem bonita isolada não comprova um personagem animável.

## 9. Automação, custos e limites

O investimento principal inicial é criar e validar o elenco, figurino e cenário reutilizáveis. Depois, a automação pode selecionar poses, atuação, câmeras e iluminação dentro de limites conhecidos. Um gerador que reconstrói pessoas e cenários do zero a cada frase dificulta continuidade e revisão.

O custo de render 3D depende de segundos, quadros, materiais, simulação, memória e hardware; não deve aparecer no painel como apenas “mais tokens”. Software gratuito ainda utiliza energia, armazenamento e disponibilidade da máquina. Não há hoje capacidade comprovada para oferecer essa qualidade em quantidade ilimitada na hospedagem gratuita.

Na futura integração, reutilizar máquina de estados, logs, job_events, controle de orçamento de IA, revisão e publicação por destino. Congelar versão de personagem, cenário, rig, voz e configuração de render por capítulo. Falha deve preservar os artefatos anteriores; nunca trocar silenciosamente para mascotes ou outro estilo para marcar o trabalho como concluído. Normalizar clipes e medir áudio/duração antes da revisão. Licenças de elementos de terceiros devem manter a procedência; um render próprio não transforma toda textura importada em asset de autoria própria.

Os vídeos normais de gadgets seguem independentes. Esta pesquisa não altera limites, providers, banco, fila, candidatos, Telegram ou publicação.

## 10. Resultado desta etapa

Concluídos: análise das referências, inspeção do código, consulta de fontes primárias, teste básico Cycles/HIP e consulta real a quatro assets gratuitos. Ainda por executar: modelagem humanizada, importação de assets, rig facial, cabelo, figurino, imagens de desenvolvimento visual, animação e integração.

O próximo entregável visual é **um elenco e cenário convincentes em três imagens consistentes**, antes de outro vídeo completo. O objetivo estético é alto; equivalência às referências só pode ser afirmada depois de comparação visual e movimento real.
