# Auray: avaliação automática de uma fonte candidata

Atualização de 16/10: a segunda versão do piloto real foi aprovada pelo usuário, sem publicação. O saldo observado após o piloto é zero. O [ADR-084](ADR/ADR-084-duracao-nativa-por-capitulo.md) implementa capítulos de aproximadamente 15/30/45s por 15/30/45 créditos gratuitos, conservando perfil, áudio e quadros originais. Refazer uma cena custa até cinco créditos e reaproveita as demais. Só o piloto de 15s tem aprovação artística; nenhuma nova geração foi executada nesta ampliação. Os status e saldos de 14/10 abaixo são históricos.


Status em 14/10/2026: quatro gerações concluídas por cinco créditos cada, com saldo final observado de 30. [Teste visual](research/auray-audition-2026-10-14.md), [fala nativa aprovada como amostra individual](research/auray-native-dialogue-2026-10-14.md) e [sequência entre personagens aprovada pelo usuário como amostra audiovisual](research/auray-continuity-2026-10-14.md). O monitor de saldo e trabalhos privados está implementado na [ADR-077](ADR/ADR-077-monitoramento-e-retomada-auray-no-studio.md). A aprovação geral da sequência não elimina a mudança de roupa/aparência observada no bruto masculino; continuidade técnica e homologação da fonte continuam pendentes. A carteira monitorada permanece desativada para produção e não habilita fallback no Studio. A direção Modal anteriormente aprovada também depende das verificações de execução de produção descritas em `modal-operator.md`.

## Conectar uma vez

