# Terceira fonte de vídeo — pesquisa de 16/10/2026

## Resultado desta rodada

**CNAPS não está liberado para produção: o primeiro pedido real foi recusado por franquia insuficiente.** A pesquisa encontrou documentação de capacidade gratuita recorrente e automação, e a conta/catálogo retornam Free e 0% usado. Mesmo assim, não foi possível iniciar o teste. Nenhum vídeo foi gerado, a qualidade não foi avaliada e a capacidade não entra nas carteiras. Consulte a [evidência do teste real](cnaps-malu-audition-2026-10-16.md).

### Atualização autenticada de 16/10

A chave fornecida pelo titular foi configurada apenas em `.env.cloud`, ignorado pelo Git. As consultas reais retornaram workspace pessoal ativo, `plan_name: free`, consumo também no plano `free`, **0% utilizado**, `is_unlimited: false` e janela de **cinco horas**. Não há campo explícito sobre trial nessa resposta. A classificação Free foi observada diretamente; não foi deduzida do anúncio de teste Pro.

O catálogo liberou `Txt2Video-MiniMax-H3-Ref2VA`, com plano mínimo Free. As consultas de detalhes e parâmetros confirmaram a seleção de 124 quadros, `768x1344 (9:16)`, 30 passos e seed 42016. O contrato permite imagem de referência e texto; o teste proposto continua com a imagem original aprovada da Malu. A API não retornou a franquia absoluta de GPU nem o instante exato da próxima reposição. Por isso **não há estimativa de capítulos, segundos ou reserva de produção** a partir do percentual.

Na conexão inicial não houve criação de fluxo, upload ou inferência. Depois, com autorização para continuar, o teste criou um fluxo privado e registrou a referência, mas a única chamada de geração foi recusada. Há agora uma CLI limitada ao teste, com checkpoint durável; nenhuma execução está agendada e não há executor de capítulos CNAPS. Relatório privado de conexão: `output/cnaps-discovery/inspection.json`. O catálogo estima tempo elevado no modelo padrão; isso não foi medido pelo projeto, pois o processamento não iniciou.

Puter já tem integração de capítulos, não apenas teste: [ADR-086](../ADR/ADR-086-capitulos-puter-com-franquia-recorrente.md). Sua amostra de cinco segundos foi aprovada; o capítulo inteiro ainda aguarda saldo e avaliação artística. A última consulta anterior a esta pesquisa registrou aproximadamente 677,65 créditos, abaixo da reserva estimada de 990 para três tomadas. **Esta rodada não atualizou esse saldo.** O roteiro separado de “A passagem escondida — teste Puter” e suas duas referências já foram preparados; não houve agendamento ou geração de capítulo.

## CNAPS: o que foi encontrado

