# ADR-058 — Revisão de atuação em cena sem nova GPU

Data: 2026-10-07. Status: QA técnico aprovado; qualidade do trecho assistido aceita pelo operador, com melhorias de direção solicitadas. Revisão integral pendente.

## O — Objetivo

Entregar outro teste útil enquanto o saldo gratuito está perto do fim, sem gastar créditos apenas para repetir a mesma amostra. Avaliar o gesto ampliado no contexto de uma conversa, preparando a decisão sobre a novela.

## C — Contexto

O operador informou US$ 11,70 restantes e perguntou se seria necessário pausar ou se caberia outro teste visando produção no mês seguinte. Esse valor é informado pelo operador, não saldo consultado via API. O benchmark do ADR-057 foi preparado, mas não executado; continua sem nova chamada.

Isto já existe em `scripts/render-story-conversation.py`, `scripts/assemble-story-conversation.mts` e `scripts/audit-story-conversation.py`: tomadas com áudio condicionado, checkpoint, legendas do core, concatenação precisa, master e QA de conversa. A cena de 17,2 s do ADR-053 teve aparência/sincronização aprovadas, com pedido de mais atuação. O ADR-056 já produziu a mesma fala 07 com gesto ampliado, sem revisão humana final. Reutilizar esse material em vez de criar outra inferência desnecessária.

Uma prévia curta aprovada não prova um capítulo inteiro perfeito ou integração com o Studio. Contrato de episódio continua com mínimo de 60 s. Não prometer produção automática somente porque o crédito mensal renova.

## S — Solução

Adicionar preparação `--prepare-guided-review` ao script existente, em pasta nova `output/guided-acting-conversation/`. Reutilizar as quatro tomadas: 06/08/09 da conversa anterior, 07 do gesto ampliado. Manter narração, duas vozes, imagem, durações e eixo de diálogo. Não há fala, gesto ou animação nova; a novidade é a montagem contextual com a variante já gerada. Não transferir a aprovação do controle para a variante.

Antes de criar a pasta: conferir revisão/hash do master anterior, hash dos arquivos/áudio, referências, prompts, seed, modelos, passos, quadros/FPS e guia da substituição. Rejeitar pasta existente para preservar revisões/evidências. Gravar origem por tomada e `new_worker_seconds=0`, `new_gpu_calls=0`. Nenhum acesso a credenciais, Modal, novas TTS/imagens, banco, episódio ou Telegram.

Assembler e auditor recebem perfil limitado `--guided-acting`; o caminho padrão permanece o anterior. Reutilizar helpers de legendas do core, concat e escape FFmpeg. Preservar as pausas medidas, sem acelerar áudio, criar movimento sintético extra, interpolar cortes ou estender com loops. Master em 60 fps de entrega, provenientes dos clipes experimentais interpolados; não confundir 60 fps com 60 poses independentes geradas. Custo adicional Modal desta montagem: zero chamadas, zero tempo de worker; renderização/QA local consomem recursos do computador do operador, não dos futuros clientes. Isso é preparação experimental, não a arquitetura de produção para usuários móveis.

Continuar correções locais e integração sem inferência quando apropriado; decidir novas tomadas de GPU a partir do feedback específico do operador. Publicação continua dependendo de aprovação humana. Antes da produção: validar capítulo >=60 s, custo/cota de ponta a ponta, integração durável com jobs/assets/Studio e revisão do resultado. Este ADR não implementa esses itens nem habilita publicação.

## P — Prova

Prévia 17,200 s, 704 × 1280, 1.032 quadros a 60 fps, duas vozes e legendas. SHA `ac18bbadaf2027b668733928c8729f909200227c1e55d3e35f9d1ad27b7f9a4e`. Decode, hashes, origens de áudio/vídeo e cortes passaram. Atraso de transporte de áudio medido 0 s, correlação PCM 0,994924226; erro máximo de timestamps 0,000000333 s; master −15,9 LUFS / pico −1,8 dBFS. QA não certifica fonemas, emoção ou anatomia. Inspeção da folha de 12 momentos confirmou personagens, legendas e sequência esperados; reprodução/revisão humana permanece pendente.

Dois novos testes protegem evidência existente e rejeitam master original alterado antes de criar pasta ou acessar credenciais. Total de 29 testes locais passou. Compilação Python e execução real do assembler passaram, sem CI remota. Nenhuma GPU foi acionada nesta rodada. Master e tomadas anteriores preservados, sem banco/episódio/publicação/ativação de produção.

### Feedback do operador

Operador: “ficou muito bom”, qualificando que avaliou poucos segundos, e solicitando mais gestos corporais e cenas diferentes; notou sobretudo movimento da cabeça e da mão. Registrar em `output/guided-acting-conversation/operator-review.json`, vinculado ao SHA acima. Aceitação limitada ao trecho assistido; não marcar revisão completa dos 17,2 s, anatomia/fonemas certificados ou publicação autorizada. Nenhuma inferência gerada ao registrar o feedback. Próxima direção planejada no ADR-059: atuação corporal e cobertura cinematográfica, mantendo a base visual aceita.
