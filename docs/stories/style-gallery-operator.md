# Galeria de estilos do Studio

Galeria e escolhas implementadas no [ADR-078](../ADR/ADR-078-galeria-e-estilos-por-capitulo.md). Este procedimento importa vídeos existentes; não gera imagens, fala ou vídeo e não ativa carteiras.

O [ADR-079](../ADR/ADR-079-padroes-visuais-e-execucao-por-capitulo.md) liga imagens e vozes à versão/estilo e congela o perfil no capítulo. O painel oferece essa preparação para automática/Modal; salvar o padrão não habilita a fonte, certifica uma amostra ou autoriza dinheiro. Auray e HQ continuam aguardando seus adaptadores próprios.

## Importar exemplos privados

O operador precisa de Node 22+, FFmpeg/FFprobe no PATH e configuração Supabase de serviço na `.env.cloud`, ignorada pelo Git. Não passar chaves como argumentos. O workspace deve existir. Mídias do manifesto precisam estar em `output/`; não vêm em um clone limpo.

```powershell
node --experimental-strip-types scripts/import-story-style-samples.mts UUID_DO_WORKSPACE docs/stories/style-gallery-samples.json
```

O manifesto referencia os dois arquivos locais aprovados, seus hashes e limitações. Antes de qualquer escrita remota, o importador verifica todos os arquivos, metadados e decodificação. Não corrige FPS, imagem ou áudio. Registros parciais ficam ocultos; executar o mesmo comando reconcilia o mesmo upload sem sobrescrevê-lo. Não editar amostra pronta: uma nova versão exige outro identificador e arquivo verificado.

A galeria é privada por workspace, sem catálogo público compartilhado. O RPC de registro e o de prontidão são exclusivos do serviço; não expor esses poderes em formulários do usuário. Um exemplo precisa identificar sua origem e limitações, inclusive quadros interpolados. Não declarar certificação de um capítulo inteiro a partir de uma amostra curta.

## Implantação inicial de 14/10/2026

Migração `20261014020000` aplicada e `studio-story` implantada para conservar as preferências na proposta. Dois exemplos importados, depois relidos do storage com tamanho e SHA-256 verificados. Importação repetida reaproveitou os mesmos registros. Nenhuma nova geração. Carteiras habilitadas e jobs de produção continuaram em zero; preparo animado continua desativado.

Recibos privados em `.audit-tmp/story-styles-schema-deployment.json` e `.audit-tmp/story-style-live-verification.json`. A versão pública do painel deve ser conferida pelo `/api/health` e pela CI; atualização do banco não implica que o Render já publicou a interface.
