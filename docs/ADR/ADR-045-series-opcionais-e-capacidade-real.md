# ADR-045 — Séries opcionais e capacidade real

Data: 2026-10-05. Status: modo ilustrado implementado; geração de clipes depende de provedor e cota confirmados.

## O — Objetivo

Adicionar histórias originais e novelas de frutas sem substituir os vídeos independentes de gadgets ou os outros assuntos. Tornar a criação, revisão e continuação simples dentro do Studio, mantendo orçamento gratuito e aprovação humana.

## C — Contexto

A fila, geração explícita, isolamento por workspace, revisão web/Telegram, render com imagens e publicação por canais já existem (ADR-042/044). Recriá-los seria redundante. O renderer aceita imagens com movimentos de câmera; o tipo `video_clip` no banco não significa que clipes sejam processados. Não há credencial/cota de geração de vídeo confirmada no ambiente.

Novela é ficção, enquanto pesquisa de tendências exige evidência factual. Inserir ficção no mesmo contrato de fontes produziria citações inventadas ou relaxaria a checagem dos gadgets. Trocar modelos não cria novas cotas gratuitas: elas continuam compartilhadas por conta.

## S — Solução

- O seletor abre por padrão em **Vídeo de assunto**, mantendo a descoberta factual existente. **História original** e **Novela de frutas** são escolhas adicionais. Um capítulo produz uma história independente; três ou seis formam minisséries. Não existe migração automática de pautas antigas para ficção.
- O operador descreve a ideia e escolhe gênero/quantidade. **Criar proposta** guarda título, premissa, elenco, aparências, cores, duas opções de voz e arcos dos capítulos. Mostra o plano e uma prévia das artes. Essa ação consome roteiro, mas não inicia vídeo. Até três novas propostas por workspace/dia UTC, com lease e replay para impedir chamadas concorrentes duplicadas.
- **Gerar capítulo** prepara uma pauta com snapshot congelado e reutiliza a geração explícita existente. Histórias pendentes não são consumidas pelo modo automático. Pautas factuais continuam com suas regras anteriores.
- **Continuar história** exige aprovação da versão atual de cada capítulo anterior. O próximo recebe somente os resumos dessas versões e o mesmo elenco. A preparação é atômica e idempotente; cliques repetidos não criam capítulos duplicados. A edição comum não pode mudar o elenco, enredo ou links de uma pauta de história. Uma tentativa interrompida pode ser gerada novamente; propostas concluídas ou não iniciadas podem ser arquivadas. Vídeos anteriores ficam em Gerações.
- Mantém os estados `idea → research → script → assets → rendered → review`. Para ficção, `research` valida o snapshot narrativo (`fiction_plan`) e não consulta Tavily. Script e assets verificam a correspondência entre briefing, plano e contexto. Vídeos factuais ainda exigem fontes e evidência recuperada; a IA factual não controla o campo `fiction`.
- O roteiro tem 5–7 cenas e CTA orgânico final, pelo menos 175 palavras verificadas no QA e alvo de pelo menos 60s. Solicita 200–240 palavras, decisões/consequências, falas diretas e objetos de cena. Duração real continua medida no áudio e no MP4; alvo editorial não substitui medição.
- Artes SVG próprias (`license=own`, `source=system`) mantêm elenco, cenário, emoção e objeto narrativo, em 9:16 e 16:9, com duas tomadas por cena. O renderer converte SVG limitado para PNG via Sharp, rejeitando referências externas/conteúdo ativo. As vozes Antonio/Francisca ficam fixas por personagem. Há duas vozes, não uma voz exclusiva para cada um dos três personagens. Se Edge falhar, não muda silenciosamente o elenco para outra voz.
- Os dois canais recebem CTA orgânico, identificação de ficção e conteúdo sintético. Quando os finais são iguais, áudio/render são reutilizados, evitando produzir uma cópia redundante. Revisão, direitos e aprovação por destino continuam obrigatórios; nenhuma postagem é iniciada por criar/continuar a série.
- Gemini usa o budget guard existente. Se indisponível, há alternativa OpenRouter com modelos específicos `:free`; o catálogo atual deve confirmar custo zero, e o request impõe preço máximo zero. Reserva atômica compartilhada (teto conservador inicial de 20 chamadas/dia), eventos `ai_provider_call`, backoff limitado e pausa em 402/429. Não se usam novas contas/chaves para contornar limites. O elenco/vozes/arte não dependem da identidade do modelo de texto.
- O painel consulta episódios criados, produção em andamento, limite configurado, propostas utilizadas e cotas compartilhadas de texto/modelo. O contador de vídeos é **estimativa**, reservando margem para correção de roteiro; saldo desconhecido não vira capacidade inventada. Não mostra segredos, saldo de terceiros ou custos em moeda sem dado verificável. Os limites diários do Studio são UTC; Gemini segue o período de sua reserva existente em America/Los_Angeles.
- A revisão de ficção vincula também o contexto original ao fingerprint. Snapshots factuais preservam exatamente o formato anterior, mantendo aprovações existentes. A deduplicação editorial inclui continuidade e aparência, mas exclui UUID aleatório da série.
- Atualizados Next.js 16.3.8 e Sharp 0.35.5 após auditoria identificar vulnerabilidades nas versões anteriores; auditoria local sem vulnerabilidades conhecidas após as alterações.

## P — Prevenção, validação e dependências

- Modo ilustrado é desenho próprio com câmera, TTS e legendas. Não é animação labial nem vídeo generativo semelhante ao exemplo do TikTok. Cenas animadas ficam indisponíveis até existir um provedor autorizado, cota real, suporte no renderer e QA dos clipes. Não se apresenta uma opção vazia como se funcionasse.
- Trocas de API ficam no servidor, com limite de tentativas e consumo registrado. Modelos gratuitos podem ser removidos ou ter filas; produção pode pausar mesmo com estimativa positiva. GitHub Actions/Storage também têm limites; o contador não é promessa de render bem-sucedido ou de alcance.
- Não é necessário cliente configurar API para o modo ilustrado. Adicionar geração externa exigirá uma conexão administrada ou autorização do usuário, sem copiar credenciais no formulário de pauta.
- Testes cobrem contrato factual, personagens, duração, hashes, escaping, PNG real nas duas orientações, checkpoints de artes, modelo pago/limite externo, tenant, replay, fila explícita, resumo aprovado e invalidado, revisão e ausência de publicação automática.
- O conteúdo ainda exige leitura humana: QA estrutural não comprova originalidade, qualidade dramática, voz agradável nem viralização.

Referências oficiais consultadas: [OpenRouter — limites](https://openrouter.ai/docs/api_reference/limits), [roteador gratuito escolhe modelos dinamicamente](https://openrouter.ai/docs/guides/routing/routers/free-router), [Cloudflare — franquia Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Pollinations — autorização e créditos do usuário](https://github.com/pollinations/pollinations/blob/main/BRING_YOUR_OWN_POLLEN.md), [Hugging Face — créditos de inferência](https://huggingface.co/docs/inference-providers/pricing), [correção Next.js](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), [correção Sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
