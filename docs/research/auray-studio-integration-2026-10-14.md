# Auray no Studio — saldo, histórico e retomada

Data: 14/10/2026. Implementação: [ADR-077](../ADR/ADR-077-monitoramento-e-retomada-auray-no-studio.md). Esta entrega integra monitoramento e recuperação dos testes existentes; não é o adaptador de geração de capítulos Auray.

## Resultado verificado na conta real

- Migrações `20261014000000` e `20261014010000` aplicadas transacionalmente. A segunda limita a recuperação a cinquenta trabalhos pendentes; o histórico concluído não cresce o lote.
- `studio-story` implantada com a seleção autorizada do workflow Auray. Chave instalada como secret do Actions, sem enviá-la ao painel ou ao Git.
- Quatro jobs previamente gerados importados e recolhidos ao bucket privado. Tamanho e SHA-256 dos quatro originais conferidos por leitura real do storage. Nenhuma imagem, trilha ou FPS foi alterado.
- Consulta real confirmou 30 créditos de plano Free, franquia mensal 50 e limite restante da chave suficiente para a comparação de seis tomadas nominais de cinco segundos. São trinta segundos brutos de orçamento, sem reserva de novas tentativas, sem garantia de capítulo e sem soma com o Modal.
- Zero novas gerações e zero créditos de geração consumidos nesta integração. Os vinte créditos dos quatro jobs são consumo anterior. Nenhuma chamada Modal, compra ou recarga.
- Conta, chave, identificador externo, prompt e links assinados ausentes do overview do usuário. O bucket permanece privado.
- Carteiras de produção habilitadas: zero. Jobs de produção: zero. Preparo de capítulos animados continua desativado; prévias de voz existentes preservadas.

Recibos privados: `.audit-tmp/auray-monitor-schema-deployment.json`, `.audit-tmp/auray-monitor-paging-schema-deployment.json`, `.audit-tmp/auray-studio-live-verification.json` e `.audit-tmp/auray-edge-dispatch-verification.json` (ignorados pelo Git).

## Recuperação e nuvem

Na validação real, o Supabase devolveu HTTP 204 para uma função SQL `void`; o leitor foi corrigido para aceitar a resposta sem corpo e ganhou regressão offline. Também ocorreu limite temporário de consultas Auray. Reaproveitar a inspeção fresca evita leituras duplicadas no cadastro e na rotina automática. A consulta seguinte recolheu os mesmos jobs restantes, sem novo envio. Um erro em um job não impede recolher outro job já concluído.

O [workflow executado diretamente](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/38629408717) e o [workflow acionado pela Edge Function](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/38629547887) concluíram com sucesso. Ambos encontraram os arquivos já recolhidos, sem novo download da Auray ou geração. O agendamento de trinta minutos recupera trabalhos registrados em consultas futuras; pode atrasar conforme o GitHub. Não é descoberta automática de toda a conta: somente solicitações importadas e vinculadas ao workspace entram na recuperação.

O painel tem botão de consulta, indicação de saldo antigo/falha, comparação de orçamento e reprodução privada dos testes. Build, autorização anônima e testes do navegador passaram localmente. A implantação pública é acompanhada pelo workflow `Deploy web panel`; não confundir health de uma revisão antiga com disponibilidade desta interface.

## Validação e pendências

[CI da integração](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/38628965052) e [CI da correção de respostas vazias](https://github.com/ArthurFritz8/CONTENT-AI/actions/runs/38629330505): seis jobs aprovados em cada execução. Testes adicionais verificam lote de cinquenta pendentes, exclusão do histórico pronto, independência de jobs indisponíveis, saldo zero, conta incorreta, isolamento por workspace, hash incorreto, RPCs privadas, clique repetido, lease concorrente e callback antigo.

A aprovação audiovisual da sequência foi preservada. A mudança visual do Laranjito e a identidade vocal entre episódios continuam pendentes. A produção não troca Modal por voz nativa Auray automaticamente. O próximo adaptador precisa respeitar o perfil da novela, a reserva do capítulo inteiro e a retomada sem duplicar envios; monitoramento não substitui esses requisitos.
