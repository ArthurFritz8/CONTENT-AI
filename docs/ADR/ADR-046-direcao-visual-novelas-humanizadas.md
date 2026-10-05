# ADR-046 — Desenvolvimento visual de novelas humanizadas

Data: 2026-10-05. Status: decisão de pesquisa e sequência de validação; implementação visual e integração pendentes.

Complementado pelo [ADR-047](ADR-047-producao-nuvem-e-computador-opcional.md): a execução padrão do produto será remota, sujeita a validação de capacidade; o teste local não estabelece requisito de hardware para o cliente.

Atualização de desenvolvimento visual de 05/10/2026: após nova rejeição dos mascotes, foi criada uma imagem conceitual de Malu e Laranjito humanizados, com figurino, cabelo e rua brasileira detalhados. Evidência local: `output/humanized-fruit-concept/malu-laranjito-concept-v1.png`, com prompt e O.C.S.P. na mesma pasta. É bitmap gerado pela ferramenta de imagens da sessão, não render da cena Blender nem recurso implantado. O operador aprovou essa aparência como base; a identidade e os critérios estão na [referência visual v1](../stories/novela-frutas-visual-v1.md). Continuidade, animação e sincronização labial desse visual não foram comprovadas. O teste remoto do ADR-048 permanece uma prova técnica separada.

## O — Objetivo

Evoluir a ficção opcional do ADR-045 para personagens de frutas humanizados, com roupas, cabelo, cenário e atuação compatíveis com a direção visual apresentada pelo operador. Preservar produção factual, gratuidade de serviços e revisão humana.

## C — Contexto

A amostra local EEVEE prova render 3D básico, mas seus mascotes de geometria simples não satisfazem o alvo artístico. O problema não é resolvido apenas com resolução, mais amostras ou troca de API. O renderer de produção permanece baseado em imagens e não processa `video_clip`, apesar de o tipo existir.

Foi confirmado localmente um render mínimo Cycles/HIP na Radeon RX 6600, sem salvar preferências ou alterar o Studio. Isso não valida desempenho de uma cena final. A API Poly Haven respondeu a consultas de materiais/modelo/HDRI; MPFB, rig facial e reconhecimento labial continuam sem teste local. A análise, fontes, evidências e critérios constam em [pesquisa de 05/10](../research/novelas-humanizadas-2026-10-05.md).

## S — Solução

Adotar desenvolvimento visual progressivo para o próximo experimento: anatomia e rosto integrados → figurino/cabelo → ambiente e luz → três imagens consistentes → trecho de atuação → integração no pipeline. A direção inicial é bairro brasileiro com frutas adultas humanizadas; um eventual estilo de cristal/luxo terá identidade separada.

Blender local é o caminho de render já testado. MPFB e assets CC0 são candidatos para reduzir trabalho básico, sujeitos a adaptação artística e validação. Avaliar Cycles para materiais de cabelo que dependam dele, medindo a cena real antes de estabelecer capacidade. Vídeo generativo permanece alternativa condicionada a qualidade, direitos, acesso permitido, custo zero demonstrado e hardware/provedor efetivo.

Reutilizar elenco, continuidade, TTS, QA, estados e revisão existentes. Um futuro capítulo deve congelar versões de aparência, rig, figurino, voz e cenário. Rotação de providers não pode mudar silenciosamente a identidade nem contornar limites gratuitos. Não habilitar animação no painel por causa de um teste isolado.

## P — Prevenção, validação e dependências

- Não classificar QA de codec/duração como aprovação artística.
- Não inferir software gerador a partir dos quadros das referências.
- Não confundir licença gratuita do modelo com infraestrutura gratuita para executá-lo.
- Não converter resultado de um cubo 64×64 em previsão de render de personagens Full HD.
- Manter proveniência e licença dos assets externos; verificar condições da API separadamente da licença dos arquivos.
- Não modificar episódios aprovados, consumir candidatos ou publicar material durante pesquisa.
- A integração dependerá de cena e atuação aprováveis, suporte real a clipes, worker com capacidade medida e revisão humana por destino; o contrato mínimo de duração continua vigente.
- Os modos normais de gadgets e outras pautas permanecem independentes da ficção.

Nenhum recurso de animação novo foi implantado por este ADR.
