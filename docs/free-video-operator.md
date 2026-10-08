# Avaliação gratuita de clipes

Ferramenta do operador, fora da produção do Studio. Gadgets e histórias ilustradas seguem seus fluxos atuais. Os testes não são episódios nem publicações.

Política vigente desde ADR-066: somente gratuidade recorrente ou serviço gratuito comprovado entra no roteador. Créditos introdutórios são recusados com `non_recurring_offer`; recorrência não comprovada com `unverified_free_access`. A classificação não substitui saldo, qualidade, quota, revisão ou ausência de cobrança.

## Conferir as rotas

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --inspect
```

Consulta quatro apps públicos. `available` significa endpoint/modelo conferido; não significa quota contratada nem qualidade aprovada. O contador externo permanece desconhecido. Não precisa instalar GPU/modelo local. `HF_TOKEN` fica em `.env.cloud`; nunca em arquivo versionado, URL ou código do navegador. Um token só autentica a própria quota, não multiplica capacidade.

## Avaliar ação e diálogo

Os planos abaixo reutilizam referências próprias e WAV já existentes em `output/suitcase-story-preview`. Um clone do repositório sem esses assets não tem os pré-requisitos: o executor recusa ausência/hash diferente.

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --run docs/stories/free-action-audition.json
node --experimental-strip-types scripts/render-free-story-shot.mts --run docs/stories/free-dialogue-audition.json
```

O tipo da tomada seleciona I2V para ação/reação ou FlashHead Lite para um close de diálogo. FlashHead recebe imagem, WAV e seed; o texto de direção é contexto editorial e não controla gestos, roupa ou cenário. A saída nativa é quadrada de 512×512 a 25 FPS. O avaliador recompõe a faixa de áudio com o WAV original, recorta a duração à fala medida e exige auditoria de transporte. Isto não substitui a qualidade da novela aprovada nem anima o corpo inteiro.

Novas submissões ao S2V patrocinado ficam bloqueadas: não há prova de franquia recorrente. `available: true` na inspeção não o libera. Checkpoints anteriores continuam conciliáveis com `--resume` e seu fingerprint original; nenhuma chamada aceita é reenviada. ZeroGPU I2V/MuseTalk/FlashHead compartilham a quota da mesma conta. MuseTalk continua sem resultado visual aprovado.

Em 08/10/2026, uma tomada FlashHead Lite da Malu foi gerada no Space público com o WAV existente: 3,28 s normalizados, 512×512, 25 FPS, 82 quadros. O remux HLS puro atrasou a voz 64 ms e obteve correlação PCM 0,911; a recomposição com o WAV original reduziu o atraso medido a zero e elevou a correlação a 0,9999. A inspeção dos quadros encontrou identidade/figurino estáveis, mas isto não certifica sincronia fonética nem a atuação do capítulo. Arquivo local para revisão: `output/provider-research-deep-2026-10-08/flashhead-audition-2/normalized.mp4`. Não registrar como master aprovado.

MuseTalk 1.5 é uma avaliação explícita de boca, não uma troca automática após falha:

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --run docs/stories/free-lipsync-audition.json --provider=hf-musetalk --wait-seconds=45
```

Recebe o PNG e o WAV já existentes e não cria gestos/cenários nem recebe prompt/seed. O Space aplica edição de rosto de 256×256 sobre o quadro original, com saída a 25 FPS. Pode perder detalhes de boca, pele e identidade. Usa o MESMO `quota.json` e grupo ZeroGPU do I2V: trocar o endpoint não gera saldo. A primeira chamada foi aceita e devolveu erro terminal antes de gerar arquivo; causa não informada. Não repetir esse job nem declarar lipsync validado.

Arquivos/checkpoints ficam em `output/free-video-jobs/<hash>/`. `events.jsonl` informa aceitação/pronto/bloqueio. Cada grupo tem limite local de duas submissões por dia UTC, independente da quota externa; mudar de Space/token não renova esse limite. As duas chamadas de pesquisa FlashHead em 08/10 foram contabilizadas nesse ledger. Não gera em duplicidade, não usa Modal, não acrescenta método de pagamento. Apenas serviços públicos autorizados, sem scraping.

## Retomar e revisar

Se houver identificador externo salvo, retome o mesmo plano:

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --resume docs/stories/free-dialogue-audition.json
```

Sem identificador após envio incerto, não reenvie: concilie antes. Resultado pronto é reutilizado por hash. Se o processo terminar abruptamente com `provider.lock`, confira o PID e o estado do job antes de remover o lock órfão; não remova durante processamento. Nunca altere o ledger para contornar limite externo.

