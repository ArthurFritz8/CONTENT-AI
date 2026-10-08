# Plano de implementação: novelas animadas no Studio

Data: 08/10/2026. Estado: proposta para revisão do operador; não representa funcionalidades já implantadas. Base: inspeção do código, histórico dos testes aprovados/reprovados e documentação dos provedores. Esta rodada não executa geração, não consome créditos de vídeo e não altera produção.

Revisão 2, em 08/10: incorpora criação automática de conceito e estrutura da novela, padrão audiovisual fixado por novela (inclusive entre capítulos), distinção entre infraestrutura e modelo, capacidade específica para continuidade e validação de migração antes de trocar o gerador. Substitui a preferência anterior de apenas manter uma fonte por capítulo.

Andamento após autorização para implementar: criação automática, contratos de identidade/capacidade e base transacional de reservas implementados e testados localmente. Consulte [ADR-068](ADR/ADR-068-criacao-automatica-e-reserva-de-video.md) para evidências e pendências. A animação pelo painel e a segunda fonte continuam pendentes; o restante deste documento descreve a entrega final planejada.

## 1. Decisão de produto

O usuário cria e continua uma novela dentro do Studio. Conecta suas fontes uma vez; o sistema planeja, estima, reserva capacidade, gera, verifica, monta e oferece o capítulo para revisão. Não depende de comandos, notebook aberto ou transferência manual de cenas entre sites.

A tela principal mostra **o que é possível produzir**, com detalhes por fonte disponíveis ao expandir. Não soma dólares com créditos, não faz média entre carteiras e não apresenta capacidade de roteiro como capacidade de vídeo. A quantidade de capítulos depende do plano concreto e da qualidade contratada.

Prioridades, nesta ordem: manter personagens/vozes e qualidade aprovada; respeitar a política de nenhum desembolso adicional; concluir capítulos; aproveitar melhor as franquias; reduzir espera. Se uma alternativa exige perda de qualidade, muda a voz ou precisa de pagamento, não se torna substituta automática.

Dois caminhos igualmente completos fazem parte do produto: **Criar com minha ideia** e **Criar novela automaticamente**. A automação de concepção está prevista desde a primeira versão da experiência de criação; não é apenas uma função futura de gerar o próximo roteiro.

## 2. Diagnóstico verificável do projeto

| Parte | O que existe | O que falta |
| --- | --- | --- |
| Novelas no painel | Premissa, elenco, arco e aprovação do capítulo anterior | Fluxo de animação, orçamento real, edição por cena e continuidade além de seis capítulos |
| Capacidade | `studio-story` estima chamadas para roteiros | Separar capacidade de texto, imagens, voz, animação e finalização |
| Modal | Scripts executam geração real; há tomadas aprovadas | Worker genérico implantado, tarefas duráveis e ligação com o botão do painel |
| Roteamento | `video-routing.ts` filtra qualidade, gratuidade recorrente e grupos de cota | Adaptadores de produção, consulta de saldo, reservas e execução persistente |
| Assets | Checkpoints de imagem, voz e legenda | Gerar referências visuais aprovadas e clipes por tomada |
| Montagem | Renderer aceita `video_clip` associado à cena exata | Perfil de FPS por projeto e tratamento de áudio nativo versus condicionado |
| Fila | Leases, orquestração e dispatch de Actions existentes | Subtarefas de vídeo, reconciliação e retomada sem geração duplicada |

Evidências: `apps/web-panel/components/story-discovery.tsx`, `apps/web-panel/app/api/stories/route.ts`, `supabase/functions/studio-story/index.ts`, `supabase/functions/generate-assets/handler.ts`, `packages/core/src/stories/{schema,direction,video-routing}.ts`, `apps/local-renderer/src/{clip-render,render-utils}.ts`, `scripts/modal-speech-motion-probe.py`, `supabase/migrations/20261005000000_optional_story_series.sql`.

Hoje a API declara `animated_available: false`; o renderer comum usa 30 FPS; a estrutura da série limita capítulos a seis; o contrato de tomada limita duração a cinco segundos. Os testes avulsos a 60 FPS não mudaram esses contratos. A integração precisa alterá-los explicitamente, preservando o modo ilustrado e os outros tipos de conteúdo.

Os testes anteriores demonstram tomadas viáveis, não um gerador de capítulos inteiros já pronto. Uma montagem com trechos reutilizados ou imagens paradas não serve para estimar o preço de um episódio novo inteiramente animado. Os antigos valores de saldo citados no chat não são saldo atual confirmado.