1. Entre em [Auray](https://app.auray.ai/) e mantenha o plano **Free**. Confirme o e-mail. Não selecione teste de plano pago, compra de créditos ou checkout.
2. Em **Settings → API Keys**, crie uma chave com `video:write`. `jobs:read` e `assets:read` são incluídos pelo serviço. Desative as demais permissões que não serão usadas. Escolha validade e anote a data de expiração.
3. A chave pode acompanhar o teto do plano Free, desde que seja finito e não exceda a franquia mensal gratuita verificada. Não precisa mudar o campo **Cap** para conectar a chave padrão. Cada avaliação do executor continua limitada a cinco créditos. Zero não significa gasto zero e é recusado; um teto acima da franquia também é recusado. Quem desejar um teto remoto mais restrito pode usar cinco.
4. Guarde a chave como `AURAY_API_KEY=...` no `.env.cloud` ignorado deste projeto, ou na variável de ambiente do executor. Não cole no chat, não envie ao navegador e não versione o arquivo.

O serviço atualmente informa 50 créditos mensais no plano Free. A API compartilha a carteira com o aplicativo. O conector consulta o contrato e preço públicos e a conta autenticada antes de cada submissão; uma franquia publicada não é saldo da conta. Planos pagos, trials, promoções temporárias, carteiras com créditos comprados/concedidos, período anterior, preço alterado, e-mail não confirmado ou carteira incompleta bloqueiam a avaliação. Não compra nem recarrega saldo.

## Saldo e trabalhos no Studio

A [ADR-077](ADR/ADR-077-monitoramento-e-retomada-auray-no-studio.md) integra uma carteira monitorada, desativada para produção. O [relatório operacional](research/auray-studio-integration-2026-10-14.md) registra a importação real e a verificação dos arquivos privados. O cadastro é feito pelo operador uma vez, depois das migrações `20261014000000` e `20261014010000`, usando a chave local e o workspace autorizado:

```powershell
node --experimental-strip-types scripts/sync-auray-studio.mts --register <workspace-uuid> output/auray-video-jobs/<hash>/state.json
```

É possível passar até cinquenta checkpoints. O script verifica conta, identidade da solicitação e caminho original. Importa trabalhos já enviados, sem submetê-los novamente. Nunca transferir um trabalho existente para outro workspace. O saldo exibido distingue valor histórico e comparação fresca de orçamento. A franquia não é somada ao Modal e não conta como capítulos liberados. A data exata de renovação não é inventada a partir do nome do mês.

`AURAY_API_KEY` deve ser instalado como secret do GitHub Actions para o workflow `story-auray-sync.yml`. Supabase já usa seus secrets de serviço. O painel e a Edge Function não precisam receber a chave Auray. Pelo botão **Atualizar saldo e retomar trabalhos**, um membro autorizado solicita uma consulta com cooldown de dois minutos. O workflow também consulta automaticamente a conta cadastrada a cada trinta minutos; o GitHub pode atrasar o agendamento. Nenhuma dessas consultas gera vídeo ou compra créditos.

```powershell
node --experimental-strip-types scripts/sync-auray-studio.mts --wallet <wallet-uuid>
node --experimental-strip-types scripts/sync-auray-studio.mts --connected
```

Retomada consulta os mesmos jobs, mesmo sem saldo para outra geração. Um resultado liquidado é validado e recolhido ao bucket `studio-private` (até 50 MB por objeto). Bytes já prontos são preservados. Falha em upload/download é reconciliada na próxima execução. Os testes aparecem no painel como prévias para revisão, com som original, acesso restrito ao workspace e hash conferido; não são capítulos aprovados em produção. `ready` significa arquivo recolhido e tecnicamente validado, sem atestar anatomia, voz ou continuidade. Os quatro testes atuais são importados por esse fluxo; novas gerações continuam no executor limitado até existir o adaptador de capítulos.

```powershell
node --experimental-strip-types scripts/render-auray-story-shot.mts --inspect
```

Sem chave, retorna `missing_api_key`, capacidade desconhecida e produção desabilitada, sem nenhuma chamada HTTP. Inspeção com chave faz somente leituras. O relatório local fica em `output/auray-video-jobs/inspection.json`, ignorado pelo Git. A integração de monitoramento publica ao workspace apenas saldo, período, bloqueios e status sanitizados; não publica conta, chave, prompt ou links assinados.

## Avaliar a mesma referência

```powershell
node --experimental-strip-types scripts/render-auray-story-shot.mts --run docs/stories/auray-action-audition.json --allow-free-audition --wait-seconds=2400
```

Uma única reação silenciosa, cinco segundos, primeiro quadro com hash fixo, seed fixo, modelo `auray-ai/minimax-h3/text-to-video`, configuração `fast`. Usa até **cinco créditos gratuitos da Auray**, nenhum crédito Modal. A referência é um asset já existente em `output/suitcase-story-preview/references/entryway-wide-v1.png`; não vem em um clone limpo. Ausência, mudança de bytes, PNG inválido ou proporção diferente bloqueiam antes da geração. O plano não aceita fala, arquivo de áudio ou outros campos. Esta configuração não suporta o WAV/voz original dos personagens.

O executor envia uma vez e consulta automaticamente o mesmo job por até 40 minutos. A documentação informa espera adicional de cerca de 12 minutos no primeiro clipe após inatividade; isso não implica erro nem autoriza outra cobrança. Cada pausa dura no máximo um minuto. O limite de espera do operador não cancela a geração. O identificador, referência, conta, contrato e estado são gravados antes do envio. Um corte de conexão não cria outra solicitação.

## Retomar sem gastar outra geração

```powershell
node --experimental-strip-types scripts/render-auray-story-shot.mts --resume output/auray-video-jobs/IDENTIFICADOR/state.json --wait-seconds=2400
```

Use o caminho informado pelo executor, sem substituir o identificador por um novo. `--resume` só consulta e recolhe o mesmo job; funciona mesmo depois de gastar a franquia ou mudar o mês. Uma resposta incerta, um job ausente ou perdido, uma falha terminal e uma rejeição não são reenviados. Se o processo morrer com `provider.lock`, confira seu PID e o checkpoint antes de remover um lock órfão. Não remova um lock de processo ativo, altere ledger ou mude de conta para contornar quota.

O arquivo MP4 original e `qa.json` permanecem em `output/auray-video-jobs/<hash>/`. O executor exige job concluído e cobrança liquidada, verifica tamanho/hash, duração, proporção, resolução, quadros decodificados e decodificação integral. Não interpola, reconstrói olhos, muda FPS ou chama uma aparência nova de melhoria aprovada. Links assinados não são persistidos, não recebem a chave de API e não podem redirecionar para outro servidor. Pedidos de URLs de download contam a franquia diária de tráfego da Auray, embora não consumam créditos de geração.

## Avaliar fala gerada pelo serviço

```powershell
node --experimental-strip-types scripts/render-auray-story-shot.mts --run docs/stories/auray-native-dialogue-audition.json --allow-free-audition --allow-native-dialogue-probe --wait-seconds=2400
```

Experimento separado de cinco segundos/cinco créditos. Usa o retrato original de Malu e pede, pelo prompt, uma única fala em português brasileiro. O plano `native_dialogue_probe` declara texto, personagem e direção vocal; exige o opt-in adicional no CLI e no SDK. Não aceita WAV, referência vocal ou um campo de áudio inventado para o endpoint. Planos de ação/reação não aceitam essa declaração de fala.

A resposta anterior continha áudio próprio, mas o contrato não garante que a frase solicitada será pronunciada. Este teste investiga essa possibilidade. Não é a voz original aprovada, nem uma rota de diálogo pronta. `dialogue_supported`, `dialogue_approved`, `voice_identity_approved` e `production_ready` continuam falsos. O QA registra o texto pedido, a origem vocal não verificada e a necessidade de revisar sincronismo. Ausência de faixa de áudio bloqueia a validação técnica; presença de áudio não comprova português, frase correta, identidade vocal ou boca sincronizada. Não substituir a trilha original por um WAV só para aparentar que o modelo obedeceu.

## Continuidade entre personagens

`docs/stories/auray-continuity-sequence.json` descreve a avaliação autorizada seguinte: reutilizar a pergunta de Malu aprovada e acrescentar a resposta de Laranjito e outra pergunta de Malu. São no máximo duas gerações novas de cinco créditos cada. Os planos `auray-continuity-laranjito.json` e `auray-continuity-malu.json` usam o mesmo executor e os dois opt-ins acima. Executar sequencialmente, respeitando uma geração concorrente do plano Free. Só começar a segunda depois de receber a primeira; não reenviar um job existente. A nova fala de Malu mantém imagem, seed, direção visual e descrição vocal da amostra aprovada; isso ajuda a comparação, mas não garante identidade vocal persistente.

`scripts/assemble_auray_sequence.py` monta somente arquivos locais identificados por SHA-256. Recebe um JSON com uma lista de `{path, sha256, speaker}` e uma pasta de saída. Não gera, não chama API e não publica. Exige formato nativo comum H.264/YUV420P/24 FPS e áudio em todos os trechos; copia o vídeo, normaliza a origem de tempo de cada take e decodifica o áudio nativo para PCM antes da concatenação. Isso evita somar lacunas de timestamp/padding AAC entre falas. Não substitui voz nem altera velocidade. O AAC final é codificado uma vez.

O QA exige igualdade de todos os hashes de quadros decodificados, ordem, FPS e duração, além de correlação do áudio de cada take após alinhar sua origem de tempo. Isso verifica o transporte da montagem; não certifica o sincronismo boca/voz gerado pelo modelo ou a identidade das vozes. Testes offline com FFmpeg, três cores/vozes sintéticas e lacunas de timestamp cobrem o problema; fontes trocadas ou sem áudio são recusadas. O montador é separado do contrato de produção de 60 FPS, que permanece inalterado.

## Critério para entrar em uma novela

Um clipe decodificado continua `review_pending`; resolução e FPS de arquivo não comprovam fluidez ou continuidade. Assistir todos os segundos e conferir personagens, roupa, cenário, olhos, anatomia das mãos, emoção e movimento. Ausência de fala neste teste é intencional. Não substitui as tomadas de diálogo com nossas vozes aprovadas. O hash identifica o contrato da API e a versão do conector; Auray não expõe uma revisão imutável dos pesos para atestar identidade por hash.

Somente após aprovação visual, verificação da licença aplicável e integração da identidade/capacidade da conta com a carteira de produção será possível considerar ação/reação compatível. A fonte acrescenta uma comparação de orçamento ao Studio, sem segundos nem capítulos liberados para produção. Os termos da Auray condicionam uso comercial à licença do modelo e exigem atribuição MiniMax e indicação de IA; a origem fica registrada no QA. Não publicar automaticamente esta avaliação.

Fontes oficiais consultadas em 09/10/2026: [créditos](https://auray.ai/docs/credits), [planos e preços ao vivo](https://api.auray.ai/v1/plans), [autenticação e limites](https://auray.ai/docs/authentication), [contrato do modelo](https://api.auray.ai/v1/models/auray-ai/minimax-h3/text-to-video/openapi.json), [uploads](https://auray.ai/docs/uploads), [jobs](https://auray.ai/docs/jobs), [termos](https://app.auray.ai/terms). As páginas comerciais estavam divergentes; vale a política da conta e API conferida em cada chamada, não um banner antigo de 100 créditos ou oferta ilimitada.
