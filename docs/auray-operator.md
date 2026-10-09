# Auray: avaliação automática de uma fonte candidata

Status em 09/10/2026: conector implementado e testado offline; contrato público conferido; **sem chave, saldo autenticado, vídeo gerado ou aprovação artística**. Não habilita carteira nem fallback no Studio. Modal continua sendo a única direção audiovisual anteriormente aprovada; sua execução de produção também depende das verificações descritas em `modal-operator.md`.

## Conectar uma vez

1. Entre em [Auray](https://app.auray.ai/) e mantenha o plano **Free**. Confirme o e-mail. Não selecione teste de plano pago, compra de créditos ou checkout.
2. Em **Settings → API Keys**, crie uma chave com `video:write`. `jobs:read` e `assets:read` são incluídos pelo serviço. Desative as demais permissões que não serão usadas. Escolha validade e anote a data de expiração.
3. No campo **Cap**, informe **5 créditos por mês**, um limite fixo para a primeira avaliação. Campo em branco acompanha o plano; zero não significa gasto zero. O conector recusa um limite diferente de cinco nesta etapa.
4. Guarde a chave como `AURAY_API_KEY=...` no `.env.cloud` ignorado deste projeto, ou na variável de ambiente do executor. Não cole no chat, não envie ao navegador e não versione o arquivo.

O serviço atualmente informa 50 créditos mensais no plano Free. A API compartilha a carteira com o aplicativo. O conector consulta o contrato e preço públicos e a conta autenticada antes de cada submissão; uma franquia publicada não é saldo da conta. Planos pagos, trials, promoções temporárias, carteiras com créditos comprados/concedidos, período anterior, preço alterado, e-mail não confirmado ou carteira incompleta bloqueiam a avaliação. Não compra nem recarrega saldo.

```powershell
node --experimental-strip-types scripts/render-auray-story-shot.mts --inspect
```

Sem chave, retorna `missing_api_key`, capacidade desconhecida e produção desabilitada, sem nenhuma chamada HTTP. Inspeção com chave faz somente leituras. O relatório fica em `output/auray-video-jobs/inspection.json`, ignorado pelo Git; não publica conta, chave ou saldo no painel.

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

## Critério para entrar em uma novela

Um clipe decodificado continua `review_pending`; resolução e FPS de arquivo não comprovam fluidez ou continuidade. Assistir todos os segundos e conferir personagens, roupa, cenário, olhos, anatomia das mãos, emoção e movimento. Ausência de fala neste teste é intencional. Não substitui as tomadas de diálogo com nossas vozes aprovadas. O hash identifica o contrato da API e a versão do conector; Auray não expõe uma revisão imutável dos pesos para atestar identidade por hash.

Somente após aprovação visual, verificação da licença aplicável e integração da identidade/capacidade da conta com a carteira de produção será possível considerar ação/reação compatível. A fonte não acrescenta segundos nem capítulos disponíveis ao Studio hoje. Os termos da Auray condicionam uso comercial à licença do modelo e exigem atribuição MiniMax e indicação de IA; a origem fica registrada no QA. Não publicar automaticamente esta avaliação.

Fontes oficiais consultadas em 09/10/2026: [créditos](https://auray.ai/docs/credits), [planos e preços ao vivo](https://api.auray.ai/v1/plans), [autenticação e limites](https://auray.ai/docs/authentication), [contrato do modelo](https://api.auray.ai/v1/models/auray-ai/minimax-h3/text-to-video/openapi.json), [uploads](https://auray.ai/docs/uploads), [jobs](https://auray.ai/docs/jobs), [termos](https://app.auray.ai/terms). As páginas comerciais estavam divergentes; vale a política da conta e API conferida em cada chamada, não um banner antigo de 100 créditos ou oferta ilimitada.
