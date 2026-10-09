# ADR-074 — Conector Auray com avaliação limitada e continuidade protegida

Data: 2026-10-09. Status: implementado como candidato experimental, produção não habilitada.

## Problema

Modal é a única direção audiovisual aprovada, mas o saldo não cobre a reserva mínima de um capítulo. Os testes gratuitos Hugging Face foram reprovados por olhos/fluidez; créditos do Gemini Pro/Flow não são franquia da API de vídeo. Uma segunda fonte exige recorrência financeira, conta acessível, qualidade e continuidade comprovadas. Uma API que gera vídeo não substitui automaticamente as falas, vozes e personagens existentes.

## Decisão

Implementar Auray como conector separado do executor de produção. `/v1/plans` atualmente publica Free por US$ 0, 50 créditos mensais, sem trial, API de vídeo própria e cinco créditos para cinco segundos. `/v1/me` determina saldo, origem do crédito, período, permissões e limite da chave. Preço ou contrato alterados, saldo desconhecido, conta paga/promocional, carteira misturada ou limite não fixado em cinco bloqueiam submissão. Todas as verificações se repetem imediatamente antes de enviar. O teto remoto protege também contra concorrência fora deste processo.

A primeira avaliação recebe apenas uma reação/ação silenciosa com PNG e hash próprios. O endpoint não recebe nossa voz/WAV; diálogo é recusado. Idempotência inclui tomada, conta, período e contrato. Checkpoint prévio ao POST, lock local, consulta pelo ID determinístico, retomada sem reenvio e download medido impedem que uma queda de conexão vire uma segunda cobrança. Um contrato válido identifica API, não pesos imutáveis. MP4 original verificável permanece prévia pendente de revisão, mesmo quando tem FPS/resolução altos.

Nenhuma carteira, saldo global, capacidade de capítulos, flag de produção ou continuidade é alterada pelo teste. Não há alteração de banco, Edge ou painel nesta entrega. A contribuição futura da fonte depende de aprovação audiovisual por perfil, licença/origem registradas e conexão com o roteamento/contabilidade já existentes; não somar créditos Auray a dólares Modal. A conta ainda não foi conectada nesta entrega.

## Validação

Testes offline cobrem proveniência de crédito, mensalidade, trial, promoções, período, e-mail, permissões, teto, preço, contrato alterado, revalidação antes de POST, respostas incertas, identidade do job, liquidação, URL/credencial, upload conflitante e arquivo truncado. Inspeção local sem chave termina sem HTTP ou inferência. Contrato público capturado em 09/10 foi comparado com o parser. Nenhum vídeo/GPU/crédito real foi consumido para validar o conector.

Operação: [auray-operator.md](../auray-operator.md).
