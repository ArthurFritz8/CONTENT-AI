# ADR-029 — Painel operacional no repositório principal

Status: aceito; substitui a arquitetura de hospedagem do ADR-028.

## Problema

O painel separado no Sites tinha autenticação dependente do ChatGPT e poucos controles operacionais. O usuário quer administrar produtos, pautas, gerações e configurações no próprio projeto, com hospedagem gratuita.

## Decisão

Next.js em `apps/web-panel`, servidor Node no Render Free, dados e autenticação no Supabase existente. GitHub Actions valida o código e solicita deploy do commit aprovado pelo CI. Actions continua executando a renderização de vídeos; não é um servidor HTTP permanente. Não criar banco efêmero no Render nem guardar vídeos no disco local.

O painel tem acesso administrativo restrito a UUIDs de usuários Supabase explicitamente configurados no servidor. A chave de serviço nunca vai para o navegador. Mutações exigem sessão verificada, mesma origem, validação, idempotência e auditoria no banco. Edição de pautas e configurações usa controle de concorrência. Os contadores vêm do banco completo, inclusive publicações privadas.

## Escopo operacional

Visão geral, fila editável, produtos/links vinculados às pautas, busca e filtro de gerações, detalhe com vídeos horizontal/vertical, roteiro, fontes, mídia licenciada, histórico e publicações. Configuração de ativação/pausa, teto diário e foco editorial. Aprovação continua no fluxo existente do Telegram; TikTok continua manual até integração autorizada e implementada. Não simular integrações, métricas, vídeos ou sucesso de publicação.

Render Free pode suspender o servidor sem tráfego. O scheduler e os vídeos continuam fora dele. Custos externos seguem limites já existentes; ativação da geração exige ação explícita do operador. Não contratar plano pago nem criar tráfego para contornar suspensão.

## Entrega e limites

Blueprint gratuito, instruções de provisionamento e CI ficam versionados. Credenciais, usuário autorizado, migração e criação do serviço são etapas de implantação verificadas separadamente. A existência do código não significa que o serviço foi implantado. Manter o site anterior até verificar o novo endereço.
