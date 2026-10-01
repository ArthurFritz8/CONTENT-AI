# ADR-044 — Densidade editorial, seleção visual e duração real

Data: 2026-09-30. Status: implementado para imagens e QA; clipes e curadoria de voz permanecem em avaliação.

## O — Objetivo

Produzir vídeos com explicação suficiente, imagens variadas e coerentes com a narração, preservando o contrato de duração mínima de 60 segundos reais e o orçamento gratuito.

## C — Contexto

O episódio `04f61138-453f-4b2d-a5f4-da8d4eadc0a3` previa 65 segundos, mas o arquivo ficou com cerca de 35 segundos e passou no QA com um aviso. Quatro cenas usaram quatro fotos Pexels distintas, entre elas imagens identificadas como outros aparelhos. A busca solicitava só a primeira foto; o renderer usava um zoom central fixo apesar de `ken_burns` no roteiro. O prompt de pesquisa aceitava vários resultados concentrados no mesmo domínio, e o roteiro tinha pouco conteúdo falado.

## S — Solução

- O QA de roteiro rejeita menos de 175 palavras na narração e instrui a IA a usar fatos complementares, exemplos e limitações. Uma amostra Edge de 22 palavras durou 8,57 segundos; 130 palavras poderiam ficar abaixo do mínimo. A regra de palavras é apenas um filtro preliminar: duração real é medida no áudio. A versão do QA sobe para 1.2.0.
- O renderer soma as durações dos áudios antes de gastar tempo renderizando e reprova previsão abaixo de 60 segundos. O `assessMedia` reprova também o MP4 final abaixo desse mínimo, além dos checks técnicos anteriores. Não se alonga música, silêncio ou velocidade para fabricar duração.
- Quando a primeira busca Tavily encontra apenas um domínio, uma busca complementar básica tenta localizar fonte independente. A reserva de créditos e o evento são separados; URLs duplicadas são removidas, respeitando as oito fontes máximas do contrato de evidência. A pesquisa pode continuar com as fontes iniciais se a segunda busca estiver indisponível. O prompt pede cobertura de contexto e limitações e evita repetir um anúncio como claims separados.
- Quando a pauta fornece uma URL de referência e a primeira busca não retorna aquele domínio, a busca complementar usa `site:` para tentar localizar a página citada. O link da pauta jamais é incluído diretamente na evidência: só resultados efetivamente devolvidos pelo Tavily podem fundamentar claims. O mesmo teto de uma busca complementar permanece.
- Quando a página exata da pauta aparecer no Tavily, ela fica em primeiro lugar no prompt e deve sustentar ao menos uma afirmação. Uma resposta que a ignora recebe um reparo Gemini sem nova busca Tavily; se ainda ignorar, a etapa falha antes do roteiro. A exigência vincula fonte e claim, mas não substitui a leitura humana do trecho.
- A prioridade de referência só se aplica a uma URL explicitamente identificada na pauta como `Fonte`, `Referência` ou `Source`. Links de produto ou de afiliado não viram evidência obrigatória por aparecerem primeiro no texto.
- Se o modelo citar URLs ausentes do resultado Tavily, essas afirmações são descartadas e auditadas; menos de três afirmações com URL exata mantêm a pesquisa bloqueada. Uma tentativa real com Muse Charm revelou esse caso. O filtro não substitui a verificação humana da veracidade de cada afirmação.
- O roteiro separa afirmações da fabricante de relatos de imprensa. A auditoria do piloto encontrou especificações de fontes secundárias narradas como "confirmadas"; o prompt agora exige atribuição e incerteza quando não há fonte primária. O QA automático continua incapaz de comprovar que o trecho sustenta o detalhe narrado, então a revisão humana deve conferir o roteiro.
- Cada busca Pexels retorna até 12 fotos para seleção local. O seletor prioriza sobreposição textual entre consulta e descrição, rejeita marcas e tipos de aparelho não pedidos pela narração/consulta e evita repetir fotos entre cenas. Ele escolhe até três imagens por cena; as adicionais ficam em `assets` com `metadata.shot_index` e o mesmo registro de licença/autoria. O asset principal permanece no contrato existente de `script_json`.
- A inspeção do piloto mostrou falsos positivos de texto (chaves de casa, equipamento odontológico e calendário de 2025). O seletor agora exige ao menos um termo relevante além de palavras genéricas, rejeita contextos estranhos ao pedido e datas antigas. Reduzir tomadas é preferível a inserir uma imagem enganosa.
- Uma foto de chaveiro passou pela descrição Pexels embora mostrasse um rastreador Tile. O prompt visual agora evita close-ups de objetos que possam ser confundidos com o produto sem imagem licenciada. A descrição Pexels sozinha não detecta todos os logotipos; a inspeção humana dos quadros continua necessária.
- O renderer divide a cena em até três tomadas de pelo menos cerca de três segundos. Executa `ken_burns` para `in`, `out`, `pan_left`, `pan_right` e `static`; a narração e as legendas permanecem contínuas. Imagens Pexels recebem o selo discreto `IMAGEM ILUSTRATIVA` na faixa ASS, inclusive nos dois formatos.
- Quando existe trilha licenciada no script, o mix reduz automaticamente o volume da música durante a voz e limita picos. A alteração não cria uma biblioteca de música nem libera uso cruzado de licenças.
- A direção de fala segue o estilo editorial durante todo o episódio. Gemini TTS recebe instrução de tom e preservação literal do texto; Edge recebe uma variação discreta de velocidade, validada entre -15% e +15%, mantendo a mesma voz e os word boundaries. A escolha subjetiva da voz padrão depende de comparação auditiva, sem afirmar que um timbre é superior só por sua disponibilidade.
- Checkpoints e hashes continuam por cena. Episódios antigos sem `shot_index` renderizam com uma imagem. A revisão humana e as aprovações por plataforma continuam obrigatórias.

## P — Prevenção e limites

- Seleção por descrição textual reduz erros óbvios; não prova que uma fotografia mostra o produto real ou tem recorte estético perfeito. Imagem de stock é rotulada como ilustrativa. Assuntos sem material licenciado adequado exigem arte própria ou revisão, sem fabricar aparência de produto.
- `transition` ainda não implementa crossfade real entre cenas. `video_clip` ainda não é processado pelo renderer. A voz Edge usada no episódio auditado não foi trocada apenas por uma impressão subjetiva; uma comparação auditiva/estudo de pronúncia deve preceder mudança de timbre padrão. O prompt evita simular unboxing ou experiência pessoal.
- A busca complementar gasta um crédito Tavily adicional somente quando falta diversidade de domínio e respeita o budget guard existente. Nenhuma API paga, scraping, novo estado ou migration é necessário nesta etapa.
- Testes cobrem limite real, seleção/deduplicação de fontes e fotos, FFmpeg com troca de imagens e trilha comprimida pela voz, além de render completo vertical/horizontal, checkpoints e CTA orgânico.

Correção ao ADR-033: o esquema já continha opções de movimento, mas o renderer anterior não as executava. Este ADR implementa `ken_burns`; `transition` continua limitado aos cortes entre tomadas.
