# ADR-065 — Avaliação de alternativas ao Modal com qualidade preservada

Data: 2026-10-08. Status: pesquisa concluída; proposta de ampliação, sem habilitação de novas rotas em produção.

Atualização: o ADR-066 substitui a prioridade de créditos introdutórios pela exigência explícita do operador de gratuidade recorrente. Este ADR mantém o histórico da pesquisa; WaveSpeed/Alibaba/Lightning introdutórios não fazem parte da seleção vigente.

## O — Objetivo

Investigar métodos independentes do Modal que ampliem a produção gratuita das novelas humanizadas, preservando a qualidade aceita pelo operador. Diferenciar cota recorrente, crédito inicial, modelo aberto, endpoint público e capacidade realmente comprovada. A solicitação desta rodada é pesquisa aprofundada, não uma nova inferência.

## C — Contexto

O operador aprovou a mini-história do ADR-064. A referência inclui Wan2.2 S2V de 40 passos, voz fornecida, personagem fixado e RIFE; 60 FPS de entrega não correspondem a atuação nativa a 60 FPS. Parte do vídeo reutiliza animações e parte usa imagens; a aprovação não remove o contrato de cobertura de animação para capítulos completos.

**Isto já existe em `packages/core/src/stories/video-routing.ts`:** roteamento de tomadas por capacidade/qualidade, reserva, cota e proteção contra fallback após envio aceito ou incerto. **Isto já existe em `apps/local-renderer/src/free-video-provider.ts` e `scripts/render-free-story-shot.mts`:** adaptadores experimentais, checkpoints, retomada e limite preventivo por grupo. Reutilizar; não implementar mecanismo redundante nesta pesquisa.

O I2V gratuito já produziu ação, enquanto S2V público e MuseTalk tiveram falhas anteriores sem causa comprovada. A produção animada do Studio continua indisponível. Não acrescentar novos estados, consumir candidatos ou confundir endpoint saudável com validação audiovisual.

Correção crítica à ideia de alternância ilimitada: contas/Spaces podem compartilhar a mesma franquia; créditos iniciais não renovam necessariamente; entrada de áudio não comprova lipsync. Quantização/destilação mudam o método, e GPUs menores não substituem diretamente o worker que atingiu aproximadamente 53 GB de VRAM. Essas condições impedem anunciar produção gratuita contínua antes de demonstrá-la.

## S — Solução proposta

1. Manter o Modal como referência já demonstrada, preservando o saldo. Investigar WaveSpeed com Wan2.2 S2V para proximidade técnica; Alibaba com cotas iniciais de vídeo e Free Quota Only; Lightning como executor alternativo do mesmo modelo, condicionado a GPU, memória, armazenamento e crédito elegíveis.
2. Para recorrência, avaliar ação corporal própria + sincronização de boca com LatentSync/MuseTalk, e execução de InfiniteTalk/LongCat em GPU elegível. Reutilizar atuação somente quando for apropriada ao plano. Não afirmar economia ou fidelidade sem comparação.
3. Registrar separadamente grupo de cota, unidade, reset, validade, bloqueio de desembolso, versão do modelo e tarefa suportada. Novos adaptadores devem integrar o contrato existente e permanecer fora de `approved_master` até prova artística e técnica.
4. Preservar imagens e WAV por hash, identidade, voz e duração. Medir frames nativos, resolução efetiva, sincronização e anatomia. Revisão humana continua obrigatória; nenhuma comparação exclusivamente por FPS codificado libera a rota.
5. Não habilitar Colab gratuito como backend web automático. Não contar demos estáticas, Spaces em erro, grants não aprovados ou saldo de aplicativos separado da API como capacidade disponível. Verificar a licença LTX para um serviço universal antes de incluí-lo; não usar Wav2Lip não comercial como base do SaaS.
6. Se não houver rota gratuita aprovada com capacidade comprovada, aguardar e informar no painel. Não reduzir qualidade silenciosamente, cobrar excedentes, multiplicar contas ou reenviar jobs aceitos. Toda implementação futura reutiliza tipos, logger, tratamento de erro, eventos e estados existentes; novas decisões estruturais exigem ADR.

## P — Prova

Pesquisa registrada em [Alternativas ao Modal](../research/alternativas-video-gratuito-2026-10-08.md), com links primários e limites de cada método. Consultados schemas e runtime públicos e código fixado de Spaces, sem inferência. A inspeção identificou LongCat ativo pedindo 240s em GPU `xlarge`, reserva equivalente a 480s versus 300s gratuitos; portanto não foi classificado como rota gratuita pronta. LatentSync apresentou endpoint de vídeo/áudio com reserva declarada de 180s, ainda sem avaliação com o elenco.

As tabelas oficiais distinguem cotas iniciais Alibaba de 90 dias e ausência de oferta gratuita Wan2.2 S2V; WaveSpeed condiciona US$1 à elegibilidade; Lightning anuncia crédito inicial sem demonstrar uma reposição mensal garantida; ZeroGPU usa franquia compartilhada e reset 24h após primeiro uso. São evidências de elegibilidade potencial, não saldos autenticados.

Somente documentação foi adicionada. Nenhuma conta criada, segredo acessado, crédito consumido por inferência, integração habilitada, episódio gerado, envio Telegram, publicação ou deploy. Validação desta entrega: revisão das referências e `git diff --check`; testes de render/CI não se aplicam a uma pesquisa sem mudança de código. Antes de integrar qualquer rota, executar a ordem de avaliação descrita no relatório e registrar os resultados reais.