Situação confirmada nesta revisão: Modal é a única rota com resultados de animação/fala aprovados para o padrão pretendido, ainda usada pelos scripts de teste. Não existe segunda fonte validada e integrada para continuar essas novelas. HF tem adaptadores experimentais e resultados reprovados para esse uso; Veo tem script de avaliação, sem integração produtiva validada; Auray é candidata pesquisada. A geração animada completa pelo painel continua pendente inclusive para Modal.

## 3. Jornada simples para o usuário

### Criar

1. **Nova novela:** escolher **Criar com minha ideia** ou **Criar novela automaticamente**. No automático, nenhuma sinopse/premissa precisa ser digitada. Gênero, elenco existente, duração e quantidade de capítulos são preferências opcionais, preenchidas pelo sistema quando omitidas. O padrão será vertical, com uma única variante para não multiplicar produção sem necessidade.
2. **Ver proposta:** título, sinopse, elenco, estilo e arco da temporada. Mostrar separadamente o custo de preparar elenco/cenários inéditos e o de animar capítulos.
3. **Aprovar identidade:** imagens de referência e amostras de voz. Reaproveitar o elenco aprovado quando escolhido. Uma troca de roupa ou emoção não deve recriar a identidade do personagem.
4. **Ver plano de produção:** capítulos planejados, duração de cada um, o que cabe agora, consumo previsto e reserva para correções. Planejar dez capítulos não dispara dez gerações.
5. **Gerar capítulo:** uma ação reserva capacidade e inicia as etapas. Mostrar progresso real, por exemplo, “3 de 5 cenas concluídas”, fila do provedor e intervalo estimado de espera.
6. **Revisar:** assistir, baixar, aprovar ou apontar uma cena para correção. Aprovação de publicação continua separada da geração.

A duração desejada será uma meta, ajustada ao tempo real da fala e às durações aceitas pelos modelos. Antes da geração cara, apresentar a duração planejada e um orçamento atualizado. Um capítulo curto precisa ter acontecimento, reação e conclusão ou gancho; não apenas interromper uma fala para caber no saldo.

Não exigir conhecimento de GPU, modelo, interpolação ou créditos de cada site. Configurações avançadas ficam recolhidas. O modo simples oferece qualidade aprovada e a sugestão de duração que cabe no orçamento. Mensagens, botões e progresso devem funcionar no celular, com teclado e sem depender apenas de cores.

### Botão Criar novela automaticamente

O botão produz uma proposta completa: título, sinopse, gênero/tom, universo, protagonistas/antagonistas, aparência descrita, personalidade, objetivos, relações, cenários, conflito central, arco da temporada, acontecimentos de cada capítulo, ganchos e desfecho previsto. Planejar o final evita uma sucessão de capítulos sem resolução. A criação deve variar premissas e conflitos em relação ao catálogo do usuário, sem prometer originalidade absoluta verificável por um filtro.

As sugestões consideram capacidade e padrão audiovisual disponíveis: evitar propor uma multidão ou ação extensa como se custasse o mesmo que dois personagens conversando. A economia prioriza duração e quantidade de capítulos; não reduz escondido nitidez, movimento ou sincronização. A proposta explica quando personagens/cenários novos exigem preparação adicional.

Se houver perfil e elenco aprovados, o sistema pode selecioná-los conforme as preferências salvas. Elenco novo exige geração das referências visuais e vozes na etapa própria. A descrição textual de uma personagem não conta como imagem pronta, e a geração dessas imagens não é apresentada como gratuita sem consultar a franquia correspondente.

Controles simples após a proposta: **Usar esta novela**, **Gerar outra proposta** e **Editar**. Permitir fixar itens que o usuário gostou e recriar somente o restante. Repetir a proposta consome apenas os recursos necessários àquela etapa, com cota e tentativas limitadas; não refaz vídeos ou imagens aprovadas. O roteiro passa por verificação de coerência, duração, viabilidade e requisitos de conteúdo antes da geração cara.

Separar explicitamente no produto:

- **Criar novela automaticamente:** cria o projeto narrativo e o plano; pode consumir cota de texto, sem disparar animação por engano.
- **Gerar capítulo:** produz o vídeo a partir do plano, com identidade e orçamento definidos.
- **Produzir próximos capítulos:** automatiza a fila dentro de limites salvos e das regras de revisão abaixo. Não significa publicação automática.

