# Avaliação gratuita de clipes

Ferramenta do operador, fora da produção do Studio. Gadgets e histórias ilustradas seguem seus fluxos atuais. Os testes não são episódios nem publicações.

## Conferir as rotas

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --inspect
```

Consulta dois apps públicos. `available` significa endpoint/modelo conferido; não significa quota contratada nem qualidade aprovada. O contador externo permanece desconhecido. Não precisa instalar GPU/modelo local. Opcionalmente, `HF_TOKEN` pode ficar em `.env.cloud`; nunca em arquivo versionado, URL ou código do navegador. Um token só autentica a própria quota, não multiplica capacidade.

## Avaliar ação e diálogo

Os planos abaixo reutilizam referências próprias e WAV já existentes em `output/suitcase-story-preview`. Um clone do repositório sem esses assets não tem os pré-requisitos: o executor recusa ausência/hash diferente.

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --run docs/stories/free-action-audition.json
node --experimental-strip-types scripts/render-free-story-shot.mts --run docs/stories/free-dialogue-audition.json
```

O tipo da tomada seleciona automaticamente I2V para ação/reação ou S2V para diálogo. Não usar a primeira rota para simular lipsync. O S2V público só recebe imagem/áudio/resolução, não o prompt de movimento nem seed; sua descrição é contexto editorial. A saída é uma avaliação de 480p. Não é troca automática da qualidade já aprovada.

Arquivos/checkpoints ficam em `output/free-video-jobs/<hash>/`. `events.jsonl` informa aceitação/pronto/bloqueio. Cada grupo tem limite local de duas submissões por dia UTC, independente da quota externa; mudar de Space/token não renova esse limite. Não gera em duplicidade, não usa Modal, não acrescenta método de pagamento. Apenas serviços públicos autorizados, sem scraping.

## Retomar e revisar

Se houver identificador externo salvo, retome o mesmo plano:

```powershell
node --experimental-strip-types scripts/render-free-story-shot.mts --resume docs/stories/free-dialogue-audition.json
```

Sem identificador após envio incerto, não reenvie: concilie antes. Resultado pronto é reutilizado por hash. Se o processo terminar abruptamente com `provider.lock`, confira o PID e o estado do job antes de remover o lock órfão; não remova durante processamento. Nunca altere o ledger para contornar limite externo.

Pode limitar uma consulta a `--wait-seconds=30`. Isso apenas consulta a mesma chamada; não cancela nem reenvia uma inferência. Erro terminal exige inspeção, não nova tentativa automática. O teste S2V desta rodada falhou após aceitação, portanto essa rota ainda não comprova produção gratuita de diálogos. A rota I2V gerou a reação corporal em cerca de um minuto, mas continua em avaliação de qualidade.

`qa.json` verifica transporte/decode/cobertura/resolução/FPS codificado e registra revisão pendente. Assistir todos os segundos e conferir identidade, oclusões, mãos, emoção, início/fim da ação e fala/boca. FPS de arquivo não comprova FPS nativo ou poses novas. Aprovação audiovisual continua humana.

O novo avaliador `assessStoryCoverage` do core mede cobertura no modo `animated_story`; câmera digital não conta como atuação. Ele não está integrado ao gate de produção. Dois resultados de teste não comprovam um capítulo inteiro, disponibilidade contínua ou escalabilidade gratuita para todos os clientes.
