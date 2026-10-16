# Segunda fonte automática de vídeo — 16/10/2026

## Resultado e estado do projeto

**Estado atualizado em 16/10, após a pesquisa inicial:** Puter já possui integração de capítulos no painel e worker, descrita no [ADR-086](../ADR/ADR-086-capitulos-puter-com-franquia-recorrente.md). A amostra de cinco segundos está aprovada; a avaliação artística de um capítulo completo aguarda saldo. Os parágrafos seguintes preservam as observações da descoberta e não substituem o contrato implementado. A busca posterior por outra fonte está na [pesquisa da terceira fonte](terceira-fonte-video-2026-10-16.md).

Auray tem piloto aprovado e integração real; a última inspeção autenticada de 16/10 encontrou saldo zero. Modal permanece desativado. Cloudflare está conectado para imagens e não gera os vídeos deste fluxo. O teste de imagem Cloudflare não preservou a identidade da Malu e não substituiu suas referências aprovadas.

**Atualização após autorização e aprovação do usuário:** o primeiro teste real Puter gerou cinco segundos em 720×1280, 30 FPS e áudio, usando a referência aprovada. O usuário aprovou a amostra e sua prévia será adicionada à galeria privada ([ADR-085](../ADR/ADR-085-previa-puter-aprovada-na-galeria.md)). O saldo mais recente observado é de aproximadamente 677,7 créditos. Detalhes, custos, limites e retomada no [relatório do teste](puter-malu-audition-2026-10-16.md). As descrições abaixo preservam o estágio inicial de descoberta; não habilitam produção.

Puter é o candidato em avaliação. A documentação combina franquia mensal, API em servidor e vídeo com referência. O usuário concluiu o cadastro e forneceu acesso; a primeira inspeção real de 16/10 às 13:41 BRT confirmou franquia mensal de **1.000 créditos**, aproximadamente **999,9 disponíveis**, email confirmado, conta permanente e `subscribed: false`. Não há exigência de verificação de cartão nem fallback para cartão disponível na resposta consultada. O token foi salvo somente em `.env.cloud`, ignorado pelo Git; não está no painel ou no roteador de produção. Naquela primeira consulta não houve inferência ou compra; o teste posterior está documentado acima.