O usuário não precisa escrever prompts técnicos em nenhum desses caminhos. Uma ação explícita de produzir, ou uma configuração de produção previamente autorizada, é o que permite reservar/consumir os recursos de vídeo. O botão e sua descrição deixam claro qual dessas etapas será executada.

### Continuar

Na biblioteca: capa, sinopse, capítulo atual, status, botão **Continuar novela** e lista dos capítulos aprovados. O usuário pode deixar o sistema continuar ou acrescentar uma orientação, como “no próximo capítulo, ela descobre a traição”.

Manter uma memória estruturada: relações, objetivos, segredos revelados, quem sabe o quê, local, horário, roupa, objetos, estado emocional e ganchos pendentes. Usar a versão aprovada do capítulo anterior. Um resumo curto isolado não preserva tudo isso.

Permitir novos arcos/temporadas além dos seis capítulos atuais. Editar um capítulo antigo cria versão; não sobrescreve o vídeo aprovado nem muda silenciosamente os capítulos posteriores. Se afetar continuidade, sinalizar os capítulos que precisam de revisão. Refazer uma tomada preserva as demais; alterar uma fala invalida seu áudio, sincronização e legendas dependentes.

### Automação opcional

Padrão inicial: concepção automática disponível, gerar um capítulo e revisar. Oferecer “produzir os próximos N capítulos” dentro de um teto previamente definido; na primeira versão, a fila aguarda a aprovação do capítulo atual antes de avançar na continuidade. Gerar automaticamente sinopse, personagens e arco não depende dessa funcionalidade de lote. Não enviar mensagens externas ou publicar apenas porque um vídeo terminou.

## 4. Saldo e capacidade: como apresentar e calcular

### Tela principal

Antes do roteiro, apresentar faixa aproximada de **segundos novos animados no padrão escolhido**, apenas quando houver medições suficientes. Sem histórico suficiente: “estimativa em calibração”, sem fabricar uma precisão.

Após planejar, usar uma mensagem como esta, com números exclusivamente ilustrativos:

> Você planejou 5 capítulos de aproximadamente 20 segundos.
> A capacidade confirmada comporta 2 capítulos agora, com margem para correções.
> Os demais ficam planejados. Nenhuma geração foi iniciada.
> [Gerar capítulo 1] [Ajustar duração] [Ver fontes e saldo]

Detalhes por fonte: conta identificada por apelido, saldo e unidade próprios, valor reservado, disponível para novos trabalhos, data/hora da consulta, renovação/validade verificadas, capacidades aprovadas e motivo de indisponibilidade. Mostrar também consumo deste capítulo e histórico estimado versus medido. Crédito futuro fica em uma previsão separada, nunca somado ao disponível hoje.

Não converter tudo para reais: câmbio não torna franquias diferentes intercambiáveis. Distinguir crédito computacional consumido de dinheiro adicional cobrado. Benefício de assinatura já existente deve ser identificado como tal, separado de serviço independente gratuito.

### Quando somar fontes

| Situação | Resultado correto |
| --- | --- |
| A comporta 5 capítulos e B comporta 10 do mesmo plano, com continuidade audiovisual validada para aquela novela e cotas independentes | Pode mostrar estimativa total de 15, com distribuição 5 + 10 nos detalhes |
| B tem boa qualidade isoladamente, mas muda a aparência/voz daquela novela | Mostrar capacidade para projetos compatíveis separados; não somar à continuação |
| B só produz planos de cenário/reação, sem a fala necessária | B complementa cenas e pode poupar A; não representa mais 10 capítulos completos |
| Duas APIs/Spaces gastam a mesma cota | Contar a carteira uma vez |
| Há crédito, mas conta bloqueada, API inelegível ou qualidade reprovada | Não incluir na capacidade produtiva |
| Há vídeo disponível, mas faltam voz, referências, armazenamento ou capacidade de montagem | Mostrar o gargalo e reduzir a capacidade executável |
| Crédito renova amanhã ou depende de resgate | Mostrar previsão, sem reservar como se estivesse disponível |

Fixar o padrão audiovisual por **novela**, atravessando todos os capítulos. O roteador só usa modelos/versões e fontes homologados para aquele padrão, elenco e tipo de tomada. Misturar por cena somente após validar a combinação; nunca dividir a mesma tomada entre geradores. Esgotar saldo não remove essa restrição.