O plano **Free permanente** oferece modelos hospedados e saídas com marca-d’água. A página distingue esse plano do **teste Pro de duas semanas**: sem cadastrar pagamento, o teste termina e a conta volta ao Free. A automação é anunciada em todos os planos. Entretanto, **Batch Run começa no Starter pago**; a API REST de lotes não deve ser tratada como gratuita. [Planos e regras oficiais](https://cnaps.ai/pricing).

A FAQ descreve reposição de capacidade de GPU a cada **cinco horas**. Tempo de GPU não equivale à duração do vídeo: modelo, resolução e parâmetros alteram o consumo. Não foi confirmado um limite numérico aplicável à conta do usuário. Os nós externos Google exigem chave e faturamento próprios; Gemini/Veo não viram gratuitos por estarem nesse catálogo. [FAQ oficial](https://docs.cnaps.ai/faq).

O modelo hospedado **MiniMax H3 Ref2VA** anuncia imagem/vídeo de referência e fala em português com áudio nativo. O perfil vertical documentado é **768 × 1344 a 24 FPS**, áudio estéreo de 32 kHz; a duração padrão é 124 quadros, aproximadamente 5,17 segundos. Não é o perfil Puter de 30 FPS. A página informa licença comunitária e condições de uso comercial; a revisão completa dos termos permanece pendente. Isso descreve capacidade anunciada, não prova preservação de personagens, gestos, voz ou sincronismo nos nossos arquivos. [Modelo oficial](https://docs.cnaps.ai/minimax-h3).

A rota proposta é **MCP por HTTP**, autenticada com `x-api-key`, consultando a conta e executando futuramente um fluxo por vez. Há ferramentas documentadas de leitura de plano, consumo e catálogo. A chave é criada pelo titular no console. O teste de disponibilidade anônimo do endpoint documentado respondeu **HTTP 401**, sem geração; isso confirma a exigência de autenticação, não o acesso de uma conta Free. [Guia oficial MCP](https://docs.cnaps.ai/mcp-user-guide).

## Preparação implementada

- `scripts/inspect-cnaps.mjs`: consulta operacional com `CNAPS_API_KEY` no ambiente ou em `.env.cloud`, ignorado pelo Git. Não aceita chave na linha de comando.
- `scripts/lib/cnaps-inspection.mjs`: endpoint fixo, inicialização, catálogo de ferramentas e leituras `get_workspace_info`, `get_usage`, `list_models` para vídeo. Somente se o catálogo liberar o modelo de referência fixado, consulta também `get_model` e `get_model_parameters`, após validar os contratos dessas ferramentas. Sem uploads, criação de fluxos, geração ou alterações de cobrança.
- `scripts/lib/cnaps-account-observation.mjs`: mapeia os campos autenticados conhecidos. Planos incompatíveis, conta inativa, modelo pago ou parâmetros alterados não habilitam o perfil. Guarda observações permitidas de plano, percentual, janela e seleção; identidade da conta vira hash. Nunca converte percentual em segundos ou capítulos.
- Respostas JSON/SSE limitadas, timeout, sem redirecionamentos ou tentativas automáticas. Sessão, identidade pessoal e erros privados não são impressos. Uma mudança de contrato impede confirmar o modelo ou interrompe a consulta.
- `scripts/test-cnaps-inspection.test.mjs`: testes offline de privacidade, autenticação, paginação, respostas grandes, instruções recebidas, contratos inesperados e encerramento de SSE. Incluído no CI.

Execução pelo operador, depois de configurar a chave:

```powershell
node scripts/inspect-cnaps.mjs
```

Saída local ignorada: `output/cnaps-discovery/inspection.json`. A versão 2 verifica o transporte e registra os campos autenticados conhecidos; **não certifica uma inferência gratuita, não estima saldo em vídeo e não habilita produção**. O transporte segue a [especificação MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## Como conectar, caso o usuário ainda não tenha conta

1. Acessar [CNAPS](https://cnaps.ai/) e criar uma conta, sem cadastrar cartão ou contratar plano.
2. Conferir em Billing/Usage se a conta está Free ou em teste Pro. Anotar essa distinção; capacidade temporária não entra na previsão recorrente.
3. No menu **API Key**, clicar em **Create New Key**, usar a descrição `ContentAI` e escolher uma validade. Guardar o valor mostrado uma única vez em `.env.cloud`, no campo `CNAPS_API_KEY`, sem enviar no chat.
4. Avisar que a chave foi configurada. A consulta inicial e o restante da preparação serão feitos pelo projeto; não é necessário montar os fluxos manualmente.

Os nomes de menus e a criação de chave são descritos na [documentação oficial](https://docs.cnaps.ai/). Se a interface exigir pagamento ou não permitir acesso Free, registrar o bloqueio e não contratar nada.

## Critérios antes de habilitar capítulos

1. Atualizar plano, consumo e acesso ao modelo antes do teste. Os campos conhecidos já foram mapeados; a franquia absoluta e indicadores explícitos de trial não são expostos. Não projetar produção recorrente com uma capacidade desconhecida.
2. Fixar o identificador e os parâmetros autenticados já descobertos. Conferir watermark, uso comercial e condições de automação aplicáveis.
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
