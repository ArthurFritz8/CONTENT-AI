# ADR-072 — Cadastro visual do padrão da novela

Data: 09/10/2026. Continuação dos ADRs 069–071.

O painel permite cadastrar referências privadas por personagem, ouvir amostras de voz e fixar o padrão antes do primeiro capítulo. A identidade da série e a aprovação de uma fonte de animação são decisões separadas. Salvar uma identidade não cadastra compatibilidade, habilita carteira ou cria jobs de GPU.

## Fluxo do usuário

Após criar a proposta manual ou automática, abrir **Configurar imagens e vozes da novela**. Enviar uma imagem vertical por personagem, clicar **Preparar prévias de voz**, ouvir o elenco, conferir o estilo e confirmar **Fixar padrão da novela**. A primeira versão oferece Francisca e Antonio em português; personagens do mesmo tipo compartilham a voz. Não há clonagem nem criação automática de novas imagens de referência nesta etapa.

Uma novela já iniciada não pode mudar do fluxo ilustrado para o animado. O padrão salvo é imutável. Referências e vozes exibidas depois da confirmação correspondem aos hashes fixados, mesmo quando outra imagem foi cadastrada antes da escolha final. Um cadastro parcial bloqueia o início acidental do capítulo ilustrado. O esboço SVG é identificado como esboço ilustrado e não é apresentado como referência animada aprovada.

## Arquivos e execução

- Rotas autenticadas e com origem exata. O workspace vem da sessão, nunca do navegador. Leituras de mídia são verificadas por associação ao workspace e SHA-256, sem URLs assinadas no cliente.
- PNG/JPEG/WebP de até 12 MiB; assinatura binária e decodificação reais, limite de 16 milhões de pixels, uma página, largura mínima de 480 e lados de até 4.096 pixels. Apenas retrato. Normalização aplica orientação EXIF, retira metadados, achata transparência em branco e escreve PNG sem redimensionar, recortar ou ampliar. Não recupera detalhes ausentes.
- Reserva de bytes antes do upload, caminho privado derivado no servidor e conteúdo imutável. Um upload com resposta incerta é conferido pelo hash e não sobrescrito. Arquivo idêntico por personagem reutiliza a reserva. As reservas pendentes permanecem contabilizadas; não se presume que o objeto deixou de existir.
- Limites deste cadastro: 64 MiB por workspace, 128 MiB globais e oito novos uploads de referência em 24 horas por workspace. São limites adicionais deste recurso, não prova de espaço livre no plano Supabase nem garantia da franquia total. Limpeza de referências antigas ainda exige procedimento operacional; nenhum arquivo de produção é apagado automaticamente.
- `story-profile-voices.yml` roda apenas com variável Actions `CONTENT_AI_PROFILE_VOICES_ENABLED=true`, gate SQL `story_production.profile_voices_enabled=true`, secrets Supabase e acesso de despacho configurados. Usa CPU, Edge TTS 7.2.8, velocidade zero e FFmpeg para PCM mono 16 kHz/16 bits; nunca recebe credenciais Modal. Amostras até 12 segundos/512 KiB. O serviço Edge TTS pode ficar indisponível; não há fallback de voz silencioso.
- Lease exclusiva, três despachos no máximo e intervalo de 12 minutos. Amostras completas são reutilizadas, uma resposta antiga não conclui uma lease nova, e o painel permite recuperar uma execução que não iniciou após o intervalo. A geração de diálogo e a de vídeo continuam com gates independentes.
- A continuação usa a ordem de locks workspace → série, igual a arquivamento/retry. Finalização do perfil e início do primeiro capítulo serializam na linha da série. A correção de ordem está em migration separada, preservando a migration já aplicada.

## Implantação e validação

Aplicadas no Supabase Cloud as seis migrations anteriores de animação e as duas novas de cadastro/ordem de locks. Implantadas `studio-story`, `studio-video-worker`, `orchestrator`, `generate-script`, `generate-assets` e `trigger-render`. Conferência remota: funções ACTIVE, zero carteiras habilitadas, zero jobs de vídeo e gates SQL de preparo/vozes fechados. Não houve build/deploy do runtime Modal, inferência, criação de vídeo ou consumo de créditos de GPU.

O painel/workflows foram publicados no GitHub, e as variáveis de ativação só podem ser configuradas após confirmar franquias e permissões. A implantação do painel no Render depende da CI. A credencial GitHub em `.env.cloud` permite acesso ao repositório, mas a consulta de Actions Variables retornou HTTP 403, “Resource not accessible by personal access token”. A autenticação já instalada no GitHub CLI permite administrar variáveis e publicar workflows; foi utilizada para resolver essa etapa, sem pedir outra chave. O token configurado no Edge foi conferido por digest e passou no teste de despacho (204), com o workflow desativado e execução skipped. Segunda fonte de animação continua ausente.

Validação local: build Next, 13 testes do painel, seis testes de navegador de acesso/origem, 87 testes Deno, typecheck de todas as funções, migrations em PostgreSQL limpo, sete suítes SQL de produção de novelas e regressões de revisão/Studio. Teste concorrente real de iniciar/arquivar sem deadlock. Fixture visual do componente em desktop/celular verificou upload, amostras, confirmação, bloqueio do cadastro incompleto e ausência de overflow, com respostas simuladas e sem provedores externos. O teste técnico não certifica qualidade artística ou sincronização labial de um novo vídeo.

A primeira CI Linux detectou dois problemas de infraestrutura de teste: `LD_LIBRARY_PATH` herdado bloqueava subprocessos com a permissão Deno restrita; fixtures de vídeo eram criadas antes da verificação global de consumo diário. A CI agora remove essa variável para os testes Deno, como os runners de produção já fazem, e verifica o limite diário antes de criar as fixtures de vídeo. Não foram ampliadas as permissões Deno nem enfraquecidas as verificações de concorrência.

Fontes de franquia verificadas em 09/10: [Actions em repositórios públicos com runners padrão](https://docs.github.com/en/billing/concepts/product-billing/github-actions); [cota e medição de Storage Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size). Repositório público confirmado pela API. A observação SQL do projeto mostrou 194.283.492 bytes armazenados, sem tamanhos desconhecidos; isso não substitui uma consulta de faturamento acumulado ou a conferência dos demais projetos da organização.
