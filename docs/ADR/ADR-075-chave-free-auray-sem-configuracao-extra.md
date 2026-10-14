# ADR-075 — Chave padrão Free sem ajuste manual de teto

Data: 2026-10-14. Status: implementado. Atualiza a exigência de teto remoto exatamente igual a cinco do ADR-074; mantém os demais bloqueios.

A primeira conexão real confirmou uma conta Free com 50 créditos do plano, nenhum comprado/concedido, nenhum gasto da chave e teto de 50 que acompanha a franquia. Exigir que o usuário alterasse esse teto para cinco introduziria uma configuração manual desnecessária: o executor já aceita apenas uma solicitação explícita de cinco segundos/cinco créditos, revalida o preço e a origem do saldo antes de enviar e não reenvia um checkpoint existente.

Aceitar teto positivo, finito e no máximo igual à franquia gratuita recorrente comprovada. `audition_remaining` é limitado a cinco, ao saldo do plano e à sobra do teto da chave. Não aceita zero/ilimitado, teto acima da franquia, compra, promoção, conta paga, crédito temporário, preço alterado ou reserva maior que cinco. Uma alteração da carteira ou do teto durante o upload fecha a nova verificação antes do POST. Não há compra, recarga, ativação de plano ou mudança de configuração na Auray.

O teto remoto do plano limita o conjunto de usos da chave; o orçamento de cinco limita esta avaliação individual. Outros usos no site podem reduzir a carteira, e a verificação de saldo não promete que uma corrida externa não consuma a franquia primeiro. Uma recusa não é reenviada. Aprovação artística, continuidade e capacidade de capítulos continuam separadas da elegibilidade financeira.

Validação: chave padrão Free permite uma única submissão de cinco; teto esgotado, zero/ilimitado ou superior à franquia e carteiras não gratuitas bloqueiam antes de enviar. Demais testes de identidade, retomada e integridade do arquivo permanecem ativos.
