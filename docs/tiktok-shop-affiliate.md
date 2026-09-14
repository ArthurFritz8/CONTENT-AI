# TikTok Shop Affiliate API

O conector do projeto já implementa assinatura HMAC-SHA256, busca de produtos em colaboração aberta e geração de link geral. Ele permanece desativado até a aprovação da aplicação no Partner Center; ausência de credenciais retorna `TIKTOK_SHOP_NOT_CONFIGURED` e não usa um link público como substituto silencioso.

## Preparação da conta

1. No [TikTok Shop Partner Center](https://partner.tiktokshop.com/docv2/page/affiliate-integration), registre-se como parceiro de serviço/ISV.
2. Crie um aplicativo Affiliate (public/custom conforme o fluxo de teste) e um Connector custom para os recursos necessários.
3. Solicite a ativação da Affiliate API. A documentação informa que ela é inativa por padrão e depende da aprovação do Account Manager ou Partner Manager.
4. Configure a autorização da conta de criador e solicite os escopos de leitura de colaborações e compartilhamento de links. O token de criador é diferente de um token de vendedor.
5. Guarde somente no ambiente seguro da Supabase:

```text
TIKTOK_SHOP_APP_KEY
TIKTOK_SHOP_APP_SECRET
TIKTOK_SHOP_CREATOR_ACCESS_TOKEN
```

Não coloque esses valores no Telegram, no Gemini, no navegador, em screenshots ou no GitHub Actions. O `app_secret` assina as requisições; o token de criador vai somente no header `x-tts-access-token`.

## Primeiro smoke test

O primeiro teste deve buscar no máximo 20 produtos por palavra-chave, sem criar colaboração, publicar conteúdo ou alterar a vitrine. Depois de validar a resposta, o fluxo poderá persistir um snapshot com `product_id`, loja, preço, comissão, moeda, imagem, elegibilidade, `captured_at` e `request_id`. O link promocional só deve ser gerado para o produto que passar pelos filtros editoriais e de disponibilidade.

O resultado ainda exige revisão humana: comissão, preço, estoque, elegibilidade regional e termos da colaboração podem mudar. Se a API não estiver aprovada, a linha manual `Afiliado: URL` continua funcionando.

## Endpoint preparado no projeto

Depois que a aprovação e os três secrets estiverem ativos, o worker autenticado
`POST /functions/v1/affiliate-catalog` expõe duas operações:

```json
{"action":"search","keywords":["organizador de cabos"],"page_size":20,"sort_field":"commission_rate","sort_order":"DESC"}
```

Ele busca produtos de colaboração aberta, normaliza os campos essenciais e grava
um snapshot em `affiliate_products`. Para gerar o link, o mesmo endpoint aceita
`{"action":"generate_link","material":{...}}`; o payload `material` deve seguir
o schema vigente do Partner Center. Nenhuma dessas operações é chamada pelo
orquestrador enquanto o catálogo não estiver aprovado e configurado.
