# YouTube Shopping e afiliados

O projeto já publica a divulgação comercial determinística na descrição do
YouTube. O YouTube Shopping pode complementar isso quando o canal estiver
elegível: o programa de afiliados está disponível para criadores elegíveis no
Brasil, mas depende do Programa de Parcerias do YouTube, dos critérios de
inscrição e da ativação do recurso no Studio.

A marcação nativa de produtos é feita no YouTube Studio. A documentação pública
do YouTube descreve a marcação e a gestão de produtos no Studio, mas não oferece
um endpoint público de criador equivalente ao conector do TikTok Shop. Portanto,
o pipeline não presume uma automação de tagging nativo: ele mantém o link de
afiliado na descrição e registra a indicação comercial, enquanto a marcação
nativa pode ser feita manualmente depois que o vídeo privado for revisado.

Quando o canal cumprir os requisitos, o procedimento recomendado é:

1. Verificar a elegibilidade em **YouTube Studio → Ganhos → Shopping**.
2. Ativar o programa e aceitar os termos do afiliado.
3. Após cada revisão, marcar os produtos no Studio e conferir comissão,
   disponibilidade e país antes de tornar o vídeo público.
4. Manter no roteiro e na descrição a divulgação comercial gerada pelo projeto.

Relatórios do Merchant API podem servir para análise de desempenho de contas
participantes, mas não substituem a autorização nem a marcação no Studio.
