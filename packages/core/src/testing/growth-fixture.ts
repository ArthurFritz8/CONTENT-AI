// Test fixture mirrors the versioned policy; production always reads system_config.
export const growthFixture = {
  "enabled": true,
  "engagement_ctas": [
    "Você usaria esse gadget? Conte nos comentários.",
    "Salve esta ideia e conte como você usaria esse gadget."
  ],
  "youtube_conversion_ctas": [
    "Confira o produto pelo link no perfil do canal."
  ],
  "disclosure": "Este vídeo contém link de afiliado. Se você comprar pelo link, podemos receber uma comissão.",
  "organic_blocked_phrases": [
    "link no perfil",
    "link na bio",
    "link do produto",
    "compre",
    "comprar",
    "cupom",
    "afiliado",
    "comissão",
    "aproveite a oferta"
  ],
  "briefings": {
    "tiktok": "Hook visual e verbal honesto nos primeiros 2 segundos; curiosidade e demonstração com material autorizado. Liste 3 gadgets somente se houver 3 produtos pesquisados; senão, mostre 3 usos comprovados de um. Encerre com comentário ou salvar, SEM venda e sem link.",
    "youtube": "YouTube Short vertical: problema, demonstração, benefício verificável e limitação. Comparação ou review vale a pena, sem fingir experiência. CTA link no perfil e disclosure só após link afiliado validado; sem link, usar engajamento."
  },
  "calendar": {
    "timezone": "America/Sao_Paulo",
    "posts_per_week": 5,
    "days": [
      "mon",
      "tue",
      "wed",
      "thu",
      "fri"
    ],
    "manual_scheduling": true,
    "hypothesis_only": true,
    "youtube": [
      "12:30",
      "18:30"
    ],
    "tiktok": [
      "19:30",
      "21:00"
    ]
  },
  "measurement": {
    "cadence_days": 7,
    "checkpoints_days": [
      30,
      60,
      90
    ],
    "tiktok_followers_goal": 1000,
    "automated": false
  }
};
