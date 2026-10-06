# ADR-050 — Clipes de vídeo como visuais de cena

Data: 06/10/2026. Status: implementado no código local; sem habilitação de geração animada no Studio.

## O — Objetivo

Permitir que uma tomada animada aprovada entre na montagem existente com TTS, legendas, trilha, checkpoints e QA. Preservar o fluxo de imagens para pautas comuns.

## C — Contexto

Isto já existe no contrato do banco: `assets.type='video_clip'`. Entretanto, `apps/local-renderer/src/render.ts` baixava todos os visuais como imagens e aplicava zoompan. Não havia leitura temporal do clipe. Não criar nova tabela, estado editorial ou outro renderer de montagem.

O experimento Wan do ADR-049 testa uma tomada curta; ele não substitui o mínimo editorial de 60 segundos nem é suficiente para um episódio. A licença do modelo e a aprovação da referência não comprovam qualidade artística, boca sincronizada ou continuidade entre cenas.

## S — Solução

O renderer consulta o tipo do asset cuja URL está explicitamente em `scene.asset_portrait` ou `scene.asset_landscape`. Clipes exigem uma única linha `video_clip` com `metadata.scene_order` e `metadata.orientation` correspondentes. Não escolher um clipe antigo apenas porque possui a mesma ordem. URLs ambíguas ou vínculo incorreto interrompem o render.

`clip-render.ts` concentra seleção, cobertura e filtro FFmpeg. A faixa de vídeo medida deve cobrir narração mais intervalo. Não usar duração do contêiner, que pode conter uma cauda de áudio; não repetir, desacelerar nem congelar longamente uma amostra curta para preencher a cena. Resampling pode preencher até um quadro na extremidade, após validação da cobertura.

O clipe roda a 30 fps na montagem, sem zoompan, com ajuste proporcional e barras quando necessário para preservar o elenco. O áudio original é descartado; a narração e legendas existentes são usadas. Este incremento mantém cortes entre cenas; não implementa dissolve com sobreposição ou transições narrativas novas. Clips horizontais e verticais exigem registros e URLs próprios por orientação.

Checkpoints registram `visual_types` em `job_events`; hash do render já inclui roteiro, assets e configuração. A indicação de mídia ilustrativa usa a fonte da orientação correta e distingue vídeo de imagem. Estados, aprovação, mínimo de duração e publicação seguem o contrato existente.

## P — Prevenção e validação

- Testar vínculo exato, referência antiga, orientação incorreta e colisão imagem/clipe.
- Reprovar clipe curto mesmo quando o contêiner informa duração longa.
- Executar FFmpeg real com vídeo em movimento e áudio próprio; conferir enquadramento, 30 fps, duração, narração substituindo o áudio original e decodificação completa.
- Executar a suíte do renderer, incluindo imagens, música, QA e publicação idempotente, e checagem TypeScript.
- Não habilitar animação no painel automaticamente. Faltam geração de referências por API do produto, jobs duráveis de geração, reserva de orçamento e validação artística do capítulo completo.
- Nenhum episódio criado, pauta consumida, mudança no banco ou publicação neste incremento.
