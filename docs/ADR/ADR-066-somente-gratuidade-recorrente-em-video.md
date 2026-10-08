# ADR-066 — Somente gratuidade recorrente na seleção de vídeo

Data: 2026-10-08. Status: política implementada e testada localmente; integrações adicionais de geração permanecem em avaliação. Substitui a prioridade de créditos de entrada do ADR-065.

## O — Objetivo

Cumprir a decisão do operador: serviço gratuito ou créditos gratuitos renováveis, geração automática após conexão inicial, sem depender de bônus do primeiro mês e sem cobrança. Preservar a qualidade aceita e manter explícita a diferença entre mecanismo implementado e provedor aprovado.

## C — Contexto

O levantamento anterior incluía créditos de entrada WaveSpeed/Alibaba/Lightning. O operador excluiu essas ofertas expressamente. O filtro atual exigia custo em dinheiro zero e saldo, mas uma oferta temporária com saldo positivo poderia passar; faltava distinguir sua recorrência.

Isto já existe em `packages/core/src/stories/video-routing.ts`: capacidades, qualidade, reservas, cota e fallback limitado à recusa antes de aceitação. Isto já existe no adaptador HF e no avaliador: inspeção, grupo de cota, checkpoint, lock e retomada. Não recriar. Gadgets, schema de duração dos episódios, publicação e estados do banco não precisam mudar.

Correção crítica: cinco minutos ZeroGPU compartilhados não multiplicam ao mudar o Space; US$0,10 mensais do HF Inference Providers não garantem sequer uma tomada de diálogo compatível. CPU gratuita não equivale a GPU de vídeo. A qualidade aprovada não está demonstrada nas rotas gratuitas de fala anteriores.

## S — Solução

1. Acrescentar `free_tier` obrigatório à capacidade do provedor: `recurring`, `permanent`, `trial` ou `unknown`. O roteador recusa `trial` e evidência desconhecida/ausente antes de selecionar; preserva todos os filtros anteriores de custo, saldo, qualidade e reservas. Não existe opção para aceitar crédito inicial automaticamente.
2. Classificar I2V/MuseTalk ZeroGPU como recorrentes. Classificar S2V patrocinado como desconhecido: disponibilidade da interface não prova franquia renovável. Bloquear novos envios pelo roteador, preservando conciliação e cache das chamadas existentes. A classificação não promove prévia a master.
3. Manter Modal mensal e ZeroGPU diário como rotas de gratuidade documentada. Registrar HF Inference Providers mensal como investigação de capacidade limitada; Kaggle como candidato em lote com adequação pendente. Excluir os benefícios iniciais do plano vigente. Não provisionar nenhum serviço nesta rodada.
4. Após conta/credencial inicial, a integração deve executar remotamente, consultar capacidade, reservar, acompanhar o mesmo job, auditar e enviar à revisão. Se nenhuma rota gratuita aprovada estiver disponível, aguardar e informar; não cobrar ou reduzir qualidade. Não afirmar automação completa já disponível.
5. Documentar a seleção atual em `docs/research/gratuidade-recorrente-video-2026-10-08.md`, marcar a prioridade antiga como substituída e atualizar instruções do avaliador. Manter a decisão auditável e sem segredos versionados.

## P — Prova

Documentação oficial conferida para Modal, ZeroGPU, HF Inference Providers e condições de créditos Lightning. Verificação local apenas de presença de `HF_TOKEN` na `.env.cloud`: ausente; nenhum valor secreto exposto. O relatório contém fontes e dependências, sem supor saldo autenticado ou contabilizar API de teste como capacidade mensal.

125 testes do core e 41 do renderer passaram. Novos casos verificam trial com saldo, escolha do próximo provedor recorrente, classificação ausente/invalidada, proteção de cobrança mesmo com serviço permanente e interface S2V disponível recusada pela falta de evidência. Typechecks dos dois pacotes passaram. Composição FFmpeg existente continua passando; não houve inferência remota.

Nenhuma rota nova de geração habilitada no Studio, episódio criado, migração, estado novo, crédito consumido em inferência, envio Telegram, publicação, push ou deploy. A implementação desta rodada é a política de elegibilidade no roteador experimental, não a conclusão do backend automático de capítulos.
