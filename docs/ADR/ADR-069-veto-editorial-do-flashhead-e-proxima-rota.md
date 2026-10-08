# ADR-069 — Veto editorial do FlashHead e próxima rota de geração

Data: 2026-10-08. Status: veto aplicado a novos diálogos; OmniAvatar identificado somente como candidato de teste. Complementa ADR-067/068.

## O — Objetivo

Impedir que uma prévia tecnicamente decodificável, mas reprovada duas vezes pelo operador por olhos borrados e movimento pouco fluido, consuma mais quota ou vire opção de capítulo. Procurar geração nova com corpo/expressão reais, sem afirmar que pós-processamento recria detalhe perdido.

## C — Contexto

Isto já existe em `scripts/render-free-story-shot.mts`: limite compartilhado de duas submissões por dia UTC, checkpoint antes da chamada não idempotente, revisão humana e distinção entre `--run` e `--resume`. Isto já existe no `routeVideoShot` do core: capacidade e acesso gratuito; `available` do Space não é aprovação editorial. O Studio nunca recebeu FlashHead como master.

O arquivo FlashHead bruto, 512×512/25 FPS, já apresenta olhos imprecisos. A variante do ADR-068 usa interpolação e enquadramento menor, mas o operador ainda a rejeitou. Logo, o defeito exige outra **geração**; não cabe aumentar a nitidez, fabricar quadros por duplicação ou trocar de site de upscale supondo solução.

Na busca por fonte nova, o Space [Vvkx/Wan2.2-S2V](https://huggingface.co/spaces/Vvkx/Wan2.2-S2V) está ativo em ZeroGPU, mas seu `app.py` fixado na revisão `d61755163d8fb88c43f54f1253a1429212fa482f` envia imagem/áudio à API DashScope com a chave do proprietário. Portanto não fornece inferência própria renovável demonstrada nem quota independente para o produto; foi excluído sem submissão.

O Space [alexnasa/OmniAvatar](https://huggingface.co/spaces/alexnasa/OmniAvatar), revisão `e6a7899449e8a16003b0b01046ea6d29dbbd00c5`, está ativo em ZeroGPU e expõe `infer_scene(image_path,audio_path,text,num_steps)`. O [modelo oficial OmniAvatar-14B](https://huggingface.co/OmniAvatar/OmniAvatar-14B) declara Apache-2.0 e condicionamento de imagem/áudio com animação corporal. O código atual do Space usa GPU `xlarge`, limita áudio a 5 s e reserva, para uma tomada de um único chunk, `(35 × steps + 30) / 2` segundos; a [quota ZeroGPU xlarge custa 2×](https://huggingface.co/docs/hub/spaces-zerogpu). Assim, quatro passos estimam 170 s da franquia de 300 s/dia e oito passos 310 s, acima da franquia gratuita. Não foi feita inferência: qualidade da Malu, tamanho efetivo, sincronia e débito real continuam desconhecidos.

## S — Solução

1. Bloquear `--run` para qualquer diálogo no executor isolado atual, inclusive FlashHead explícito. Manter `--resume` de chamadas já aceitas e `--inspect` sem GPU. O evento de inspeção informa `editorial_status` e `new_dialogue_submissions_enabled=false` para não confundir endpoint online com rota aprovada.
2. Manter I2V de ação/reação separado. Nenhuma mudança em episódios, estados, banco, Studio ou publicação.
3. Preparar OmniAvatar como próximo teste **único** após a janela compartilhada voltar a ter cota. Confirmar revisão, endpoint, reserva e um plano curto de imagem/WAV próprios; registrar ID e não reenviar se o estado for incerto. Não adicionar ao roteador antes de um vídeo real aprovado quanto a olhos, corpo, identidade, voz e duração.
4. Se quatro passos não preservarem qualidade ou se a quota real não couber, registrar veto. Não prometer episódios gratuitos ilimitados nem usar créditos de cadastro/pagamento como se fossem franquia recorrente.

## P — Prova

- O comando de nova fala `--run docs/stories/free-dialogue-audition.json` falha imediatamente, antes de upload ou submissão. A retomada do job legado S2V encontrou seu checkpoint e recusou a falha terminal sem reenviar. O ledger de 08/10 permanece em duas tentativas; não foi alterado para liberar outra chamada.
- Metadados e `/gradio_api/info` dos Spaces foram conferidos sem gerar vídeo. `Vvkx` usa DashScope; OmniAvatar ativo oferece a entrada necessária, mas ainda não foi testado com a personagem.
- Nenhuma nova chamada de GPU, custo, episódio, Telegram, publicação ou deploy. O próximo resultado visual depende de quota após a janela do provedor, não de pós-processamento adicional do FlashHead.