O catálogo autenticado expõe Wan 2.7 I2V em 9:16, 720P/1080P e 30 FPS, com durações de 2 a 15 segundos. Isso confirma configuração anunciada, não qualidade do resultado nem acesso efetivo a uma inferência. A carteira usa **créditos**, enquanto esse modelo declara preços em **centavos de dólar**; o catálogo de custos não retornou conversão em `creditsPerUnit`. Não equiparar as unidades, não deduzir segundos de vídeo e não liberar geração a partir dessa leitura. O fator de conversão é configuração do servidor e não é exposto pelo cliente, conforme o [código oficial do dashboard](https://github.com/HeyPuter/puter/blob/471b90046250c1056d2ae7fd6edf6f4272a83c0e/src/gui/src/UI/Dashboard/credits.js).

## Comparação verificada em fontes oficiais

| Serviço | O que foi confirmado | Decisão para nosso requisito |
| --- | --- | --- |
| **Puter** | Franquia mensal compartilhada entre AI e outros recursos; conta gratuita consultada e teste I2V real concluído. | **Teste para revisão.** Produção e qualidade de capítulos ainda não aprovadas. [Franquia](https://docs.puter.com/rate-limits-and-quotas/), [vídeo](https://docs.puter.com/AI/txt2vid/). |
| **Mello** | Anuncia US$ 0,50 repostos a cada 24h, sem acumular, e vídeo MiniMax H3 no site. O acesso gratuito por API descrito na página é para determinados modelos de **imagem**. | Pendente: não foi comprovada API gratuita de **vídeo**; não contar como capacidade automática. [Oferta oficial](https://app.melloai.art/). |
| **Vercel AI Gateway** | US$ 5 mensais apenas para modelos elegíveis. No diretório público consultado, **39 modelos de vídeo, todos `availableToFreeTier: false`**. | Não atende vídeo gratuito na fotografia atual; não pedir cadastro apenas pelo anúncio dos US$ 5. [Regras](https://vercel.com/docs/ai-gateway/pricing), [diretório](https://vercel.com/ai-gateway/models?freeTier=true&capabilities=video-generation). |
| **Pollinations** | Catálogo público de vídeo consultado: **22 modelos, todos `paid_only: true`**. | Não inferir acesso gratuito a vídeo pela existência de créditos diários de outras modalidades. [Catálogo oficial](https://gen.pollinations.ai/video/models). |
| **Pixazo** | Oferta mensal exige primeira recarga de pelo menos **US$ 10**. | Excluído por exigir desembolso. Não confundir com a oferta de modelos a custo zero, que ainda anuncia vídeo como futuro. [Franquia](https://www.pixazo.ai/pixazo-free-tier), [modelos gratuitos](https://www.pixazo.ai/api/free). |
| **Comfy Cloud** | A API exige assinatura paga; o plano Free está excluído. | Excluído para automação sem gasto, mesmo que haja ações gratuitas na interface. [Documentação atual da API](https://docs.comfy.org/development/cloud/overview). |
| **Viralance** | A oferta gratuita é de oito créditos únicos. | Excluído por não ser recorrente. [Preços](https://viralance.com/pricing). |
| **deAPI** | Oferta anunciada de US$ 5 para novos usuários. | Não é prova de franquia recorrente; não habilitar. [Oferta](https://deapi.ai/). |
| **Runware** | Oferta para novos cadastros com email empresarial. | Não é prova de franquia recorrente; não habilitar. [Preços](https://runware.ai/pricing/?category=video). |
| **ComfyICU** | Créditos gratuitos anunciados para novas contas. | Não é prova de renovação; não habilitar. [Oferta serverless](https://comfy.icu/serverless/). |
| **Tensor.Art / TAMS** | Créditos de computação da API separados dos créditos do site. | Não transferir a promessa diária da interface para a API. Recorrência gratuita de vídeo por API não demonstrada. [FAQ de integração](https://tams-docs.tensor.art/docs/api/guide/integration-faq/). |
| **SeaArt** | O site anuncia stamina diária. | Recorrência e uso gratuito pela API de vídeo não demonstrados. [Planos](https://www.seaart.ai/mall/). |
| **PixVerse** | Plataforma de API tem faturamento próprio. | Benefício no site não comprova crédito gratuito recorrente da API. [Documentação da plataforma](https://docs.platform.pixverse.ai/pixverse-api-llm-txt-2109771m0). |
| **Vidu** | API documenta compra de créditos; há oferta distinta na interface. | Benefício no site não comprova franquia recorrente para integração. [FAQ da API](https://docs.platform.vidu.com/7208257m0). |
| **Higgsfield** | Gerações gratuitas são limitadas ao site; uso fora dele consome créditos. | Não demonstrada uma franquia recorrente gratuita de vídeo por API. [Regras de créditos](https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work). |
| **LTX Studio** | O suporte informa que usuários gratuitos não recebem franquia mensal. | Excluído como fonte recorrente. [Suporte oficial](https://help.ltx.io/hc/en-us/articles/33398780691858-How-can-I-get-more-credits). |

“Não demonstrado” significa evidência insuficiente para habilitar produção; não prova que o serviço jamais oferecerá esse recurso. Preços, catálogos e termos podem mudar. Não houve teste de qualidade nesses serviços nesta rodada. O comparativo complementa, sem revalidar, as exclusões anteriores de Kaggle, Colab e rotas ZeroGPU reprovadas, registradas na [pesquisa anterior](gratuidade-recorrente-video-2026-10-08.md).

## Puter: o que falta verificar

Há um caminho de autenticação para execução em servidor: conta própria e token de API no dashboard. A consulta de uso é independente de geração. [Token oficial](https://developer.puter.com/tutorials/puter-auth-token/), [consulta mensal](https://docs.puter.com/Auth/getMonthlyUsage/).

O modelo candidato é Wan 2.7 I2V, por receber imagem inicial. A documentação lista 30 FPS e variantes de resolução/duração; isso não comprova movimento nativo útil, conservação de rosto/mãos ou sincronização em português. `test_mode` retorna um vídeo pré-pronto e **não serve como teste dos nossos personagens**. Valores não suportados podem retornar parâmetros padrão, portanto qualquer teste real precisa conferir o arquivo final. [Contrato de vídeo](https://docs.puter.com/AI/txt2vid/).

A inspeção do código público identificou também limites importantes: saldo combinado pode incluir créditos comprados; valores do catálogo podem não ser uma cotação específica da conta; a duração pode ser reduzida conforme saldo. Não usar valores padrão de uma instalação própria como se fossem o saldo do serviço hospedado. Os padrões encontrados de US$ 0,25/mês e dois centavos por segundo **não são uma oferta autenticada para esta conta**. [Código consultado, fixado por commit](https://github.com/HeyPuter/puter/tree/471b90046250c1056d2ae7fd6edf6f4272a83c0e), [limites oficiais](https://docs.puter.com/rate-limits-and-quotas/).

O fluxo de avaliação será:

1. Consultar saldo, unidade, indícios de assinatura e catálogo da conta, sem gerar.
2. Confirmar que o plano e o modelo permitem vídeo com a franquia recorrente sem compra; verificar o custo efetivo de um take completo, com margem para transferência/armazenamento e reservas em andamento.
3. Só então preparar um teste curto com a **referência aprovada** da Malu ou frame do filme aprovado, sem redesenhar a personagem a partir de texto.
4. Conferir nitidez, mãos, gestos, duração, quadros originais, áudio e fala/boca. Submeter a amostra à revisão do usuário.
5. Após aprovação, criar perfil próprio e integrar execução durável, conciliação, quota compartilhada e painel. Não trocar silenciosamente o motor de uma novela já vinculada a outro perfil.

Nenhum saldo será somado ao Auray/Modal nesta fase. Capacidade de capítulos depende do perfil, da duração e do custo das cenas, não apenas de somar moedas de provedores. APIs compatíveis com OpenAI/Anthropic do Puter exigem assinatura; a rota gratuita documentada usa suas APIs próprias. [Condições de acesso](https://docs.puter.com/rate-limits-and-quotas/).

## Preparação implementada nesta rodada

O comando abaixo é **uma ferramenta de descoberta do operador**, sem integração no painel ou no roteador de produção:

```powershell
node scripts/inspect-puter.mjs
```

Ele lê `PUTER_AUTH_TOKEN` do ambiente ou do arquivo ignorado `.env.cloud`. Não aceita token como argumento. Faz somente três consultas GET a `https://api.puter.com`: `/whoami`, `/metering/usage` e `/metering/allCosts`. Não possui chamada de geração, compra, cadastro, publicação ou envio de referências.

O relatório sanitizado fica em `output/puter-discovery/inspection.json`, ignorado pelo Git. Retém impressão SHA-256 da conta, saldo combinado e unidade declarada, observações de custo de vídeo e fingerprint do catálogo. Omite nome, email, UUID bruto e token. Não grava a resposta bruta.

`production_ready` permanece **false**, `free_remaining`, segundos e capítulos permanecem **null**, mesmo com saldo positivo. O catálogo bruto não é cotação por conta. A renovação exata e reservas externas não são inventadas. Campos inesperados, autenticação inválida, redirecionamento, timeout, resposta excessiva e falhas HTTP bloqueiam a consulta; não há tentativas automáticas. `inspection_complete` apenas confirma leitura, nunca habilita geração. Consultas podem ter o custo residual de transferência descrito pelo serviço; não há inferência.

Os nove testes offline cobrem privacidade, ausência de chamadas de geração, separação de créditos comprados, unidades, falhas, tamanho, mudanças de catálogo e falta de chave. O CI executa essa suíte e os seis jobs do commit `80e7370` passaram. A ferramenta **foi validada com uma conta real**, retornando `inspection_complete` e 62 linhas de custos de vídeo; mantém `production_ready: false`. A consulta adicional do catálogo foi uma chamada separada, somente de leitura, a `/drivers/call`, com método fixo `models`, interface `puter-video-generation` e driver `ai-video`; não chamou `generate` e não é parte dos três GETs do comando versionado.

## Cadastro inicial, se o usuário seguir com a avaliação

1. Abrir [puter.com](https://puter.com/) e criar conta gratuita própria; confirmar o email caso solicitado.
2. Abrir o [dashboard da conta](https://puter.com/dashboard#account) e localizar **API token → Create token**, conforme o tutorial oficial.
3. Salvar o token somente em `PUTER_AUTH_TOKEN` dentro de `.env.cloud`, ou em campo protegido quando houver integração no painel. Não colar no chat. Não substituir as outras credenciais do arquivo.
4. Executar a inspeção acima. Não contratar plano ou comprar créditos para completar esta avaliação.

Esses passos conectam a consulta inicial. Não representam uma segunda fonte já pronta, uma promessa de qualidade idêntica ao Auray ou garantia de episódios gratuitos por mês.
