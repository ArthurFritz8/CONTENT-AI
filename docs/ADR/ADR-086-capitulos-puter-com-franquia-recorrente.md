# ADR-086 — Capítulos Puter com franquia recorrente

Data: 16/10/2026. Decisão: implementada; validação artística do capítulo completo aguarda saldo.

O Puter deixa de ser apenas uma prévia e passa a ter conexão protegida, padrão próprio, preparação de roteiro, reserva, executor e entrega privada para revisão. A implementação usa tabelas e lease de conta separados do Auray. O núcleo aceita a união dos dois contratos; o executor Auray continua aceitando exclusivamente seu contrato original.

O modelo fixado é Wan 2.7 I2V, com áudio nativo e entrega 720 × 1280 a 30 FPS. A preferência Puter exige exemplo revisado da mesma fonte/estilo, imagens prontas de todo o elenco, direção vocal e aceite explícito de vozes que podem variar. Os capítulos congelam a configuração e usam os resumos aprovados. Não há conversão automática de uma novela existente nem soma de saldos entre provedores.

O catálogo não publica a conversão entre o preço em centavos de dólar e créditos. Reservamos uma estimativa conservadora de 330 créditos por tomada, ou 990 por três tomadas. A franquia mensal de 1.000 créditos não comporta seis/nove tomadas. Saldo, conta e contrato são conferidos novamente antes de cada envio. Alterações ou insuficiência interrompem os novos envios e preservam o que já foi obtido; não há compra ou fallback pago.

Uma intenção persistida precede cada POST. Sem resposta conclusiva, o executor apenas consulta o mesmo arquivo privado; não repete a geração. Uma reserva incerta permanece retida até haver prova de término. O cancelamento impede novas tomadas, sem prometer estorno de pedidos aceitos. Como o Puter não fornece identificador de job idempotente upstream, um pedido incerto que nunca produz arquivo pode exigir conciliação do operador; não se infere rejeição a partir de um 404.

Os bytes originais são guardados e verificados no Studio antes da inspeção técnica. A cópia remota só é removida depois da coleta, em um nome determinístico pertencente ao executor, com hash conferido e remoção não recursiva. A montagem confere quadros sem recodificar vídeo, áudio nativo e política editorial atual. Nunca aprova nem publica o resultado.

As migrações aditivas 55/56 isolam credenciais em Vault, acesso por workspace, lease compartilhado por conta, reserva de capítulo inteiro, checkpoints monotônicos e recibos de conclusão. O worker agendado e a retomada usam o mesmo estado, sem um segundo envio automático de uma cena incerta. O painel mostra a carteira Puter separadamente, custo estimado, capacidade de capítulos completos, referências e progresso.

Consulte [pesquisa e limites da implantação](../research/puter-chapter-integration-2026-10-16.md). Há teste real aprovado de cinco segundos e testes offline do fluxo; não há ainda avaliação artística de um capítulo Puter inteiro, porque os aproximadamente 677,65 créditos restantes não cobrem a estimativa de 990.
