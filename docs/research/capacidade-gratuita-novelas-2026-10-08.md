# Capacidade gratuita verificável para novelas novas

Atualização editorial no mesmo dia: o operador reprovou olhos e fluidez do FlashHead bruto e da variante interpolada. Novas falas nesse provedor foram bloqueadas pelo [ADR-069](../ADR/ADR-069-veto-editorial-do-flashhead-e-proxima-rota.md). As medições técnicas abaixo continuam válidas como histórico, mas FlashHead não é rota aprovada de capítulos. OmniAvatar é candidato sem teste visual; não contá-lo como capacidade disponível.

Levantamento e teste em 08/10/2026. O requisito é gerar capítulos novos automaticamente, com personagens próprios, áudio sincronizado, gestos e mais de um cenário, sem pagamento ou crédito que expire após o cadastro. Uma demo acessível não equivale a uma franquia adicional ou a um master aprovado.

## O que foi medido

- A tomada aprovada anteriormente com Wan2.2-S2V 14B no Modal consumiu aproximadamente US$3,67. O relatório do worker mediu 1301,28 s na geração/transferência dos quadros, de 1388,96 s totais (93,68%). A interpolação RIFE levou 4,67 s. Otimizar só o FPS de entrega não resolve o custo do diálogo.
- Com a conta HF autenticada, o Space público [`khuong2532002/soulx-flashhead-demo`](https://huggingface.co/spaces/khuong2532002/soulx-flashhead-demo) aceitou o PNG/WAV próprios da Malu. Uma primeira chamada foi interrompida quando o cliente rejeitou o link HLS, sem resultado reutilizável. A segunda produziu um close de 3,84 s bruto, 512×512, 25 FPS; da aceitação ao evento de conclusão decorreram cerca de 7,5 s de relógio. Esse intervalo **não é uma medição do débito ZeroGPU**.
- O HLS remuxado mostrou áudio atrasado 64 ms e correlação PCM 0,911 com o WAV de entrada. A versão normalizada, recomposta com o WAV original, mediu 3,28 s, 82 quadros, atraso 0 e correlação 0,999916. Decode e amostra de quadros passaram; lábios, emoção e atuação dependem de revisão humana. Artefato: `output/provider-research-deep-2026-10-08/flashhead-audition-2/normalized.mp4`.
- O close preservou pele de maçã, cabelo e vestido nos quadros amostrados. Cabeça, olhos e boca mudam; a tomada quadrada corta a ação corporal. Não há prova de que o modelo entregue as mãos, cenários e cortes do capítulo aprovado.
- A montagem local juntou a reação I2V gratuita já existente com a nova fala FlashHead em três cortes: 6,817 s, 480×832, 409 quadros codificados a 60 FPS e correlação PCM da voz no corte 0,999904, sem chamar a GPU novamente. Artefato: `output/free-story-sequence-flashhead/a-mala-acao-fala-reacao-flashhead.mp4`. Os quadros codificados incluem duplicação de 16/25 para 60 FPS, e a reação é reutilizada; isto demonstra mistura técnica, não um capítulo novo.

## Rotas que cabem no requisito

| Rota | Capacidade gratuita confirmada | Papel na história | Situação |
| --- | --- | --- | --- |
| [Hugging Face ZeroGPU](https://huggingface.co/docs/hub/spaces-zerogpu) | Conta gratuita: 5 min de GPU/dia, reinício 24 h após o primeiro uso; quota compartilhada por todos os Spaces da conta | Wan I2V para reação/ação curta; SoulX FlashHead Lite para close falado | Ambas têm prévia real; a cota externa restante e a quantidade de tomadas possíveis não são expostas pelo adaptador. Trocar de Space não cria outra quota |
| [Modal Starter](https://modal.com/pricing) | US$30 de compute incluídos por mês no plano atual | Wan S2V de qualidade aprovada, para falas/gestos em tomadas importantes | Funciona, mas a tomada medida foi cara; saldo atual curto, sem novo teste nesta rodada |
| [HF Inference Providers](https://huggingface.co/docs/inference-providers/en/pricing) | Crédito mensal gratuito de US$0,10 | Talvez serviços auxiliares | Não há modelo/preço/qualidade provados para uma tomada de novela; não contar como um terceiro gerador de capítulos |
| [Kaggle Notebooks](https://www.kaggle.com/docs/notebooks) e [CLI oficial](https://github.com/Kaggle/kaggle-cli) | GPU gratuita sujeita a disponibilidade e cota da conta | Pesquisa em lote de modelos abertos menores | Memória, execução automática contínua e adequação a um produto SaaS pendentes; fora do roteador |

O [SoulX-FlashHead 1.3B](https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B) tem licença Apache-2.0 e versões Lite/Pro. A velocidade de 96 FPS Lite em RTX 4090 é resultado divulgado pelos autores, não a nossa medição nem promessa para ZeroGPU. O Space testado disponibiliza **Lite** e retorna HLS. O adaptador fixa revisão, endpoint e parâmetros; só aceita URLs/segmentos do próprio host; remuxa localmente sem entregar token ao FFmpeg; recoloca o WAV original antes do QA. Saída permanece `preview` e close de diálogo.

Para ampliar gestos, [EchoMimicV3-Flash](https://github.com/antgroup/echomimic_v3) é a investigação técnica mais promissora: autores publicam modelo 1,3B/Apache-2.0, rota de 12 GB de VRAM, até 768×768 e recomendam mais passos para corpo que para cabeça. Isso **não prova** fidelidade das frutas, do português ou duração dentro da franquia. O Space público EchoMimicV3 localizado reserva no mínimo 180 s em GPU xlarge, cujo custo de quota dobra para 360 s; ultrapassa os 300 s diários da conta gratuita. Precisa de um endpoint próprio menor, com direito de hospedagem e benchmark antes de entrar no roteador. Contas pessoais HF com e-mail verificado e mais de 30 dias podem hospedar até dois ZeroGPU Spaces gratuitos, segundo a [documentação](https://huggingface.co/docs/hub/spaces-zerogpu). Isso não dobra a cota de uso da conta.

## Candidatos excluídos ou condicionais

| Serviço/método | Motivo |
| --- | --- |
| [MoDA](https://github.com/lixinyyang/MoDA) | Há Space ZeroGPU com endpoint final simples, porém o repositório descreve finalidade acadêmica e não informa licença clara para pesos/código comercial. Não integrar à novela monetizável sem direito verificável |
| [Magic Hour](https://magichour.ai/pricing) | A página distingue uso comercial dos planos pagos. A oferta gratuita não foi confirmada como franquia recorrente de API apta a conteúdo comercial |
| [Pollinations](https://github.com/pollinations/pollinations/blob/main/enter.pollinations.ai/POLLEN_FAQ.md) | Vídeo usa Pollen por modelo. Pollen gratuito depende de Quests/recompensas variáveis e resgate; algumas rotas exigem saldo pago. O próprio FAQ recomenda não iniciar integrações no fluxo legado de chave pública limitada por IP |
| Créditos de cadastro WaveSpeed/Alibaba/Lightning | Não atendem à exigência de renovação gratuita comprovada; bloqueados pelo ADR-066 |
| Colab gratuito ou hardware do cliente | Notebook manual/disponibilidade local não fornece backend automático a usuários de celular |

## Política para capítulos

O caminho de custo zero é misturar **papéis de cena**, e não trocar serviços para supor saldo infinito: close falado do FlashHead, reações/ação curta de I2V, os poucos momentos de atuação corporal do Wan S2V dentro da franquia Modal. Cada tomada deve ter roteiro, referência própria, áudio medido, capacidade recente, reserva do grupo, ID remoto, checkpoint, QA, revisão humana e licença. Se não houver provedor que entregue o tipo e a qualidade exigidos, o capítulo espera. Imagem estática com zoom ou interpolação para 60 FPS não conta como gesto animado.

O executor atual só prova tomadas isoladas. O Studio ainda não agenda automaticamente todas as tomadas de um capítulo, nem recebeu um provedor de corpo inteiro gratuito aprovado. Portanto **não há número confiável de capítulos por mês**. Estimar esse número exigirá medir quota efetivamente debitada por tomada, taxa de falha, duração por personagem e cobertura de atuação de uma história completa. A meta editorial de cobertura animada e fala direta permanece, sem reduzi-la para caber em uma oferta gratuita.
