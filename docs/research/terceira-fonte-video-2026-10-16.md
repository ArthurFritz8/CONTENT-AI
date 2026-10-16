# Terceira fonte de vídeo — pesquisa de 16/10/2026

## Resultado desta rodada

**CNAPS é candidato, ainda não é uma fonte de produção.** A pesquisa encontrou evidência oficial de capacidade gratuita recorrente e automação, mas não houve autenticação, envio de personagens ou inferência. A capacidade exata da conta e a qualidade permanecem desconhecidas. Não somar essa oferta às carteiras existentes nem anunciar segundos/capítulos disponíveis.

Puter já tem integração de capítulos, não apenas teste: [ADR-086](../ADR/ADR-086-capitulos-puter-com-franquia-recorrente.md). Sua amostra de cinco segundos foi aprovada; o capítulo inteiro ainda aguarda saldo e avaliação artística. A última consulta anterior a esta pesquisa registrou aproximadamente 677,65 créditos, abaixo da reserva estimada de 990 para três tomadas. **Esta rodada não atualizou esse saldo.** O roteiro separado de “A passagem escondida — teste Puter” e suas duas referências já foram preparados; não houve agendamento ou geração de capítulo.

## CNAPS: o que foi encontrado

O plano **Free permanente** oferece modelos hospedados e saídas com marca-d’água. A página distingue esse plano do **teste Pro de duas semanas**: sem cadastrar pagamento, o teste termina e a conta volta ao Free. A automação é anunciada em todos os planos. Entretanto, **Batch Run começa no Starter pago**; a API REST de lotes não deve ser tratada como gratuita. [Planos e regras oficiais](https://cnaps.ai/pricing).

A FAQ descreve reposição de capacidade de GPU a cada **cinco horas**. Tempo de GPU não equivale à duração do vídeo: modelo, resolução e parâmetros alteram o consumo. Não foi confirmado um limite numérico aplicável à conta do usuário. Os nós externos Google exigem chave e faturamento próprios; Gemini/Veo não viram gratuitos por estarem nesse catálogo. [FAQ oficial](https://docs.cnaps.ai/faq).

O modelo hospedado **MiniMax H3 Ref2VA** anuncia imagem/vídeo de referência e fala em português com áudio nativo. O perfil vertical documentado é **768 × 1344 a 24 FPS**, áudio estéreo de 32 kHz; a duração padrão é 124 quadros, aproximadamente 5,17 segundos. Não é o perfil Puter de 30 FPS. A página informa licença comunitária e condições de uso comercial; a revisão completa dos termos permanece pendente. Isso descreve capacidade anunciada, não prova preservação de personagens, gestos, voz ou sincronismo nos nossos arquivos. [Modelo oficial](https://docs.cnaps.ai/minimax-h3).

A rota proposta é **MCP por HTTP**, autenticada com `x-api-key`, consultando a conta e executando futuramente um fluxo por vez. Há ferramentas documentadas de leitura de plano, consumo e catálogo. A chave é criada pelo titular no console. O teste de disponibilidade anônimo do endpoint documentado respondeu **HTTP 401**, sem geração; isso confirma a exigência de autenticação, não o acesso de uma conta Free. [Guia oficial MCP](https://docs.cnaps.ai/mcp-user-guide).

## Preparação implementada

- `scripts/inspect-cnaps.mjs`: consulta operacional com `CNAPS_API_KEY` no ambiente ou em `.env.cloud`, ignorado pelo Git. Não aceita chave na linha de comando.
- `scripts/lib/cnaps-inspection.mjs`: endpoint fixo, somente inicialização, catálogo de ferramentas e três leituras permitidas: `get_workspace_info`, `get_usage`, `list_models` para vídeo. Sem uploads, criação de fluxos, geração ou alterações de cobrança.
- Respostas JSON/SSE limitadas, timeout, sem redirecionamentos ou tentativas automáticas. Sessão e erros privados não são impressos. O relatório guarda apenas formatos de resposta, sem valores pessoais ou financeiros. Uma mudança de contrato interrompe a consulta.
- `scripts/test-cnaps-inspection.test.mjs`: testes offline de privacidade, autenticação, paginação, respostas grandes, instruções recebidas, contratos inesperados e encerramento de SSE. Incluído no CI.

Execução pelo operador, depois de configurar a chave:

```powershell
node scripts/inspect-cnaps.mjs
```

Saída local ignorada: `output/cnaps-discovery/inspection.json`. Essa primeira etapa verifica transporte e formatos; **não interpreta saldo, não certifica o Free e não habilita produção**. Será necessário mapear a resposta autenticada real antes de guardar observações de capacidade. O transporte segue a [especificação MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## Como conectar, caso o usuário ainda não tenha conta

1. Acessar [CNAPS](https://cnaps.ai/) e criar uma conta, sem cadastrar cartão ou contratar plano.
2. Conferir em Billing/Usage se a conta está Free ou em teste Pro. Anotar essa distinção; capacidade temporária não entra na previsão recorrente.
3. No menu **API Key**, clicar em **Create New Key**, usar a descrição `ContentAI` e escolher uma validade. Guardar o valor mostrado uma única vez em `.env.cloud`, no campo `CNAPS_API_KEY`, sem enviar no chat.
4. Avisar que a chave foi configurada. A consulta inicial e o restante da preparação serão feitos pelo projeto; não é necessário montar os fluxos manualmente.

Os nomes de menus e a criação de chave são descritos na [documentação oficial](https://docs.cnaps.ai/). Se a interface exigir pagamento ou não permitir acesso Free, registrar o bloqueio e não contratar nada.

## Critérios antes de habilitar capítulos

1. Confirmar plano base, eventual trial, limite, janela de reposição e acesso ao modelo na resposta autenticada. Se só aparecer franquia Pro temporária, não projetar produção recorrente com esse número.
2. Descobrir o identificador e os parâmetros reais do modelo no catálogo, sem inventá-los. Conferir watermark, uso comercial e condições de automação aplicáveis.
3. Implementar uma única tomada de teste com orçamento, intenção persistida e retomada sem reenvio incerto. Usar as referências já aprovadas em armazenamento privado e compartilhamento temporário necessário ao processamento. Nenhum envio ocorreu nesta pesquisa.
4. Revisar o original: nitidez dos olhos, mãos, gestos, voz em português, boca sincronizada, duração e quadros efetivamente diferentes. Não prometer corrigir defeitos apenas aumentando o FPS.
5. Somente após aprovação, criar exemplo próprio e integração completa no painel/worker. Manter carteira e perfil separados. Uma novela existente não troca de motor silenciosamente; uma variante precisa de amostra e aceite para preservar a continuidade visual.

## Outras alternativas verificadas nesta rodada

| Serviço | Evidência oficial | Decisão para geração automática gratuita recorrente |
| --- | --- | --- |
| OpenFilmo | Free com créditos mensais; acesso API aparece no Studio pago. [Planos](https://www.openfilmo.com/pricing/). | Não atende automação gratuita. |
| Zebracat | Conteúdo generativo avançado aparece como recurso pago; chave para servidor usa cobrança própria. Há descrições divergentes da franquia básica. [Suporte](https://help.zebracat.ai/article/dbab01aa903e435bbe4cc2e9dd602666--is-zebracat-free-to-use), [MCP](https://mcp.zebracat.ai/). | Não comprovada franquia recorrente de vídeo generativo por API. |
| Krea | API tem créditos e faturamento separados da interface. [API oficial](https://www.krea.ai/features/api). | Não transferir os créditos diários do site para a API. |
| Mello | Oferta diária; acesso gratuito de API explicitado para certos modelos de imagem. [Oferta](https://app.melloai.art/). | Vídeo gratuito por API ainda não comprovado; não fazer depósito. |
| RedVideo | Geração gratuita diária anunciada na interface. [Oferta](https://redvideo.ai/free-ai-video-generator). | API pública adequada não identificada; não habilitar automação de navegador presumida. |
| Orshot | Vídeo por IA exige plano pago. [Documentação](https://orshot.com/docs/video-generation/ai-video). | Excluído. |
| Videly | Créditos gratuitos únicos; API em plano pago. [Planos](https://videly.io/pricing). | Excluído. |
| Tensor.Art / TAMS | Créditos de API separados do site; a oferta inicial não comprova renovação. [FAQ](https://tams-docs.tensor.art/docs/api/guide/integration-faq/). | Não contar a franquia do site como API gratuita. |
| ElevenLabs | API de imagem/vídeo exige Pro ou superior. [Documentação](https://elevenlabs.io/docs/overview/capabilities/image-video). | Excluído para este orçamento. |

“Não comprovado” descreve a evidência desta rodada, não uma impossibilidade permanente. As exclusões anteriores continuam documentadas na [pesquisa da segunda fonte](segunda-fonte-video-2026-10-16.md). Nenhum dos novos candidatos teve qualidade ou capacidade real de conta testada nesta rodada.
