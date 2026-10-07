"""Bounded new-story identity and credit policy; no cloud, credentials or file writes."""
from decimal import Decimal

REFERENCE_HASHES = {
    "malu-entryway-v1.png": "d7ef0d3da2a31bd93f35988cab8b6d3fecf746cdf579277aea1e92b1e049776c",
    "laranjito-entryway-v1.png": "dc449ba584ca9dc252d4753e1eab76062c1055ebf6d5372ff4ebd546a832c32f",
}
IMAGE_HASHES = {
    **REFERENCE_HASHES,
    "entryway-wide-v1.png": "ceb316b79b6dd66d721bcc7a1211b4331b6f9f253599aebc2f99755005836370",
    "suitcase-detail-v1.png": "735502fd2f36f18d5e2c0ad28b555a90c88904519e7d27009d9c40f291646d01",
    "tickets-detail-v1.png": "a64da1a1ad7194b088afb60c08561c95cbf21abfd6e7295e25bd2e8fd471394f",
}
RATE = Decimal("0.00145548")
TIMEOUT, FRAMES = 1800, 64
OVERHEAD, KEEP_CREDIT = Decimal("1"), Decimal("1.50")
PREFIX = (
    "Cinematic realistic stylized 3D dialogue of the exact adult fruit person in the reference. "
    "Articulate the actual provided Portuguese audio with natural synchronized lips and jaw. "
    "Preserve facial identity, textured fruit skin, human eyes, hairstyle, detailed clothes and "
    "the warm realistic Brazilian apartment entryway. One speaker, stable camera and framing. "
    "Hands stay outside the frame. No walking, hand gestures, objects handled, cuts or scenery changes. "
)
PROMPTS = {
    "02": PREFIX + "The apple woman looks right at the man off camera. She has discovered a packed suitcase "
        "and asks if he was leaving without telling her. Play worried hurt disbelief with an eyebrow lift, "
        "slight shoulder withdrawal and a tiny head tilt, settling naturally after the question. "
        "Preserve chestnut wavy hair, gold earrings and cream red-floral wrap dress.",
    "05": PREFIX + "The orange man looks left at the woman off camera and explains that the trip was a surprise "
        "for both of them. Begin gently concerned, release his shoulders and soften his eyebrows as he speaks. "
        "A small affectionate smile appears at the end of 'pra nos dois', without laughter or abrupt motion. "
        "Preserve dark short hair, moustache and cream linen shirt. No biscuit or new props.",
}


def reserve(count: int) -> Decimal:
    if type(count) is not int or not 1 <= count <= 2:
        raise ValueError("Only one or two bounded takes")
    return RATE * TIMEOUT * count + OVERHEAD


def affordable_takes(credit: Decimal | None) -> int:
    if credit is None or not credit.is_finite() or not 0 <= credit <= 30:
        raise ValueError("Current remaining free credit from dashboard or documented conservative billing calculation is required")
    for count in (2, 1):
        if credit >= reserve(count) + KEEP_CREDIT:
            return count
    return 0