Pode limitar uma consulta a `--wait-seconds=30`. Isso apenas consulta a mesma chamada; não cancela nem reenvia uma inferência. Erro terminal exige inspeção, não nova tentativa automática. O teste S2V patrocinado anterior falhou após aceitação. A rota I2V gerou uma reação corporal em cerca de um minuto, mas continua em avaliação de qualidade. FlashHead Lite passou no transporte e na inspeção inicial de quadros; continua restrito à prévia até revisão audiovisual da fala, gestos e integração em uma história completa.

`qa.json` verifica transporte/decode/cobertura/resolução/FPS codificado e registra revisão pendente. Assistir todos os segundos e conferir identidade, oclusões, mãos, emoção, início/fim da ação e fala/boca. FPS de arquivo não comprova FPS nativo ou poses novas. Aprovação audiovisual continua humana.

O novo avaliador `assessStoryCoverage` do core mede cobertura no modo `animated_story`; câmera digital não conta como atuação. Ele não está integrado ao gate de produção. Dois resultados de teste não comprovam um capítulo inteiro, disponibilidade contínua ou escalabilidade gratuita para todos os clientes.

## Montagem sem novas chamadas

```powershell
node --experimental-strip-types scripts/assemble-free-story-preview.mts
node --experimental-strip-types scripts/assemble-free-story-preview.mts --flashhead
```

O primeiro comando mantém a prévia anterior com diálogo Modal. `--flashhead` monta uma segunda prévia de 6,817 s com **apenas tomadas geradas em rotas gratuitas**: reação I2V anterior e fala FlashHead desta pesquisa. Guarda resultado em `output/free-story-sequence-flashhead/a-mala-acao-fala-reacao-flashhead.mp4`. O WAV, os hashes, os 409 quadros, decode e transporte temporal são conferidos; a fala final teve atraso medido zero e correlação PCM 0,9999. Os 60 FPS são formato de montagem: I2V parte de 16 FPS e FlashHead de 25 FPS, portanto há duplicação de quadros, sem novos gestos. Nenhum comando gera um episódio, chama GPU novamente, escreve banco, Telegram ou publicação. A reação foi reutilizada e o close ainda requer revisão artística; não declarar história inteira nova ou qualidade master aprovada.

## Preparar acesso autenticado para uma futura avaliação

Crie/use sua própria conta gratuita em [Hugging Face](https://huggingface.co/join), confirme o email e crie um token pessoal em [Settings → Access Tokens](https://huggingface.co/settings/tokens), com acesso suficiente para chamar Spaces públicos. Salve apenas `HF_TOKEN=...` em `.env.cloud`, que é ignorado pelo Git. Não envie pelo chat. Não é necessário adicionar cartão ou contratar PRO. Consulte a [documentação de API dos Spaces](https://huggingface.co/docs/hub/spaces-api-endpoints) para as permissões atuais.

Autenticar associa a chamada à quota da conta. Não garante que todos os Spaces funcionem; cada rota precisa de prova visual e de duração. Não alterar o ledger para forçar outra tentativa. A quota real ZeroGPU segue a janela do provedor, não o dia UTC do nosso limite preventivo. [Regras atuais de quota](https://huggingface.co/docs/hub/spaces-zerogpu).

## Mini-história com uma reserva de créditos Modal

O [ADR-064](ADR/ADR-064-mini-historia-completa-com-uma-reserva.md) registra a autorização para uma única revelação nova, preservando os modelos/parâmetros anteriores. Esta seção consome créditos Modal; não é prova de fala gratuita. As referências/WAVs/checkpoints originais devem existir. Preparar sem acesso a credenciais:

```powershell
python -X utf8 scripts/render-complete-mini-story.py
```

A geração autorizada usa `--run --credit-ceiling-usd 8`. O executor consulta o faturamento e usa o menor valor entre esse teto e a franquia mensal conservadora, reserva uma chamada e preserva US$1,50 de planejamento. Resultado completo é reutilizado; lock/reserva/falha/parcial bloqueiam nova chamada. Não remover marcadores para regenerar. A reserva de US$3,619864 não é garantia de teto de fatura.

Depois do take 05 concluir e passar no auditor, montar e conferir:

```powershell
node --experimental-strip-types scripts/assemble-story-conversation.mts --complete-mini
python -X utf8 scripts/audit-story-conversation.py --complete-mini
python -X utf8 scripts/score-story-pilot.py --complete-mini
node --experimental-strip-types scripts/mix-mini-story-score.mts
python -X utf8 scripts/audit-story-conversation.py --complete-mini --score
```

Os arquivos ficam em `output/complete-mini-story/`, separados das alocações e masters anteriores. Há um master de voz limpa e outro com trilha própria discreta/ducking; o mixer copia o vídeo sem nova perda de qualidade visual. São três planos animados e três de câmera sobre imagens, 17,133s, fora do contrato >=60s dos episódios. A versão híbrida não passa pela política de animação de 80%; revisá-la como mini-história econômica, sem prometer capítulo totalmente animado. Não publica, não escreve banco e não ativa animação automática no Studio.
