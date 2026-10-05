# ADR-047 — Produção na nuvem e computador opcional

Data: 2026-10-05. Status: direção arquitetural definida; implementação e validação remota pendentes.

## O — Objetivo

Permitir criar e revisar vídeos pelo celular ou navegador sem exigir GPU do cliente. Preservar qualidade por estilo, histórias opcionais, orçamento gratuito e aprovação humana.

## C — Contexto

O protótipo local do ADR-046 não representa infraestrutura universal. WebGPU e detecção de dispositivo não garantem execução do Blender nem continuidade com a aba fechada. O código atual já dispara render em GitHub Actions; o lease de dispatch não é um mecanismo durável de execução longa entre provedores.

A pesquisa identificou Modal Functions como primeiro candidato remoto: há exemplo oficial de Blender e franquia Starter de US$ 30/mês de compute, com excedentes cobrados e controle de desembolso separado. Não foi verificada conta, saldo, bloqueio de cobrança ou render remoto deste projeto. ZeroGPU é complementar e não oferece um host Blender genérico comprovado. Fontes e limites estão no [estudo de produção multidispositivo](../research/producao-multidispositivo-2026-10-05.md).

Os termos atuais de Actions restringem uso como infraestrutura de aplicações. A avaliação deste ADR é migrar jobs de produção para executor apropriado, em vez de ampliar o ADR-004 para render de clientes. Esta decisão de direção não altera o workflow em execução.

## S — Solução

- Nuvem como rota padrão; navegador como painel e prévia. Computador conectado será uma capacidade opcional, com adesão explícita, pareamento e teste representativo, em fase posterior.
- Selecionar execução por contrato visual, capacidades, disponibilidade e saldo reservado. Não escolher qualidade com base em “PC ou celular”. APIs generativas são técnicas distintas de render 3D e não fallbacks equivalentes sem validação.
- Validar primeiro um executor próprio CPU/GPU no Modal, condicionado a crédito elegível e bloqueio verificado de desembolso. Não usar Shared Endpoints pagos dentro de uma suposta franquia gratuita.
- Reutilizar engine, estados editoriais, revisão e publicação existentes; introduzir jobs duráveis, lease renovável, checkpoints e reserva atômica em implementação posterior. Fechar o navegador não interromperá um job remoto aceito.
- Preservar identidade e versões entre executores; falha ou falta de cota gera espera informada. Nenhuma cobrança ou redução silenciosa de qualidade.
- A capacidade exibida considera a cadeia completa, o orçamento global e o limite por workspace. Recursos locais autorizados são adicionais; o produto não depende da máquina do operador como único executor.

## P — Prevenção, validação e dependências

- Tratar quotas publicadas como condições a verificar na conta, não saldo disponível. Meta de desembolso zero exige controles do provedor e reservas internas, incluindo tentativas, CPU, GPU, memória e custos acessórios.
- Não fornecer credenciais administrativas do banco aos dispositivos; jobs usam acesso restrito e o servidor controla estados. Não enviar trabalhos de um cliente ao PC de outro.
- Testar desligamento da máquina, fechamento da aba, falta de saldo, timeout, callback duplicado, tentativa antiga, retomada de simulação e segregação de workspace.
- Validar cena real e comparação visual antes de migrar ou habilitar animação. Não converter a velocidade do cubo ou da amostra anterior em capacidade comercial.
- Não contratar serviço, aceitar cobrança ou provisionar hardware pago em nome desta pesquisa.
- Gadgets e vídeos ilustrados mantêm seus contratos. CI continua separado dos jobs de clientes.

Não há implantação neste ADR. Próxima prova: uma cena e uma montagem executadas remotamente sob controle de custo confirmado, acessíveis para revisão pelo celular.
