# ADR-076 — Avaliação explícita de fala nativa Auray

Data: 2026-10-14. Status: implementado como experimento; continuidade e produção pendentes.

O usuário autorizou gerar uma cena com fala para analisar a nova fonte. O primeiro clipe Auray contém áudio, mas o contrato recebe somente prompt e referências visuais, sem nosso WAV nem um campo de voz. Portanto, esse teste pode investigar fala nativa pelo prompt; não pode alegar continuidade das vozes aprovadas.

Adicionar `native_dialogue_probe` ao esquema de avaliação, com metadados obrigatórios de personagem, idioma pt-BR, texto curto e direção vocal. Somente esse tipo aceita tais metadados; WAV continua recusado. O CLI e o SDK exigem opt-in explícito para uma submissão nova. O prompt enviado incorpora a frase exata e instrui uma única personagem em cena a dizê-la. O hash da solicitação inclui os metadados; os hashes/retomadas das avaliações antigas permanecem estáveis.

Manter duração de cinco segundos, preço máximo de cinco créditos gratuitos, inspeção financeira imediatamente antes do POST, teto remoto limitado à franquia gratuita, lock, checkpoint e idempotência. Nenhuma alteração de modelo, carteira de produção, roteador, perfil de voz ou publicação. Retomada nunca reenvia a geração.

O QA exige áudio no arquivo desse experimento e registra fala pedida, voz gerada pelo serviço e revisão pendente. Áudio presente ou transcrição aproximada não aprova sincronismo nem identidade vocal. A aprovação de diálogo e de produção permanece falsa. Não remover o áudio para entregar este teste, substituir fala errada por WAV descolado da boca, nem promover a fonte por mera aceitação da API.

Testes: recusa metadados ausentes/deslocados e áudio externo; nenhuma chamada sem opt-in; uma chamada no modelo/preço existentes com prompt completo; fonte permanece sem aprovação de diálogo/produção. Operação em [auray-operator.md](../auray-operator.md).
