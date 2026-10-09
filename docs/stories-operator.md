# Histórias opcionais no Studio

Atualização de implementação em 09/10: [ADR-071](ADR/ADR-071-preparo-automatico-e-saldo-conservador-modal.md) liga o caminho animado ao preparo de falas, orçamento e fila; ainda **não foi implantado/ativado**. As instruções abaixo continuam descrevendo o fluxo ilustrado disponível. Criar novela automaticamente também cria conceito/elenco/arco, sem obrigar a escrever uma premissa.

Para uma série animada configurada, a futura ativação mostra separadamente saldo estimado, reservas, disponibilidade e orçamento do capítulo preparado. A fala é medida antes de reservar a GPU; um saldo insuficiente aguarda capacidade, sem começar apenas as primeiras cenas. Retomadas consultam os arquivos e jobs existentes. Publicação e continuação continuam dependendo da aprovação do capítulo anterior.

Ativação do operador: aplicar primeiro todas as migrations de vídeo de 08/10 e as três de 09/10; implantar as versões correspondentes das funções e workflows. Registrar referências PNG privadas e amostras/vozes aprovadas por personagem, calcular o hash do perfil e cadastrar compatibilidade para a execução implantada. Não promover placeholders ou evidência de outro modelo ao perfil aprovado.

Cadastrar carteira Modal em USD micro, `quota_group=modal:NOME_REAL`, acesso ao workspace e margem; mantê-la desativada enquanto faltar evidência. `studio_modal_wallet_config` exige franquia mensal verificada, validade, prova vigente do limite de gastos zero e confirmação de implantação. `story-balance.yml` recebe o ID dessa carteira, verifica a conta das credenciais e apenas lê o faturamento. Essa consulta não gera vídeo nem habilita a fonte. Os secrets Modal/Supabase ficam no servidor/Actions.

O gate SQL `system_config.story_production.animated_preparation_enabled`, o secret/ambiente Edge `CONTENT_AI_ANIMATION_PREPARATION_ENABLED` e a variável Actions de mesmo nome devem concordar. Envio de GPU tem flag independente `CONTENT_AI_VIDEO_DISPATCH_ENABLED`, no Edge e Actions. Defaults são false. Verificar franquias Actions/Storage e orçamento integral antes de ativar. Não aumentar limite ou pagar para cumprir o requisito gratuito. A conciliação financeira continua explícita: resumo agregado não libera sozinho as reservas de cada job, inclusive após mudança de mês.

Em **Pautas e produtos**, a opção inicial **Vídeo de assunto** continua pesquisando gadgets e os outros temas existentes. Pode alternar de formato a qualquer momento: escolher uma história não transforma suas pautas normais.

Para uma história, escolha **História original** ou **Novela de frutas**, o tom e 1, 3 ou 6 capítulos. Descreva a ideia e clique **Criar proposta**. Confira o elenco, a prévia das ilustrações e **Ver plano dos capítulos**. Ainda não há vídeo.

Clique **Gerar capítulo 1**. A pauta fica na fila e inicia o pipeline usando o limite diário existente. O cartão passa a mostrar a etapa e **Ver geração**. Quando pronto, abre **Revisar vídeo** no mesmo painel; o Telegram continua opcional/conforme sua conexão.

Depois de assistir e aprovar a versão atual, aparece **Continuar história · capítulo 2**. Esse botão cria e gera somente o próximo capítulo usando o mesmo elenco e o resumo aprovado. Uma mudança no roteiro/render exige nova aprovação. Capítulos futuros nunca são gerados ou publicados apenas porque você criou a série.

Em uma falha, abra **Ver geração** para conferir o motivo. **Gerar capítulo novamente** preserva o plano e cria uma nova tentativa, respeitando o limite do dia. Para remover uma proposta não iniciada ou concluída da lista, use **Arquivar história**; vídeos permanecem em Gerações. Um capítulo pendente/em produção deve ser concluído ou cancelado antes de arquivar.

O contador é atualizado a cada 30 segundos. “Até N vídeos estimados hoje” considera o limite do Studio e a cota de roteiro conhecida, com margem para correção. Todos os formatos dividem o limite de produção; saldo de API desconhecido não é exibido como ilimitado. Criar propostas usa cota de texto. O dia do Studio renova à 0h UTC (21h em Brasília).

O modo disponível usa **ilustrações originais, movimento de câmera, duas vozes, legendas e CTA orgânico**. Não gera clipes animados nem sincroniza boca. Geração externa de animação depende de uma conexão/cota confirmada e validação adicional; não está habilitada. Publicação em TikTok/YouTube segue os canais configurados e sua aprovação explícita na revisão.

Atualização técnica de 06/10/2026: o código do renderer agora consegue montar uma cena cujo visual seja um asset `video_clip`, com narração e legendas, conforme ADR-050. Isso ainda não habilita geração de animação no painel: o produtor de clipes e a geração de referências humanizadas continuam separados do fluxo disponível. A amostra Wan/Modal está documentada no ADR-049.
