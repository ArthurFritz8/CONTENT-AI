# Piloto técnico — MacBook Neo

Episódio de validação: `86ef4c29-1763-4593-ac27-e9c59782ff07`.
O piloto não foi criado a partir da `idea_queue` e não altera o candidato `0d716ed2`.
O destino é revisão humana; publicação automática permanece fora do escopo.

## Pesquisa e roteiro

- Fatos de produto: [ficha técnica oficial da Apple Brasil](https://www.apple.com/br/macbook-neo/specs/). A fonte serve para conferir texto e infográficos, **não** concede licença para copiar fotos da Apple.
- Sete cenas conforme o plano aprovado: cores → problema da portabilidade → medidas → cenário de uso → armazenamento/memória → portas e limites → pergunta orgânica.
- [Roteiro antes da vinculação dos assets](../../assets/pilots/macbook-neo/script-pre-assets.json): imagens genéricas são identificadas como ilustrativas; não afirma teste prático, desempenho medido nem preço. O CTA de TikTok e o de YouTube são orgânicos, em conformidade com o [ADR-037](../ADR/ADR-037-crescimento-organico-por-plataforma.md). O canal YouTube aguarda monetização/decisão editorial posterior.
- O gerador remoto de texto retornou falhas transitórias. O plano aprovado foi convertido manualmente ao contrato `script_json`, validado por `scriptJsonSchema` e `script-quality`. O estágio de pesquisa usou busca Tavily com evidência ligada à fonte oficial. Assim, o piloto valida os estágios posteriores, mas **não comprova estabilidade da geração automática de roteiro**.

## Imagens e licenças

[Gerador reproduzível](../../scripts/build-pilot-macbook-neo-assets.py) e [manifesto com hashes e licenças](../../assets/pilots/macbook-neo/manifest.json). Foram produzidas 14 imagens: uma vertical `1080×1920` e uma horizontal `1920×1080` por cena. Dez são infográficos originais (`license=own`, `source=system`). Quatro são composições com duas fotos contextuais do Pexels (`license=pexels`, `source=pexels`):

| Cena | Foto | Uso |
|---|---|---|
| 2 | [Nataliya Vaitkevich, Pexels 8062404](https://www.pexels.com/photo/laptop-on-white-wooden-desk-8062404/) | Mesa com notebook genérico; não representa o MacBook Neo. |
| 4 | [Darina Belonogova, Pexels 8004008](https://www.pexels.com/photo/laptop-and-smartphone-on-a-white-table-8004008/) | Cenário genérico de notebook e celular; não representa o MacBook Neo. |

Os recortes foram conferidos em 9:16 e 16:9, sem marcas visíveis. As composições trazem aviso de foto ilustrativa. A [licença Pexels](https://www.pexels.com/license/) permite uso e modificação em redes sociais; a revisão humana ainda deve conferir adequação editorial e direitos antes de publicar. Os arquivos JPG de origem ficam apenas no cache local ignorado pelo Git; o repositório mantém as composições efetivamente usadas e seus créditos.

## Voz, render e revisão

- Voz de amostra e de produção: `pt-BR-FranciscaNeural` via Edge TTS, fallback gratuito do pipeline. A soma medida das sete falas foi **77,66 s**; seis intervalos de `0,5 s` levam a **80,66 s** antes dos ajustes finais do renderer, acima do mínimo de 60 s.
- [Assets no GitHub Actions](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/35911317012) — sucesso; 14 imagens, 8 áudios (incluindo CTA por plataforma) e 16 faixas de legenda registradas.
- [Primeiro render no GitHub Actions](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/35911576706) — passou no QA técnico, com três arquivos de 81,23 s e decodificação integral, mas a inspeção manual de quadros encontrou legendas sobre números/cartões. O resultado foi reprovado no QA visual antes de qualquer envio ao operador.
- O layout das artes foi revisto para reservar a faixa das legendas. Os 14 assets receberam nova versão, e a máquina de estados fez `rendered → failed → rendered → review → assets` para solicitar novo render sem publicar ou criar aprovação humana fictícia. A transição `review → assets` limpa o render anterior e gera nova chave de checkpoint.
- [Segundo render no GitHub Actions](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/35912431399) — sucesso. Os três arquivos finais têm 81,23 s: horizontal `1920×1080`, vertical `1080×1920` e TikTok orgânico `1080×1920`. O QA do renderer decodificou cada arquivo por inteiro, sem alertas. Inspeção manual de sete quadros em cada orientação confirmou as áreas de legenda livres; `ffmpeg` não detectou silêncio superior a 2 s no áudio final.
- O pacote passou em `buildReviewPacket` e foi enviado ao Telegram como revisão `649bcb9c-dfd1-4579-8256-c571d030049b` (mensagem 12). O registro está em `delivery_status=sent`, `decision=pending`; o episódio permanece em `review`, sem aprovação e sem registros em `publishes`. O candidato `0d716ed2` permanece pendente e sem episódio.
