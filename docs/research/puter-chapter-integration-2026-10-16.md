# Puter como fonte de capítulos nativos

O teste de cinco segundos aprovado foi integrado ao planejamento de capítulos, à carteira gratuita e ao executor. Uma amostra aprovada não garante identidade, anatomia ou voz iguais em novos vídeos. Cada capítulo continua privado e exige revisão.

## Contrato e orçamento

- Fonte: Puter; modelo fixado `togetherai:wan-ai/wan2.7-i2v`, upstream `together-video-generation`.
- Imagem original de referência por personagem, falas curtas em português, áudio do próprio modelo, 720 × 1280, entrega a 30 FPS. Não há interpolação, alongamento ou substituição silenciosa do motor.
- Conta Free com e-mail confirmado, franquia mensal de 1.000 créditos, sem assinatura, crédito comprado ou fallback de cartão. A franquia também paga outros usos da conta.
- O teste consumiu aproximadamente 322 créditos incluindo transferências. A reserva operacional é **330 créditos estimados por tomada de cinco segundos**; três tomadas reservam **990 créditos estimados**. O catálogo informa preço em centavos de dólar e não expõe a conversão para a carteira. Esses valores não são uma cotação garantida do provedor.
- O saldo foi consultado novamente em 16/10/2026: aproximadamente **677,65 créditos**. Isso permite estimar tomadas avulsas, mas **zero capítulos completos de 15 segundos**. Não foi feita outra inferência para validar a implantação.
- Durações de 30/45 segundos não cabem nessa franquia. As capacidades de Puter, Auray e Modal são apresentadas separadamente.

Referências primárias: [cotas](https://docs.puter.com/rate-limits-and-quotas/), [vídeo](https://docs.puter.com/AI/txt2vid/), [espaço](https://docs.puter.com/FS/space/), [remoção de arquivo](https://docs.puter.com/FS/delete/). A documentação informa que pedidos podem ser encurtados para caber no saldo. Por isso o executor confere duração e quadros reais e rejeita entregas fora do contrato.

## Operação

1. A conexão protegida verifica a conta e guarda o token em Vault; o navegador recebe apenas o estado e o saldo. O token já fornecido pode ser conectado pelo operador sem solicitá-lo novamente.
2. O usuário escolhe Puter e um exemplo revisado, confere todas as referências e aceita versões de voz. O perfil fica vinculado à versão da escolha. A novela Auray existente não é modificada.
3. O banco exige saldo recente para o capítulo inteiro antes de colocá-lo na fila. O trabalhador confere novamente a conta e o orçamento antes de cada nova tomada. Contas compartilhadas entre espaços de trabalho usam uma única reserva.
4. O executor grava a intenção antes do POST. Resposta perdida nunca autoriza repetir a geração: a retomada procura somente o arquivo privado de nome determinístico.
5. Os bytes são guardados e verificados no armazenamento privado do Studio antes da inspeção técnica. Depois da coleta confirmada, somente o arquivo remoto pertencente àquela tomada pode ser removido, com verificação de hash e sem remoção recursiva. Outros arquivos do usuário e a amostra aprovada ficam preservados.
6. A montagem copia o vídeo sem recodificar, verifica os pixels e mede o alinhamento do áudio original. Os recibos, o roteiro e o vídeo usam caminhos imutáveis pelo conteúdo. A conclusão apenas entrega o capítulo para revisão.
7. O workflow `story-puter.yml` acompanha os mesmos trabalhos, consulta saldos e retoma pendências. Uma chamada incerta sem arquivo pode continuar pendente: a API não fornece uma prova de rejeição nem uma chave idempotente upstream. O sistema conserva a reserva; não inventa um estorno nem envia outra tomada automaticamente. Encerrar impede novos envios e aguarda a conciliação dos existentes.

## Validação

Testes com provedor simulado cobrem envio único, perda de resposta, perda de confirmação do banco, mudança de referência, conta paga, falta de saldo, contrato alterado, arquivo incorreto e limpeza restrita. Testes PostgreSQL verificam isolamento, Vault, admissão, reserva, progresso, retomada e montagem vinculada. A montagem real de arquivos locais a 30 FPS é conferida por FFmpeg sem GPU/API.

O capítulo Puter completo ainda não foi avaliado artisticamente com três tomadas reais: o saldo atual não cobre essa avaliação. A aprovação disponível continua limitada à amostra original de cinco segundos.
