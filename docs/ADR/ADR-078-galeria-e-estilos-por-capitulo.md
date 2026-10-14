# ADR-078 — Galeria privada e escolhas visuais por capítulo

Data: 14/10/2026. Status: implementadas as etapas de galeria e preferências do plano aprovado. Adaptadores de produção e fontes adicionais continuam pendentes.

## Decisão

Separar estilo, fonte, modelo e carteira. Uma novela pode preservar um estilo ou permitir uma lista de estilos para capítulos futuros. A história e seus resumos aprovados permanecem na mesma bíblia. Preferências visuais são versões imutáveis, com capítulo inicial de vigência; o capítulo congela a versão e o estilo escolhidos ao entrar na fila. Uma edição exige confirmação, versão atual e aprovação verificável do capítulo anterior. A confirmação das preferências não aprova um motor nem uma voz nova.

O catálogo apresenta ilustrado clássico, 3D, desenho 2D, anime, realista e HQ com voz. Apenas o ilustrado clássico já possui execução neste fluxo. Os demais podem orientar a proposta de texto e ficam identificados como em preparação. O servidor impede a criação de um capítulo que não tenha adaptador, mesmo que o navegador solicite diretamente. Não transforma uma preferência de anime, por exemplo, em um vídeo ilustrado clássico. A política de preservar vozes é o padrão; permitir variantes ainda exige ouvir e aprovar uma versão posteriormente.

O contrato anterior de produção animada permanece para novelas sem preferências novas. Migrar uma novela para as novas preferências não converte seu perfil técnico nem libera outra fonte. Retomar uma geração existente mantém seus dados. Novos pedidos antigos, sem o campo opcional, preservam a forma anterior para não quebrar idempotência. A seleção visual entra como dado no planejamento de texto, separada de instruções de sistema e da certificação técnica.

## Exemplos

Dois arquivos existentes compõem a galeria inicial: a mini-história Modal e o diálogo Auray aprovado pelo usuário. Os exemplos indicam modelo, resolução, duração, quadros nativos quando medidos, quadros de entrega, interpolação ou montagem e limitações observadas. A amostra Modal inclui planos ilustrados; a Auray apresenta variação de aparência/roupa e não certifica identidade vocal entre capítulos. Nenhuma delas é garantia de que uma nova novela inteira sairá igual.

`scripts/import-story-style-samples.mts` valida previamente todo o manifesto: schema, confinamento em `output`, tamanho, SHA-256, metadados FFprobe e decodificação integral FFmpeg. Importa bytes existentes para o bucket privado, sem API de geração. Registro parcial não aparece na galeria; upload incerto é reconciliado pelos mesmos bytes. Metadados e mídias prontos não podem ser substituídos. Uma chamada repetida reutiliza a mesma amostra.

A galeria pertence ao workspace. O navegador não recebe caminhos internos, hashes, chave de serviço ou URLs assinadas. A rota de vídeo exige sessão e membro, consulta a amostra autorizada e verifica caminho, tamanho e hash completos antes de entregar bytes, sem cache compartilhado ou redirecionamento. Assistir não usa créditos de geração; armazenamento e tráfego seguem os limites do serviço.

## Capacidade e sequência restante

Esta entrega não altera saldos, reservas ou a compatibilidade financeira. Carteiras Modal e Auray continuam separadas, sem somar créditos com dólares ou prometer capítulos liberados. Não cria novos vídeos, não ativa carteiras e não publica conteúdo.

Próximas etapas do plano: implementar adaptadores de capítulos vinculados às novas versões; validar continuidade visual/vocal e retomada por cena; implementar execução própria de 2D/HQ; integrar e medir fontes de imagens gratuitas recorrentes. Cloudflare e AI Horde são candidatas de imagens, não substitutas já operacionais de vídeo falado. Não há amostras fabricadas para estilos ainda não testados.

## Validação

Banco novo com todas as migrações, verificações e suítes SQL, incluindo isolamento entre workspaces, histórico imutável, CAS/idempotência, bloqueio durante capítulo ativo e impossibilidade de fallback implícito. Testes de proposta verificam que as preferências chegam ao registro durável sem gerar assets. Testes de mídia verificam namespaces, hash, tamanho e respostas truncadas. Teste de navegador autenticado usa backend isolado sem saída para serviços externos e percorre galeria, preferências, confirmação, histórico e bloqueio de produção ainda indisponível. Build e typecheck completos.
