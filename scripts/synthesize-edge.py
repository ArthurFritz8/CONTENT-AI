"""Small adapter for the existing edge-tts dependency; no server or credentials."""
import asyncio
import json
import sys
from pathlib import Path
import edge_tts


async def main() -> None:
    payload = json.loads(sys.stdin.read())
    boundaries = []
    communicate = edge_tts.Communicate(payload['text'], payload['voice'], boundary='WordBoundary', receive_timeout=30)
    with Path(payload['audio']).open('wb') as audio:
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                audio.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                boundaries.append({'word': chunk['text'], 'offset_seconds': chunk['offset'] / 10_000_000,
                                   'duration_seconds': chunk['duration'] / 10_000_000})
    Path(payload['boundaries']).write_text(json.dumps(boundaries), encoding='utf8')


if __name__ == '__main__':
    asyncio.run(main())
