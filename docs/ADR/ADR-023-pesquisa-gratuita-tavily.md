# ADR-023 — Pesquisa automática gratuita com Tavily e Gemini

## Objetivo

Restaurar a etapa automática de pesquisa para contas novas, sem faturamento e sem reduzir a exigência de fontes verificáveis.

## Contexto

O piloto real mostrou duas mudanças do provedor. O Gemini 2.5 Flash e o Flash-Lite aparecem no catálogo, mas a API os rejeita para novos usuários. O Gemini 3.6 Flash aceita geração gratuita de texto, porém o Google Search grounding está indisponível no nível gratuito. Manter o desenho anterior exigiria faturamento; retirar as fontes violaria os gates factuais e a revisão editorial.

## Solução

- Usar uma busca Tavily `basic` por episódio para localizar até cinco fontes. O plano Researcher oferece 1.000 créditos mensais sem cartão.
- Limitar internamente o consumo a 100 pesquisas por mês e cinco por minuto, com reserva atômica antes de cada tentativa. Ao atingir o limite, o pipeline para sem cobrança.
- Entregar título, URL e trecho das fontes ao Gemini 3.6 Flash com `responseSchema`. Cada claim só é aceito quando referencia uma URL presente no resultado da busca.
- Persistir query, request ID, fontes, trechos, scores e claims em `research_evidence` versão 2.0.0. A evidência antiga do Google permanece legível para compatibilidade.
- Manter a revisão factual humana obrigatória. O mecanismo comprova a origem usada pelo modelo, mas não substitui a avaliação editorial da veracidade.

## Prevenção

- A chave Tavily existe somente nos secrets das Edge Functions.
- Busca avançada, resposta gerada pela Tavily e conteúdo bruto ficam desativados para consumir um crédito por episódio.
- O banco rejeita reservas acima dos limites e usuários `anon`/`authenticated` não executam as RPCs de quota.
- Falhas de fonte nunca promovem o episódio para `research`.

## Impacto e rollback

`generate-research` passa de uma chamada Gemini com Google Search para uma busca Tavily seguida de uma chamada Gemini de texto estruturado. O estado final e o contrato `research_data` permanecem iguais. Para rollback, restaurar o provider anterior e manter o leitor da evidência 2.0 para episódios já criados.
