# ADR-067 — Close gratuito com FlashHead, HLS e voz original

Data: 2026-10-08. Status: adaptador experimental implementado e testado; prévia visual pendente de aprovação editorial. Complementa ADR-066.

## O — Objetivo

Adicionar uma rota renovável e de custo monetário zero para tomadas **novas** de diálogo da novela, preservando personagem e voz, sem consumir o saldo curto do Modal. Manter separadas a prévia técnica e a qualidade exigida para um capítulo completo.

## C — Contexto

Isto já existe em `packages/core/src/stories/video-routing.ts`: tipos de tomada, qualidade, grupo de quota, validade, cooldown, custo em dinheiro e recusa de gratuidade não recorrente. Isto já existe em `apps/local-renderer/src/free-video-provider.ts` e `scripts/render-free-story-shot.mts`: inspeção de revisão/endpoints, upload autorizado, checkpoint antes da chamada sem idempotência, espera pelo mesmo ID, QA e revisão humana. O renderer já aceita `video_clip`. Reutilizar esses contratos; nenhum estado novo de episódio ou migração.

O Space [SoulX FlashHead Lite](https://huggingface.co/spaces/khuong2532002/soulx-flashhead-demo) roda em [ZeroGPU gratuito com quota diária compartilhada](https://huggingface.co/docs/hub/spaces-zerogpu), oferece modelo [Apache-2.0](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B) e endpoint de imagem+áudio. Uma primeira execução autenticada gerou evento HLS, mas o avaliador recusou o endereço por aceitar apenas MP4; a desconexão terminou a geração com erro. Reenviar o mesmo ID seria incorreto. A segunda execução, com coleta HLS corrigida, produziu vídeo de fato.

Correção crítica: Gradio devolve playlist e segmentos de vídeo, não um MP4 único. O áudio desses segmentos mediu atraso de 64 ms e correlação 0,911 com o WAV original. Um MP4 decodificável não prova voz preservada nem sincronia. FlashHead também é close 512×512; não substitui o Wan S2V que animou corpo/cenário. FPS de arquivo não comprova gestos completos.

## S — Solução

1. Registrar `hf-flashhead-lite` no adaptador HF, com Space/revisão/host/endpoint/parâmetros fixos, tipo `dialogue`, qualidade somente `preview`, 512×512/25 FPS e o **mesmo** `huggingface-account`/ledger de I2V e MuseTalk. S2V patrocinado segue bloqueado para novos envios por falta de recorrência comprovada.
2. Aceitar apenas playlist HLS do host fixado e caminho Gradio estrito. Exigir lista terminada, até 32 segmentos `.ts` com nomes UUID e limite de 64 MB. Baixar cada segmento do mesmo diretório/host, sem redirecionar, e remuxar bytes locais com FFmpeg; não entregar token ou URL remota ao processo. Recusar contrato alterado. Preservar o ID aceito e retomar sem nova submissão.
3. Na prévia, guardar o bruto e normalizar a duração/tempo de vídeo com a **voz original** condicionante. O QA existente compara PCM da faixa final com o WAV, verifica codec, decode, resolução, FPS e cobertura temporal. A verificação automática não aprova fonemas, expressão, mãos ou continuidade.
4. Escolher FlashHead para diálogo novo no avaliador isolado. Na retomada, detectar fingerprint legado S2V e preservar seu checkpoint. MuseTalk continua seleção explícita. O Studio não recebe esta rota como master nem publica o teste.
5. Contabilizar as duas chamadas externas desta pesquisa no limite local compartilhado de 08/10. Não alterar o ledger para abrir mais cota.
6. Compor também uma prévia local com o close FlashHead e a reação I2V já existente, mantendo fontes/hashes e auditoria explícitos. Não confundir reuso de reação com novo capítulo.

## P — Prova

- Autenticação HF conferida por `whoami-v2`, sem expor o token no log. Duas submissões curtas na conta do operador; uma falhou após evento HLS por contrato do avaliador, a seguinte completou. Nenhuma chamada ao Modal.
- Artefato de Malu: `output/provider-research-deep-2026-10-08/flashhead-audition-2/normalized.mp4`. FFprobe: 512×512, 25 FPS, 82 quadros, 3,28 s; vídeo/áudio iniciam em 0. A auditoria de transporte mediu atraso 0 e correlação 0,999916 com o WAV de 3,25 s. FFmpeg decodificou todos os quadros; contato visual amostrado mostra pele/cabelo/roupa estáveis. Sincronia labial fonética e atuação continuam pendentes de revisão humana.
- O adaptador novo baixou novamente a playlist já concluída e produziu o mesmo hash SHA-256 do remux local de referência, sem nova GPU. Teste de integração local cobre HLS com dois segmentos, decode real, mesma origem/autorização, manifesto incompleto e tentativa de atravessar diretório.
- A montagem `--flashhead` produziu `output/free-story-sequence-flashhead/a-mala-acao-fala-reacao-flashhead.mp4`: 6,817 s, 480×832, 409 quadros codificados a 60 FPS, três cortes, duas origens gratuitas. A voz no corte mediu atraso zero e correlação 0,999904. Parte dos quadros foi duplicada ao adequar 16/25 FPS para 60 FPS; isso não aumenta a atuação nativa.
- 125 testes do core e 45 do renderer passaram; typecheck do renderer passou. A montagem original, sem `--flashhead`, foi executada novamente e permaneceu funcional. Inspeção remota autenticada marcou os quatro endpoints conferidos e preservou o S2V como `free_tier=unknown`. Retomada de job legado S2V encontrou o mesmo fingerprint e recusou sua falha terminal sem reenviar.
- Não houve novo episódio, asset de banco, Telegram, publicação, deploy ou promoção da prévia a master. A quantidade de capítulos gratuitos por mês permanece desconhecida até haver um provedor de atuação corporal de qualidade aprovada e medição da quota debitada.
