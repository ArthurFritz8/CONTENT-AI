# ADR-063 — Avaliação de boca sincronizada e montagem com mídia existente

Data: 2026-10-07. Status: implementação e avaliação local; animação automática do Studio continua desabilitada.

## O — Objetivo

Testar fala sincronizada gratuita sem gastar Modal, preservando o visual aprovado. Entregar uma prévia de continuidade entre ação, fala e reação sem fingir que um resultado antigo comprova a nova alternativa.

## C — Contexto

Isto já existe em `apps/local-renderer/src/free-video-provider.ts` e `scripts/render-free-story-shot.mts`: Gradio com catálogo/revisão fixos, download restrito, checkpoint, bloqueio, quotas e retomada sem submissão duplicada (ADR-062). Isto já existe em `scripts/assemble-story-conversation.mts`: montagem artística com voz original, core ASS e helpers FFmpeg. O renderer de produção já aceita `video_clip`; não recriar essa capacidade nem modificar estados de episódios.

O operador aprovou o gesto I2V e autorizou testar fala e uma sequência. O S2V público anterior falhou. Há uma fala Modal anterior auditada de Malu; reutilizá-la não consome saldo novo, mas não apaga seu custo histórico. Não gerar outra chamada Modal ou publicar.

## S — Solução

1. Acrescentar perfil experimental MuseTalk 1.5 (`henrybit/musetalk-1-5`), revisão `1bd58b7748557839bb585cb8ab6dd1399b80fcf9`, endpoint `generate`, hardware ZeroGPU. Conferir ordem de parâmetros e retorno de vídeo+texto, reutilizando o transporte existente. Seleção explícita `--provider=hf-musetalk`, somente para diálogo; não alternar após timeout/falha automaticamente.
2. Classificar como edição de boca sobre PNG, não gerador de atuação corporal. API não oferece prompt/seed. Fonte usa região facial 256×256 e saída 25 FPS, com limitações de identidade/jitter. Licença MIT do código e permissão comercial do modelo não transformam o Space comunitário em infraestrutura contratada. Avaliar imagem própria e WAV original de 3,25s; manter `preview`, sem promover `approved_master`.
3. MuseTalk e I2V compartilham grupo `huggingface-account` e `quota.json`, incluindo cooldown e duas submissões locais/dia UTC. Não renovar quota ao trocar Space. Não assumir que esse contador local revela saldo real do provedor. Autenticação opcional em `.env.cloud`; nenhuma compra/conta extra para multiplicar quota.
4. Corrigir a conferência do CLI para medir a duração da faixa de vídeo, em vez de permitir que a cauda de áudio esconda cobertura visual insuficiente. Reutilizar auditor PCM; transporte de áudio não certifica fonemas.
5. Criar harness isolado `scripts/assemble-free-story-preview.mts`, com hashes/QA dos inputs, core ASS e helpers FFmpeg já usados. Plano: 0,5s conjunto → 3,25s pergunta de Malu → 3,067s reação. O início termina antes do gesto de braços, deixando esse gesto responder à pergunta. Reutilizar segmentos sem sobreposição da mesma ação e a tomada Modal existente; não gerar nova atuação, mudar velocidade ou repetir a ação. Montagem 480×832, 60 FPS codificados; conversão do I2V duplica quadros e não aumenta FPS nativo. Voz original entra no instante exato do corte e é revalidada após montagem. Sem episódio, banco, consumo de candidato, Telegram ou publicação.

Correção crítica: não anunciar “fala gratuita resolvida” com um download inexistente nem mostrar mídia Modal reutilizada como resultado do MuseTalk. Não insistir em chamada terminal ou contornar os limites. O Studio permanece desabilitado para animação até haver qualidade, disponibilidade e execução durável comprovadas.

## P — Prova

Chamada real MuseTalk aceita às 23:37:57 UTC; evento `15113e90a3c4497f8d78dc3122dbf2c3`, job local `7d1b8fc35e883dc31c4d4871256f714e7a2c299279ee377c8ebe5c47b195906a`. Devolveu evento de erro terminal em menos de um segundo, sem vídeo. Uma consulta ao MESMO identificador confirmou erro sem diagnóstico de quota/autenticação/face identificável. Não reenviar. Estado bloqueado, cooldown e limite local registrados. Acesso anônimo; `HF_TOKEN` não configurado. Autenticar no futuro pode melhorar a quota, mas não é correção comprovada da falha interna.

Prévia local concluída: 6,816667s, 409 quadros, 480×832, três cortes. A voz original foi preservada; auditor de transporte retornou atraso zero e correlação PCM >0,9998. Decode e contagem de quadros passaram. Folha temporal examinada; revisão humana e revisão de sincronização fonética continuam necessárias. Nenhuma nova chamada de geração na montagem. Nenhum crédito Modal gasto nesta rodada.

40 testes renderer passaram, incluindo quota compartilhada, contrato de endpoint/retorno, ordem áudio→imagem, ausência de controles inexistentes e recusa de ação pelo MuseTalk. Typecheck renderer e CLI passaram. Não houve mudança no painel/Edge, CI remoto ou deploy.

## Fontes verificadas

- [MuseTalk oficial](https://github.com/TMElyralab/MuseTalk): funcionamento, limitações de região facial/identidade/jitter, licença do código/modelo e dependências.
- [Space comunitário](https://huggingface.co/spaces/henrybit/musetalk-1-5), [app.py](https://huggingface.co/spaces/henrybit/musetalk-1-5/blob/main/app.py): parâmetros reais, geração de boca, FPS, reserva de GPU e integração de áudio.
- [ZeroGPU oficial](https://huggingface.co/docs/hub/spaces-zerogpu): quota diária por identidade; janela real não equivale ao nosso dia UTC.
- [API de Spaces](https://huggingface.co/docs/hub/spaces-api-endpoints): autenticação e consumo da quota da conta.
