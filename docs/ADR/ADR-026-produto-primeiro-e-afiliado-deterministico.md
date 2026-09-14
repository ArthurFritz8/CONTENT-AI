# ADR-026 — Conteúdo produto-primeiro e afiliado determinístico

## Objetivo

Alinhar o pipeline à finalidade original: recomendar produtos úteis e converter compras por links de afiliado, começando com uso pessoal supervisionado.

## Contexto

O banco já registrava `product_url`/`affiliate_link`, mas esse link ficava separado do roteiro e o modelo poderia esquecer de colocá-lo nas descrições. O canal precisa demonstrar o problema, explicar o uso, apresentar limitações e só então convidar a pessoa a conferir o produto. Uma imagem stock não prova que o produto possui determinada função. TikTok Shop também exige associação manual do produto enquanto a publicação automática estiver fora do escopo elegível.

## Solução

- O briefing continua entrando pela fila curada do Telegram; uma pauta comercial é identificada pela linha `Afiliado: https://...`.
- O sistema acrescenta o link HTTPS exato e um disclosure comercial nas descrições YouTube e TikTok depois da resposta do modelo, com operação idempotente. O modelo não controla nem altera a URL.
- Se o modelo omitir o disclosure, o sistema fornece o texto padrão; a fala do CTA ainda precisa conter o disclosure e passa pelo QA editorial.
- O prompt exige produto/problema, demonstração, compatibilidade/limitação e público adequado. São proibidos preço, desconto, estoque, entrega, garantia ou resultado inventados.
- A ficha Telegram mostra o link registrado para conferência. O operador continua responsável por abrir o link, confirmar produto/campanha e anexar o produto no TikTok Shop manualmente.

## Impacto e limites

O script aprovado muda quando é gerado com afiliação: o link e o disclosure entram no hash antes da aprovação. Episódios anteriores permanecem intactos. A URL é reproduzida nas descrições, mas não é encurtada nem redirecionada. TikTok Shop, comissões, preço e disponibilidade continuam dependentes da conta, região e regras vigentes da plataforma. O pipeline não promete aprovação automática da API do TikTok.

## Prevenção e rollback

URLs inseguras (HTTP, credenciais ou formato inválido) falham fechado. Testes cobrem inclusão idempotente, conteúdo não comercial e rejeição de URL insegura. Reverter este commit remove a inclusão automática; pautas anteriores já aprovadas continuam com seus hashes e decisões.
