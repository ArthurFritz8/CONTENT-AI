# Puter: primeiro teste da Malu — 16/10/2026

## Resultado real aprovado pelo usuário

O usuário aprovou o vídeo com **“ficou bom!”**. A aprovação editorial se refere a esta amostra; o [ADR-085](../ADR/ADR-085-previa-puter-aprovada-na-galeria.md) registra sua inclusão na galeria privada, mantendo a geração de capítulos Puter em preparação.

Foi enviada **uma única geração** Wan 2.7 I2V, com a referência aprovada da Malu, áudio solicitado em português e um gesto de mão ao peito. Não houve chamada ao Modal, Auray ou ZeroGPU, compra ou publicação. O filme original e a novela aprovada não foram alterados.

Arquivo local: `output/puter-malu-audition/original.mp4`. SHA-256: `a8413815fbac011370fe60f5beb2e914dfbe5c2a4b6b00f247fe0e57ed372991`. Tamanho: 5.009.970 bytes. A cópia remota é privada no filesystem da própria conta Puter.

Verificação com FFmpeg/ffprobe: **5,000 s, 720×1280, 30 FPS, 150 quadros**, áudio presente e decode completo sem erro. Os 150 hashes dos quadros decodificados são distintos. O arquivo entregue é o original; não houve reencodificação, ampliação ou interpolação local. Esses números não demonstram, por si, FPS nativo do modelo ou sincronização labial.

As seis amostras visuais mostram rosto, vestido e cenário semelhantes à referência, mudança de expressão e gesto corporal. Essa inspeção não comprova identidade perfeita, anatomia em todos os frames ou qualidade de um capítulo inteiro. A revisão artística da amostra foi aprovada pelo usuário.

Fala solicitada: **“Você ia embora sem me contar?”**. O reconhecimento local Whisper base transcreveu “Você ir embora sem me contar?”, marcando possível divergência. É uma conferência auxiliar; pode haver erro do reconhecedor. Conferir a fala e a boca assistindo ao vídeo. `lip_sync_verified`, `identity_verified` e `production_ready` continuam **false**.

## Saldo e limite aplicado

A conta real foi reconferida imediatamente antes da submissão: permanente, email confirmado, sem assinatura, sem fallback para cartão disponível e sem addons/créditos comprados reportados. A franquia declarada era de 1.000 créditos mensais. O usuário autorizou seguir com o teste.

Como não havia conversão pública de créditos para dólares, esta foi uma avaliação isolada autorizada contra **até todo o saldo gratuito disponível**, sem tratar o valor como cotação de uma chamada ou habilitar produção. O executor recusa mudança de plano, unidade, franquia, cartão, addons, modelo ou referência. O limite do pool não é um parâmetro de orçamento repassado à API; o próprio serviço admite a operação contra seu saldo e pode reduzir a duração. A saída foi conferida e manteve os cinco segundos solicitados. [Regra oficial de saldo e duração](https://docs.puter.com/rate-limits-and-quotas/).

Antes da submissão havia 999,5963 créditos. A primeira leitura após download informou 679,5822, débito observado de 320,0140. Após a contabilização adicional de transferência/consultas, uma leitura às 13:53 BRT informou **677,6926 créditos**. O débito observado desde o início da submissão foi, portanto, aproximadamente **321,9 créditos**. Isso inclui custos do fluxo de teste e não prova uma tarifa isolada de inferência. A franquia é compartilhada; não transformar essa medição em garantia de segundos/capítulos futuros ou somá-la a outra fonte.

## Executor e proteção contra duplicidade

```powershell
python -X utf8 scripts/puter_malu_audition.py prepare
python -X utf8 scripts/puter_malu_audition.py resume
```

`prepare` verifica a referência local, sem HTTP. O `run` autorizado já aconteceu; uma nova execução recusa o checkpoint existente antes de consultar ou gerar. **Não apagar checkpoint/lock nem alterar o plano para repetir a chamada.**

O estado é persistido antes do POST. Timeout, falha e resposta incerta nunca provocam novo POST automático. `resume` lê a mesma cópia privada, verifica conta/hash e preserva o original; não chama geração, não exige novo saldo e não compra créditos. Se a cópia ainda não existir, a leitura falha e a chamada continua sem reenvio. Não há retomada de um job upstream pela API neste protótipo, portanto perda de resposta e falha ao salvar remotamente podem exigir conciliação do provedor.

Credencial: `PUTER_AUTH_TOKEN` em `.env.cloud`, ignorado pelo Git. Não há token no plano, checkpoint, saída do comando ou URLs de mídia. Downloads usam apenas a API autenticada Puter; URLs do resultado upstream não são acessadas pelo executor. Não há nova URL pública ou acesso ao vídeo por outros usuários.

Os nove testes offline cobrem plano gratuito, recusa de cartão/assinatura/addons, alterações de contrato e referência, submissão única, checkpoint antes de timeout, retomada sem nova geração e hash de mídia. Estão incluídos no CI. A conferência local de frames/áudio e a transcrição não consumiram quota de GPU ou API externa.

## Próxima etapa

Com a amostra aprovada, sua prévia pode ser apresentada no painel. Continua pendente preparar um perfil Puter próprio, com quota, reserva e retomada. Este teste não adiciona um botão de produção nem substitui o perfil Auray da novela existente. Voz, referência, duração, continuidade e preço precisam ser tratados no contrato do novo perfil.
