# ADR-025 — QA audiovisual e revisão com evidências

## Objetivo

Impedir que arquivos finais tecnicamente inválidos concluam o render e tornar a revisão humana mais informativa, sem serviços adicionais.

## Contexto

O piloto privado chegou ao YouTube em 14/09/2026. O renderer verificava a duração do áudio de entrada, mas promovia os finais para `rendered` sem conferir faixas, resolução ou decodificação. A concatenação reutiliza checkpoints e precisa detectar arquivos incompletos. Além disso, o dossiê mencionava exclusivamente Google Search/Gemini mesmo quando as fontes vinham do Tavily, e apresentava apenas links.

## Solução

- FFprobe verifica exatamente uma faixa H.264/yuv420p a 30 FPS médios (tolerância de 1% devido aos timestamps de concatenação/AAC), uma faixa AAC, dimensões previstas, tamanho positivo e durações válidas em ambos os formatos. A fixture com duração fracionada reportou `r_frame_rate=240` e média próxima de 30; a validação usa a média de apresentação.
- Comparar duração final à soma dos checkpoints e duração de cada faixa ao contêiner, com tolerância de 250 ms para arredondamento de frames/AAC. Comparar também as duas orientações.
- FFmpeg decodifica o arquivo completo com `-xerror` antes do upload final. Aguardar ambos os processos mesmo quando um falha, evitando apagar arquivos de um processo ainda ativo.
- Somente após os dois resultados válidos enviar os finais e promover `assets → rendered`. Falhas seguem o caminho existente para `failed`.
- Registrar resultados versionados em `metadata.render_outputs.quality`. Diferença superior a 20% entre duração real e alvo editorial gera alerta, sem alterar velocidade da voz nem aprovar qualidade estética.
- Exibir medidas e alertas no dossiê; incluir provedor correto, data da coleta e até 1.200 caracteres por trecho Tavily citado. Confiança do modelo não equivale a verificação factual.

## Impacto e limites

Sem migrations, novos estados, infraestrutura, chamadas a modelos ou reprocessamento do piloto aprovado. A verificação adiciona leitura e decodificação no runner existente; ainda é necessário medir o custo em tempo num episódio longo. Não detecta silêncio, dicção ruim, imprecisão factual, direitos de imagem ou legenda mal posicionada. O limite de tamanho por objeto permanece responsabilidade da configuração Storage; esta etapa só verifica tamanho positivo.

Snapshots antigos continuam revisáveis e dizem explicitamente que não possuem QA técnico registrado. Não são retroativamente certificados. Dados de qualidade são informações auxiliares; o gate de aprovação e os hashes existentes permanecem em vigor. Trechos recuperados podem ser parciais e não substituem abrir a fonte original.

## Prevenção e validação

Testes unitários cobrem áudio ausente/truncado, codecs, FPS, resolução, duração, tamanho e divergência entre variantes. A fixture real FFmpeg verifica dois renders, relatórios, retomada de checkpoints e rejeição de MP4 legível sem faixa de áudio, sem novo arquivo final ou evento de conclusão. Testes do dossiê cobrem snapshots antigos e evidências Tavily.

Rollback: reverter este commit. Os metadados adicionados são opcionais e compatíveis com leitores anteriores. Nenhuma aprovação existente é modificada.