Na página da novela, mostrar **Capacidade para continuar esta novela**. Na visão geral, separar capacidade de projetos compatíveis e fontes ainda em avaliação. Não anunciar uma soma global em capítulos de durações/estilos diferentes como se todos servissem para qualquer série. A cotação inclui `series_id`, versão do padrão e compatibilidades; uma carteira com saldo pode contribuir zero para aquela continuação.

Exemplo de mensagem sem valores reais: “Capítulos 1 e 2 concluídos. A fonte compatível está sem saldo. A fonte B tem créditos, mas ainda não foi validada para manter esta novela. Próximo capítulo aguardando capacidade compatível.” Oferecer esperar renovação ou avaliar a alternativa com limite de consumo conhecido; nunca iniciar a avaliação apenas porque o saldo principal acabou.

### Motor de estimativa

Cada modelo terá capacidades e preços versionados: resolução, duração mínima/máxima, blocos cobrados, áudio de entrada/nativo, referências, FPS de origem, pós-processamento, limites, prazo e licença. O orçamento considera texto, novas referências, voz, GPU/CPU/RAM, inicialização, interpolação, montagem, armazenamento e transferência aplicáveis.

No Modal, segundos de vídeo não equivalem a segundos de GPU. Calibrar por configuração usando relatórios das execuções aprovadas e consulta de faturamento. Não extrapolar uma única amostra nem chamar `30 - uso` de saldo universal: créditos aplicáveis, ciclo, limites e consumo externo precisam ser reconciliados. A documentação oferece consulta de resumo, relatório e tarifas: [Modal billing](https://modal.com/docs/cli/latest/billing).

Por carteira, o planejador usa capacidade disponível menos reservas em andamento, consumo ainda não conciliado e margem operacional, sem descontar o mesmo consumo duas vezes. Reserva a estimativa conservadora do capítulo completo, incluindo uma margem limitada de refação. Com poucas amostras, usar limites conservadores de execução; depois, atualizar intervalos a partir do histórico, sem falsa precisão estatística.

Alocar as tomadas respeitando requisitos e cotas reais; repetir a simulação para os capítulos do plano até encontrar o limite. Não basta dividir segundos totais por duração média: arredondamentos de cobrança, diálogos, imagens novas e limites de cada modelo alteram o resultado.

Ao clicar em gerar, revalidar saldo e preço e fazer reserva atômica no banco. Mudança material no plano exige nova apresentação antes de iniciar; um clique duplo não duplica reserva. O consumo medido substitui a estimativa ao ser conciliado. Tarefas de status desconhecido mantêm reserva pendente. A garantia é de controle conservador, não de precisão instantânea da fatura externa.

## 5. Qualidade e direção

Criar um perfil versionado com as referências e configurações das tomadas aprovadas, separado dos testes reprovados. Os PNGs locais usados nos testes devem virar referências privadas duráveis no projeto. Prompt e seed sozinhos não garantem reconstruir a mesma personagem.

Cada cena terá intenção dramática e cada tomada terá enquadramento, ação, poses inicial/final, emoção, quem fala, reação de quem escuta e posição de objetos. Planejar close, plano médio, plano de situação e reação conforme a história. Não cortar para mala/passagem durante toda a fala se a intenção é ver o personagem falando.

Aplicar as metas editoriais documentadas no ADR-062 como base a validar para cada duração: cobertura animada relevante e presença do personagem nas falas; planos de detalhe breves e intencionais. Não impor diversidade artificial de três enquadramentos dentro de uma única tomada curta.

Separar **FPS de origem**, **FPS de saída** e **qualidade do movimento**. Aumentar o número escrito no arquivo ou repetir quadros não cria atuação. Preservar o perfil de finalização aprovado, inclusive 60 FPS quando adequado, verificando fantasmas e deformações na interpolação. Upscale/nitidez não recuperam automaticamente olhos ou dedos deformados; nesses casos, a correção pode exigir nova tomada.

Voz por personagem deve ter identificação e versão estáveis. Provedor que recebe nosso áudio pode preservar a voz condicionada; provedor que gera fala nativa exige avaliação própria. A montagem precisa distinguir áudio condicionado, áudio nativo e narração. Não substituir fala nativa por outro TTS e presumir que a boca continuará sincronizada.

QA técnico verifica integridade, duração, resolução, quadros congelados/repetidos, cortes, áudio, alinhamento, legendas e correspondência dos assets. Sinais automáticos de rosto, mãos e lipsync ajudam a triagem, mas não certificam perfeição. A revisão humana do resultado continua necessária. Correções têm teto de tentativas/consumo; nunca um loop ilimitado de “melhorar”.

### Continuidade audiovisual entre capítulos e provedores

**Qualidade boa não equivale a continuidade boa.** Um capítulo mais realista ou tecnicamente mais nítido pode descaracterizar uma novela que começou com animação estilizada. Avaliar separadamente a qualidade da cena e a compatibilidade com os capítulos aprovados, incluindo o corte entre o final de um e o início do outro.

Separar três camadas no contrato de produção:

| Camada | O que preservar |
| --- | --- |
| História | Sinopse, personagens, relações, acontecimentos e arco |
| Identidade audiovisual | Rostos/corpos, proporções, materiais, cabelo/roupa, vozes, direção de arte, iluminação conforme a cena, atuação, câmera e acabamento |
| Execução | Modelo/pesos/versão, entradas, código, parâmetros, áudio, pós-processamento e infraestrutura |

Modal é infraestrutura para executar o modelo, não o nome do modelo visual. O worker atual fixa revisões do Wan e do RIFE e parâmetros de geração em `scripts/modal-speech-motion-probe.py`. Procurar outra infraestrutura capaz de executar esse mesmo conjunto é uma estratégia de portabilidade diferente de trocar para Veo. A primeira reduz variáveis, mas ainda exige memória suficiente, franquia elegível, termos adequados, transporte dos pesos e teste de equivalência. Hardware/precisão podem alterar resultados; seed igual não garante os mesmos pixels.

Uma API de outro modelo precisa de avaliação mais ampla. A [documentação do Veo](https://ai.google.dev/gemini-api/docs/veo?hl=en) descreve imagens de referência e direção por frames. Esses controles orientam a geração; inferir que reproduzirão exatamente nosso personagem, voz e acabamento de outro modelo seria indevido. Não pressupor suporte às mesmas entradas em todas as versões/rotas da API.

Criar um pacote canônico por novela: referências originais aprovadas, vistas adicionais aprovadas quando disponíveis, proporções, figurino por cena, paleta/materiais, cenários, exemplos de atuação, voz/versionamento e amostras audiovisuais. Armazenar esses arquivos na nuvem e sempre compará-los com a origem. Evitar alimentar sucessivamente apenas o último resultado gerado, acumulando mudanças de rosto ao longo dos capítulos.

O padrão será ligado a versões dos modelos/adaptadores e ao elenco. A aprovação de um provedor para uma novela não libera todas as novelas. Uma atualização de modelo, voz ou pós-processamento relevante exige reavaliação; aliases atualizados silenciosamente não podem ser tratados como configuração eternamente idêntica. Se o serviço não permitir fixar versão, registrar isso como limitação e verificar deriva.

### Procedimento de qualificação de uma segunda rota

1. Verificar elegibilidade gratuita, saldo, entradas suportadas, durações, voz e custos sem inferência. Rejeitar incompatibilidades antes de gastar.
2. Definir uma avaliação pequena, com orçamento limitado e os mesmos personagens/referências da novela. Reaproveitar uma tomada Modal aprovada como controle em vez de gerar novamente o controle.
3. Produzir inicialmente uma tomada representativa; ampliar apenas se passar. Antes de liberar capítulos completos, cobrir diálogo/emoção, mãos/corpo e interação de personagens/cenário quando o roteiro exigir. Uma tomada estática bonita não qualifica toda a produção.
4. Comparar lado a lado e na sequência de continuidade: identidade, textura, nitidez, movimento, voz e lipsync. Métricas auxiliam; o usuário aprova uma mudança de modelo para sua novela após ver evidência concreta.
5. Registrar um resultado por padrão/tipo de cena: **compatível**, **uso restrito**, **somente novos projetos** ou **reprovado**. Uso restrito a cenário não autoriza trocar rostos/diálogos.
6. Somente a rota compatível passa a participar automaticamente das próximas reservas daquela novela. Refazer a cotação descontando o custo da avaliação e mantendo reserva de produção.

Se não houver correspondência suficiente, manter a novela aguardando a fonte original. Outra fonte pode servir a uma nova novela com padrão próprio. Uma mudança perceptível de estilo na série existente só ocorre como versão deliberadamente aprovada; não será chamada de continuação visual idêntica nem realizada por falta de saldo. Mesmo após qualificação, verificar cada capítulo: a aprovação reduz risco, não garante ausência de erros.

## 6. Fontes e ordem de habilitação

| Fonte | Papel proposto | Condição para contar no painel |
| --- | --- | --- |
| Modal | Primeira rota de fala/animação com configuração aprovada | Saldo/limites atuais, worker integrado e teste completo pelo Studio |
| Auray | Próxima candidata a segunda fonte por API | Conta Free, preços/saldo reais, referência e vídeo avaliados; só contar os tipos de cena aprovados |
| Google / Veo | Conector condicional a benefício já existente | Crédito resgatado e aplicável à API, conta ativa, controles de gasto e qualidade/voz validados |
| Hugging Face | Adaptação experimental específica | Cota real e modelo que passe no padrão; testes de fala reprovados não entram como substituição |

Na consulta de 08/10, a [Auray anuncia 50 créditos mensais e geração via API no Free](https://auray.ai/pricing). Isso justifica avaliar a rota, mas não comprova qualidade equivalente. O [schema público do modelo](https://api.auray.ai/v1/models/auray-ai/minimax-h3/text-to-video/openapi.json) aceita referências/imagem inicial e duração de 5–15 segundos, sem campo de áudio de entrada na versão consultada. Não prometer a mesma voz do Modal. Preço com referências e disponibilidade precisam ser conferidos na conta; a estimativa comercial do site não é uma promessa de capítulos.

O [Google Developer Program](https://developers.google.com/profile/help/benefits) descreve créditos mensais vinculados à assinatura e utilização no Cloud, incluindo Vertex AI. O crédito exige resgate em conta elegível. A primeira conta mostrada pelo usuário está fechada; a segunda não foi confirmada. Flow e API são carteiras distintas; não há integração oficial demonstrada neste projeto para debitar os créditos do Flow. Não basear produção automática em controle de navegador.

ZeroGPU compartilha cota entre Spaces da mesma conta; conferir disponibilidade na [documentação oficial](https://huggingface.co/docs/hub/spaces-zerogpu). Rotas com qualidade reprovada permanecem fora da contagem. Sites com crédito apenas inicial ou sem acesso automático elegível não atendem à política solicitada.

Adicionar conta/fonte significa conectar, verificar capacidades, saldo, condições e qualidade e somente então habilitar. Chave válida, isoladamente, não significa geração disponível. Duas contas legítimas só agregam franquias quando forem independentes e seu uso for permitido; não pressupor dois saldos por existirem duas chaves.

## 7. Arquitetura para operar sem o computador do usuário

Reaproveitar Supabase, orquestrador, contratos de assets, renderer e Actions. Não criar um segundo sistema isolado de produção. A fila e o controle de orçamento ficam fora do Modal: esgotar a GPU do Modal não pode desligar o mecanismo que acionaria outra fonte.

Fluxo: planejamento → referências/voz → orçamento final → reserva → tarefas por tomada → adaptador → verificação → montagem → revisão. Cada etapa registra progresso e checkpoint. Fechar a aba não cancela o trabalho.

Novos contratos persistentes, com nomes a consolidar na implementação:

- Conexões/carteiras: proprietário, grupo de cota compartilhada, credencial protegida, capacidades aprovadas, snapshot e ciclo.
- Planos de produção: versão do roteiro, referências, vozes, perfil, durações, distribuição por fonte e orçamento.
- Tomadas/tentativas: inputs com hashes, identificador externo, aceite, resultado, estado, artefatos e custo conciliado.
- Reservas/lançamentos: registro atômico por carteira, capítulo e tentativa, incluindo liberações e pendências.
- Continuidade: versões de elenco, cenários e memória dos acontecimentos aprovados.
- Criação automática: origem manual/automática, preferências opcionais, elementos fixados, propostas versionadas e operações idempotentes para não criar várias séries por clique repetido.
- Compatibilidade: padrão audiovisual por série, versões de modelos/execução, evidências de avaliação, escopo de cenas permitido e motivo de bloqueio; consultado tanto na estimativa quanto no envio.

Adaptadores expõem verificação, cotação, envio, consulta, cancelamento quando suportado e obtenção do resultado. Uma resposta ambígua requer reconciliação do identificador externo antes de qualquer reenvio/fallback. Ausência de idempotência nativa exige bloqueio local e tratamento explícito da janela entre envio e persistência; não prometer execução externa exatamente uma vez.

Extrair o worker Modal dos scripts, parametrizando personagem, áudio, direção e saída. Usar execução assíncrona durável, sem manter o navegador ou uma função HTTP aguardando a GPU. O [Modal documenta envio assíncrono e recuperação por identificador](https://modal.com/docs/guide/job-queue); resultados precisam ser copiados para armazenamento próprio, sem depender da retenção temporária do provedor.

O isolamento do worker atual não pode ser removido incidentalmente para permitir upload. Definir uma etapa de transporte com acesso mínimo aos objetos daquela tarefa, mantendo segredos administrativos do banco fora da GPU. Persistir referências e saídas privadas com hashes e links temporários quando necessários ao provedor; não depender de caminhos `D:\...` ou da pasta `output` local.

Usar o agendamento/orquestração existente para despachar e conciliar. Actions será usado em tarefas limitadas, sem ficar horas apenas esperando GPU. Validar a ponte de execução Python e o consumo de minutos antes de ativar. Renderização/armazenamento também entram na capacidade: GPU gratuita não torna o restante infinito.

Leases por tomada, transições atômicas, eventos deduplicados, permissões por workspace e credenciais apenas no servidor. Login, autorização inicial e renovação excepcional de credenciais podem exigir ação do titular; a produção de cada capítulo não deve exigir trabalho manual externo.

## 8. Falhas e comportamento esperado

| Evento | Comportamento |
| --- | --- |
| Duplo clique, duas abas ou requisição repetida | Mesma tarefa/reserva; não gerar novamente |
| Crédito insuficiente antes de iniciar | Preservar o roteiro; oferecer duração menor, fonte compatível ou espera |
| Cota acaba durante a produção | Preservar cenas; terminar o que já foi aceito e pausar/replanejar o restante |
| Provedor cai antes de aceitar | Usar alternativa aprovada dentro da reserva |
| Timeout após possível aceite | Consultar/reconciliar; não disparar automaticamente em outro lugar |
| Worker interrompe, callback repete ou orquestrador reinicia | Retomar checkpoint e deduplicar eventos; contabilizar tentativas externas |
| Olho/mão/voz sai errada | Refazer somente a tomada afetada, dentro do teto; manter a anterior até aprovar |
| Nova fonte altera voz/identidade entre cenas ou capítulos | Bloquear substituição automática e explicar incompatibilidade; créditos dessa fonte não contam para continuar a série |
| Modelo recebe atualização que altera o resultado | Pausar novos envios nessa versão/padrão e reavaliar; preservar capítulos anteriores |
| Criação automática propõe história fora do orçamento ou repete conceitos | Replanejar texto com tentativas limitadas; não reduzir qualidade ou consumir GPU para corrigir a proposta |
| Saldo desatualizado, API muda preço ou benefício desaparece | Revalidar; suspender novos envios que dependam da informação |
| Todas as fontes acabam | Mostrar quando cada uma renova, se conhecido; retomar a fila já autorizada após conferir saldo |
| Usuário pausa/cancela | Não iniciar novas tomadas; tentar cancelar as aceitas quando permitido, sem prometer estorno |
| Montagem/download falha | Recuperar os clipes existentes, sem refazer inferência |
| Storage ou minutos Actions acabam | Mostrar esse gargalo; não continuar consumindo GPU sem caminho de conclusão |
| Mudança em capítulo/voz/referência | Invalidar apenas dependências afetadas e preservar versões/revisões anteriores |

Aplicar limites de uso e de desembolso no provedor quando disponíveis, além da reserva interna. [Modal distingue limite bruto de uso e limite líquido de gasto](https://modal.com/docs/guide/budgets). Não confundir alerta com bloqueio nem ignorar armazenamento ou consumo externo. A configuração deve favorecer interrupção conservadora quando o saldo não puder ser verificado.

## 9. Entregas em ordem

| Etapa | Entrega | Critério para encerrar |
| --- | --- | --- |
| 1. Contratos e orçamento | Separação de capacidades, carteiras, reservas, tarefas por tomada, padrão por novela e compatibilidade entre rotas | Testes de concorrência, saldo compartilhado, capacidade desconhecida, arredondamento e exclusão de fonte incompatível mesmo com saldo |
| 2. Primeira integração completa | Worker Modal genérico, transporte, fila e assets conectados ao Studio usando elenco já aprovado | Um capítulo novo gerado pelo painel, salvo na nuvem, retomável sem PC e com consumo registrado |
| 3. Criação e continuidade | Botões manual/automático, concepção completa, referências/vozes, storyboard, duração curta, temporadas e refação por cena | Criar proposta sem digitar sinopse/elenco, editar seletivamente, produzir e continuar após fechar a aba; não depender de scripts específicos de Malu |
| 4. Segunda fonte real | Avaliar portabilidade do worker e candidata Auray; Google condicionado à elegibilidade; qualificar por novela | Geração autêntica, custo confirmado, comparação entre capítulos, aprovação de compatibilidade e teste de esgotamento sem troca visual silenciosa |
| 5. Acabamento e operação | Capacidade conjunta, finalização/FPS/áudio, biblioteca, exportação, diagnóstico, monitoramento e recuperação | Fluxo completo com erros induzidos, continuidade de capítulos, testes no celular e preservação dos modos existentes |

As etapas incluem UI e validação proporcional, não apenas backend. A primeira entrega vertical usa referências existentes para reduzir gasto de preparação; a entrega final também exige criar elenco/cenário novo por uma rota disponível, sem depender de imagens feitas manualmente nesta conversa.

Nenhuma etapa é concluída apenas por haver código ou mocks. Diferenciar no acompanhamento: planejado, implementado localmente, testado, implantado e validado pelo painel. Estimar prazo após fechar transporte/credenciais e medir uma execução completa; não prometer calendário baseado no tempo de um teste isolado.

## 10. Validação e lançamento

Automatizar testes relevantes de reservas concorrentes, renovação/expiração, consumo externo, duração real e blocos cobrados, cota compartilhada, falha após aceite, callbacks duplicados, retomada, acesso entre workspaces e invalidação de assets. Exercitar montagem com áudio nativo e condicionado e perfis de FPS; verificar que o conteúdo ilustrado/factual continua funcionando.

Adicionar cenários desta revisão: criar automaticamente sem premissa preenchida; recriar somente arco preservando elenco fixado; nenhuma animação disparada pelo botão de concepção; continuar capítulo 3 após esgotar a fonte dos capítulos 1–2; alternativa com saldo mas estilo/voz incompatíveis; compatibilidade aprovada para outra série apenas; atualização de versão do modelo; orçamento consumido por avaliação; fonte aprovada só para cenários; estabilidade do padrão mesmo quando a fonte alternativa produz uma imagem isoladamente mais bonita. Validar esses bloqueios no servidor, além dos textos do painel.

Usar vídeos aprovados como referência de regressão visual, não apenas resolução e FPS de metadata. Conferir voz, olhos, mãos, expressão, variedade, movimento e legibilidade das legendas. Uma avaliação por modelo/versão e tipo de cena determina o que entra na produção.

Antes de novos testes de GPU, consultar o saldo atual e definir uma reserva explícita para validação, preservando uma reserva de produção. Não repetir audições sem uma hipótese e um critério de aceite. Parte das falhas operacionais pode ser testada com fixtures locais, sem gastar franquia de vídeo.

Migrar de forma aditiva e reversível; manter episódios existentes. Ativar primeiro no workspace do operador com flag; só habilitar automaticamente uma nova rota quando passar pelos critérios. Rollback interrompe novos envios e continua conciliando tarefas já aceitas, sem apagar resultados ou reservas pendentes.

Pronto significa: criar uma novela nova, estimar o orçamento, gerar e revisar um capítulo, continuar o seguinte com identidade preservada, corrigir uma cena, fechar/reabrir o painel e recuperar o estado, acompanhar saldo/consumo e usar uma segunda fonte realmente habilitada ou informar precisamente por que ela está indisponível. A existência de uma interface para vários provedores não será apresentada como segunda fonte operacional.

## 11. Dependências e decisões propostas

Decisões recomendadas: criação manual ou automática completa; capacidade específica para continuar cada novela e detalhamento por fonte; estimativa por plano; orçamento conservador; um capítulo por revisão inicialmente; qualidade e identidade aprovadas como piso; padrão audiovisual fixado por novela, não apenas por capítulo; troca de modelo condicionada a compatibilidade demonstrada; modo gratuito recorrente como padrão; uma orientação por projeto; continuidade além de seis capítulos; geração e publicação separadas.

Dependências ainda não resolvidas: saldo Modal atual, credenciais/saldo/qualidade Auray, elegibilidade Google, rota automática aprovada para novas referências, limites reais do ambiente de armazenamento/Actions e preservação das vozes entre fontes. São verificações de implementação, não suposições de capacidade já disponível.

Adicionar fontes pode ampliar produção e reduzir dependência, mas não cria uma franquia ilimitada nem garante que um vídeo novo sairá perfeito na primeira tentativa. O compromisso do produto é mostrar capacidade honesta, automatizar o trabalho repetitivo, preservar o padrão aprovado e parar de forma recuperável quando faltar um recurso.
