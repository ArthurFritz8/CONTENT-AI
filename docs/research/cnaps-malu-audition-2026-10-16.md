# Teste real CNAPS — 16/10/2026

**Resultado: início da geração recusado por franquia insuficiente. Nenhum vídeo foi produzido.** A conta e o catálogo continuam informando Free, 0% usado, reposição em cinco horas e MiniMax H3 acessível. Essa leitura não comprova capacidade de execução: a única chamada real de geração foi recusada. CNAPS permanece fora da produção e sem capacidade contada no painel.

## O que foi executado

O usuário autorizou continuar após a conexão. Foi criado **um fluxo privado**, com acesso de proprietário, contendo somente Text-Input, Image-Loader, MiniMax H3 Ref2VA e Video-Viewer. O perfil escolhido é 124 quadros, 768 × 1344, 24 FPS anunciados, 30 passos e seed 42016. Texto e referência usam portas conferidas nos metadados autenticados; não há nós Google, integrações externas, lotes ou publicação.

A imagem original aprovada da Malu foi conferida por SHA-256, copiada para um caminho próprio no bucket privado existente do Studio e compartilhada para processamento com URL assinada de uma hora. O CNAPS registrou um único upload. Os 2.287.708 bytes recebidos de volta foram conferidos com o mesmo hash da imagem original. Não houve redesenho, edição da imagem ou substituição das referências da novela.

A fala planejada foi “Você ia embora sem me contar?”, com um gesto contido da mão e movimento de ombros. O mesmo texto foi usado no teste Puter aprovado, permitindo comparação futura. **Não há resultado CNAPS para comparar nesta rodada.**

## Recusa observada

Houve **uma chamada `run_flow`**, que respondeu com erro de franquia insuficiente para o período atual. O erro foi registrado como `provider_quota_exceeded`. A consulta posterior retornou todos os quatro nós em `pending`, sem vídeo de saída. A leitura de consumo continuou em 0%.

O motivo exato da divergência permanece desconhecido. A resposta de consumo não informa o limite absoluto de GPU; não permite distinguir falta de ativação, limite insuficiente para essa tomada ou outra restrição do serviço. Não afirmar que o problema será resolvido ao esperar cinco horas. A documentação anuncia reposição e modelos no Free, mas isso não substitui a recusa autenticada observada. [FAQ oficial](https://docs.cnaps.ai/faq), [planos](https://cnaps.ai/pricing).

Não foram repetidos pedidos de geração, escolhidos outros motores, contratados planos ou ativados testes pagos/temporários. Modal e Puter não foram chamados. Não houve alteração das novelas, episódios, filas, reservas ou publicações. Os arquivos de referência enviados e o fluxo permanecem privados; nenhuma remoção foi feita.

## Implementação reutilizável

- `scripts/cnaps-malu-audition.mjs`: CLI de operador para `prepare`, `run`, `resume`, `status` e `collect`. Não é um executor de capítulos nem habilita uma fonte no painel.
- `scripts/lib/cnaps-malu-audition.mjs`: plano fixo, conta Free atualizada antes das ações, identidade da conta e referências conferidas, grafo privado exato, intenção durável antes de cada mutação.
- `scripts/lib/cnaps-audition-client.mjs`: transporte limitado, sem ferramenta de cobrança, lote, publicação, mensagem de suporte ou exclusão. Downloads aceitam apenas a origem de armazenamento observada, sem enviar credenciais, seguir redirecionamentos ou ultrapassar o limite de bytes.
- Checkpoint e marcador de tentativa impedem uma segunda geração, inclusive após timeout ou recusa. Depois da primeira intenção de geração, `run` e `resume` somente consultam o mesmo fluxo. Não apagar marcadores para tentar novamente.
- Respostas completas ficam somente na saída local ignorada; resumos não expõem chave, identidade ou URLs privadas. O scanner do Git também reconhece o formato de chave CNAPS.

O servidor serializa índices de conexão como `in_index`/`out_index`, diferentes dos nomes de entrada da criação. O código normaliza os campos equivalentes e rejeita conflitos. A resposta de upload usa `urls`; o código exige uma única referência. Na adaptação inicial, o único recibo de upload já recebido foi recuperado e conferido, sem reenviar a imagem.

Os testes offline cobrem intenção antes do envio, recusa por cota, ausência de reenvio após falhas, mudanças de conta/modelo/parâmetros, conteúdo da referência, privacidade do fluxo, esquemas incompatíveis, download sem credenciais e limites de resposta. Os testes não usam GPU, chaves reais ou API de geração.

## Termos e arquivos

Os documentos públicos de termos, privacidade e política de IA, versão **20260925**, foram lidos a partir dos links de conteúdo usados pela própria página oficial. O uso de assistentes consta na seção 6A; marcações/proveniência devem ser preservadas. O teste usa personagens fictícios e não publica conteúdo. Isso não equivale a uma certificação jurídica nem libera automaticamente uma futura publicação. [Termos](https://cnaps.ai/terms), [política de IA](https://cnaps.ai/ai-policy).

Estado privado: `output/cnaps-malu-audition/checkpoint.json`, fase `quota_rejected`, `generation_attempted: true`. Evidência completa em `private-responses/`, com uma resposta de geração. Não há `original.mp4`. O plano permanece registrado, mas não pode ser tratado como vídeo aprovado ou geração agendada.

Próximo passo: esclarecer a franquia efetivamente liberada na conta. A pergunta ao titular pede apenas o limite/aviso mostrado em Usage/Billing, sem pagamento ou nova chave. Até essa informação ou uma mudança comprovada do serviço, não habilitar produção, somar capacidade ou reenviar o teste.
