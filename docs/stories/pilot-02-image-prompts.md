# A mala na porta — imagens próprias

Método: imagegen integrado, referências locais inspecionadas e resultado copiado para `output/suitcase-story-preview/references/`. Não usa chave de API nova ou Modal. Cinco imagens selecionadas; uma tentativa de close foi rejeitada pelo filtro de saída do provedor, sem arquivo usado. O close selecionado empregou descrição neutra da mesma personagem/cena. Nenhuma imagem anterior foi substituída.

## Ambiente — entryway-wide-v1.png

Referências: `output/humanized-story-pilot/references/malu-close-v1.png` e `laranjito-close-v1.png`, identidade/figurino apenas.

> Create ONE portrait 9:16 cinematic establishing still for the original Brazilian fruit-person soap opera 'A mala na porta'. The two input images are identity references only: preserve the exact adult red-apple woman Malu with wavy chestnut hair, gold hoop earrings and cream/red floral wrap dress, and exact orange man Laranjito with textured orange skin, short dark hair, moustache, cream linen shirt, blue jeans. New setting: realistic modest elegant Brazilian apartment entryway, warm cream stucco walls, navy-blue front door on right, honey wood console table beside it, warm late-afternoon window light from left, hanging plant in rear, realistic fabrics and surfaces; same sophisticated stylized cinematic 3D character quality as references. Medium-wide shot, Malu on left has just stopped walking into the room, looking suspiciously toward Laranjito on right near the console. A closed small NAVY BLUE ribbed rolling suitcase with handle RETRACTED rests on floor beside the navy door. On console lie two small ivory travel-document envelopes SIDE BY SIDE with no legible personal data, text or logos. Both mouths CLOSED, subtle tension and believable adult human body proportions, grounded feet. Natural hands resting by sides; no biscuit, no food, no fruit toy limbs, no theatrical gestures. Maintain left-to-right dialogue axis, Malu facing right and Laranjito facing left. Composition suitable for vertical cinema with some lower margin for subtitles; beautifully detailed hair, linen weave, realistic room, coherent anatomy. Single full image, no panels, no captions, no watermark. Save the resulting image file and provide its local path.

## Malu — malu-entryway-v1.png

Referência: ambiente selecionado acima.

> Create a single portrait 9:16 cinematic 3D close-up of the adult apple woman on the LEFT in this fictional animated film reference. Preserve her face, curly brown hair, gold earrings and floral dress, and preserve the apartment and warm light. Camera frames her head and shoulders. She looks toward the man off-camera on the right with a worried questioning expression, her mouth closed at the starting frame. Hands outside the frame. Cream wall and hanging plant softly blurred behind her. A beautifully detailed, tasteful family-friendly animated drama film still, realistic hair and fabrics, same character identity as the reference. Only the woman visible. No captions or text.

## Laranjito — laranjito-entryway-v1.png

Referência: ambiente selecionado.

> Create a single vertical 9:16 cinematic 3D medium close-up of the adult orange man on the RIGHT in this original fictional animated film reference. Preserve his exact orange-textured face, short dark brown hair, dark moustache, cream linen shirt and identity; no biscuit. New camera angle from the same apartment, eye level, framing his head and upper torso to lower chest. He looks LEFT toward the apple woman off-camera, same left-to-right dialogue axis. Navy-blue apartment door softly blurred behind him on right, warm cream wall on left, same late-afternoon warm light entering from left as source image. Starting expression: gentle concern, sympathetic eyes, slight warm hopeful expression as he prepares to explain a surprise, lips CLOSED at starting frame. Natural head upright, shoulders relaxed, arms resting below frame, hands not visible. Detailed linen weave and hair, sophisticated realistic stylized 3D film quality. Only the orange man visible, no extra face, no toy-like round body, no props held. Single full image, no captions, no text, no collage, no watermark. This is the dialogue reference for a tender reveal in a family-friendly fictional soap opera.

## Mala — suitcase-detail-v1.png

Referência: ambiente selecionado.

> One portrait 9:16 cinematic prop-detail film still from this exact fictional apartment scene. Camera low near the floor, close view of the SAME small navy blue ribbed hard-shell rolling suitcase, CLOSED, handle RETRACTED, zipped and standing upright beside the SAME dark navy-blue door. Same honey-brown wood floor, warm window light from LEFT, textured rug at left, edge of honey wood console in softly blurred background. Suitcase is the visual clue that someone is leaving. Preserve exact shape, size, grooves, wheels and room continuity with reference image. No characters, no hands, no faces, no feet in frame. Sophisticated realistic cinematic 3D rendering, sharp suitcase materials and believable natural depth, warm dramatic light with soft shadows. Lower image margin for subtitles. No writing, no logos, no captions, no collage, single image.

## Passagens — tickets-detail-v1.png

Referência: ambiente selecionado.

> Single portrait 9:16 cinematic detail still for this exact fictional 3D apartment scene. Close overhead-oblique shot of the SAME honey-brown wood console tabletop beside the navy-blue door. The TWO small IVORY travel envelopes already visible on the console in the reference remain SIDE BY SIDE on the table, left and right, slightly open; one simple fictional travel paper slips partway out of EACH envelope. Each paper has only a tiny simple generic airplane pictogram, with NO readable text, NO real airline branding, NO personal information, NO barcodes. Clearly TWO matching travel envelopes, a romantic surprise for two people. Same potted plant and wooden bowl at back of console, warm left window light, slight edge of navy door on right out of focus. No characters, no faces, no hands, no new furniture or location. High-quality cinematic stylized realistic 3D, detailed natural paper fibers and wood, coherent apartment continuity, shallow depth of field. No captions, no collage, no watermark, one image. These are obviously fictional film props, not documents for actual travel.

Hashes exatos das cinco imagens: `scripts/suitcase_story_contract.py`. A inspeção de referências não é certificação de identidade/anatomia em cada quadro de animação futura. As falas novas estão em `pilot-02-suitcase.json`, com durações medidas no plano de saída.
