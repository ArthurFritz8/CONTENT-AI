# Universal Studio — execução

Escopo autorizado em 2026-09-29: revisão web, pautas por tema, espaços isolados, Buffer OAuth, Telegram opcional e Fia.

## Entregas e verificação

- [x] Base de espaços de trabalho e autorização em consultas/comandos/background.
- [x] Revisão independente de Telegram e decisões vinculadas à versão/canal.
- [x] Descoberta por perfil editorial e geração explicitamente solicitada.
- [x] Onboarding, canais Buffer OAuth e agenda implementados; uso por clientes aguarda o cadastro administrativo do App Client no Buffer.
- [x] Telegram compartilhado e assistente para bot próprio.
- [x] Fia contextual com ajuda disponível mesmo sem IA.
- [x] Testes de isolamento de duas contas, revisão obsoleta/duplicada, quotas e falhas externas.
- [ ] CI, migrações, deploy e smoke em produção: CI, banco e Edge Functions concluídos; deploy web ainda em andamento.

As credenciais de aplicativo OAuth são dependência externa se ainda não cadastradas. Cadastro público só será habilitado depois dos testes de isolamento; indisponibilidade de integração deve aparecer na interface sem sucesso fictício.

Smoke remoto em 2026-09-30: duas contas temporárias receberam workspaces distintos; ambas leram apenas o próprio espaço, não viram ideias legadas e tiveram chamadas cruzadas para descoberta e Fia rejeitadas. As contas e workspaces temporários foram removidos ao fim. A flag de cadastro público continuou desativada. Não foi feita aprovação nem publicação de episódio nesse teste.
