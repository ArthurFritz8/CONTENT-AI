"""One authorized free-pool audition, outside Studio. Never retries a generation."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'togetherai:wan-ai/wan2.7-i2v'
PROVIDER = 'together-video-generation'
REFERENCE = 'output/suitcase-story-preview/references/malu-entryway-v1.png'
REFERENCE_SHA = 'd7ef0d3da2a31bd93f35988cab8b6d3fecf746cdf579277aea1e92b1e049776c'
PLAN = {
    'version': 1, 'model': MODEL, 'provider': PROVIDER, 'seconds': 5,
    'size': '720P', 'width': 720, 'height': 1280, 'fps': 30,
    'generate_audio': True, 'seed': 42016,
    'prompt': (
        'A single continuous five-second cinematic 3D animated Brazilian soap-opera shot. '
        'Animate the exact adult apple woman in the supplied first frame. Preserve her apple-shaped '
        'red textured face, sharp brown eyes, voluminous brown curly hair, gold hoop earrings and '
        'cream floral dress, the same proportions and warm golden entryway lighting. '
        'She looks toward her partner just off camera on her right. She takes a short breath, '
        'shifts her shoulders and weight slightly forward, raises her right hand naturally to her '
        'chest for one restrained questioning gesture, then lowers it. Her hand has five stable '
        'fingers. Her eyebrows and eyes convey hurt and disbelief. Keep the camera steady, '
        'waist-up framing and continuous natural body movement. '
        'She speaks on screen in Brazilian Portuguese, with an expressive adult female voice '
        'and synchronized visible mouth movement, saying exactly: "Você ia embora sem me contar?" '
        'One speaker, one short sentence. No voice-over, no additional speech, no music, '
        'no subtitles, no text, no cuts. End with a brief silent emotional reaction.'
    ),
    'negative_prompt': 'blurry eyes, smeared pupils, deformed hands, extra fingers, missing fingers, '
        'identity change, morphing face, duplicate limbs, frozen body, camera shake, text, subtitles',
}


class Blocked(Exception):
    pass


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.writing')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf8')
    os.replace(temporary, path)


def token():
    value = os.environ.get('PUTER_AUTH_TOKEN')
    if value is None:
        path = ROOT / '.env.cloud'
        for line in path.read_text('utf8').splitlines() if path.exists() else []:
            match = re.match(r'^\s*(?:export\s+)?PUTER_AUTH_TOKEN\s*=\s*(.*?)\s*$', line)
            if match:
                value = match[1].strip('"\'')
    if not value or not 16 <= len(value) <= 8192 or re.search(r'\s', value):
        raise Blocked('missing_or_invalid_token')
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(access, path, body=None, binary=False, timeout=25):
    # No caller-supplied origin, no token on media/provider URLs, no retries.
    if path not in ['/whoami', '/metering/usage', '/drivers/call'] and not path.startswith('/read?file='):
        raise Blocked('unsupported_endpoint')
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf8')
    req = urllib.request.Request('https://api.puter.com' + path, data=data,
        headers={'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json',
                 'Accept': 'video/mp4' if binary else 'application/json', 'Cache-Control': 'no-cache'})
    limit = 50 * 1024 * 1024 if binary else 4 * 1024 * 1024
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout) as response:
            raw = response.read(limit + 1)
        if len(raw) > limit:
            raise Blocked('response_too_large')
        return raw if binary else json.loads(raw)
    except urllib.error.HTTPError as error:
        code = 'http_' + str(error.code)
        try:
            obj = json.loads(error.read(65536))
            nested = obj.get('error')
            candidate = nested.get('code') if isinstance(nested, dict) else obj.get('code')
            if candidate in ['insufficient_funds', 'subscription_required', 'access_denied',
                             'too_many_requests', 'invalid_token', 'model_not_found']:
                code += '_' + candidate
        except Exception:
            pass
        raise Blocked(code) from None
    except Blocked:
        raise
    except Exception:
        raise Blocked('provider_response_unresolved') from None


def free_pool(identity, usage):
    # This authorizes one audition against the ENTIRE remaining free pool, not a per-call quote.
    for key, expected in {'subscribed': False, 'is_temp': False, 'email_confirmed': True,
            'requires_email_confirmation': False, 'requires_phone_verification': False,
            'requires_card_verification': False, 'card_fallback_available': False,
            'subscription': None}.items():
        if key not in identity or identity[key] is not expected:
            raise Blocked('free_account_or_no_card_fallback_not_confirmed')
    info = usage.get('allowanceInfo', {})
    if info.get('unit') != 'credits' or info.get('monthUsageAllowance') != 1000:
        raise Blocked('monthly_free_pool_changed')
    remaining = info.get('remaining')
    if type(remaining) not in [int, float] or not 0 < remaining <= 1000:
        raise Blocked('free_pool_unavailable')
    addons = info.get('addons')
    if not isinstance(addons, dict) or any(value not in [0, None, {}] for value in addons.values()):
        raise Blocked('addons_or_purchased_credit_unverified')
    if not re.fullmatch(r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}', identity.get('uuid', '')):
        raise Blocked('unknown_account')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', identity.get('username', '')):
        raise Blocked('unknown_account_path')
    return {'remaining_credits_before': remaining, 'free_pool_ceiling_credits': 1000,
            'exact_call_credit_quote': None, 'cash_fallback_available': False,
            'account_fingerprint': sha(('puter:' + identity['uuid']).encode())}


def validate_model(envelope):
    if envelope.get('success') is not True or not isinstance(envelope.get('result'), list):
        raise Blocked('video_catalog_unavailable')
    matches = [x for x in envelope['result'] if x.get('id') == MODEL and x.get('provider') == PROVIDER]
    if len(matches) != 1:
        raise Blocked('pinned_model_unavailable')
    model = matches[0]
    if not (5 in model.get('durationSeconds', []) and 30 in model.get('fps', []) and
            '720P' in model.get('dimensions', []) and '9:16' in model.get('ratios', []) and
            'first' in model.get('keyframes', []) and model.get('costs_currency') == 'usd-cents' and
            model.get('costs', {}).get('per-second') == 2):
        raise Blocked('pinned_video_contract_changed')
    return sha(json.dumps(model, sort_keys=True).encode())


def collect(access, identity, state, folder):
    path = '/' + identity['username'] + '/' + state['remote_filename']
    raw = request(access, '/read?file=' + urllib.parse.quote(path, safe=''), binary=True, timeout=60)
    if len(raw) < 64 or raw[4:8] != b'ftyp':
        raise Blocked('saved_video_not_mp4')
    target = folder / 'original.mp4'
    if target.exists() and sha(target.read_bytes()) != sha(raw):
        raise Blocked('original_already_exists_with_other_hash')
    target.write_bytes(raw)
    state.update(phase='downloaded_review_pending', output_sha256=sha(raw), output_bytes=len(raw),
                 completed_at=stamp(), production_ready=False)
    try:
        after = request(access, '/metering/usage')['allowanceInfo']
        if after.get('unit') == 'credits':
            state['remaining_credits_after'] = after['remaining']
            state['observed_pool_debit_credits'] = state['remaining_credits_before'] - after['remaining']
    except Exception:
        state['balance_after_unresolved'] = True
    save(folder / 'state.json', state)
    return state


def audition(mode, root=ROOT):
    folder = root / 'output/puter-malu-audition'
    checkpoint = folder / 'state.json'
    if mode == 'run' and checkpoint.exists():
        raise Blocked('checkpoint_exists_use_resume_never_resubmit')
    if mode == 'prepare':
        ref = root / REFERENCE
        if not ref.is_file() or sha(ref.read_bytes()) != REFERENCE_SHA:
            raise Blocked('approved_reference_missing_or_changed')
        return {**PLAN, 'reference_sha256': REFERENCE_SHA, 'production_ready': False,
                'exact_call_credit_quote': None, 'maximum_free_pool_credits': 1000}
    access = token()
    identity = request(access, '/whoami')
    if mode == 'resume':
        state = json.loads(checkpoint.read_text('utf8'))
        if sha(('puter:' + identity['uuid']).encode()) != state['account_fingerprint']:
            raise Blocked('checkpoint_account_changed')
        if state['phase'] == 'downloaded_review_pending':
            if sha((folder / 'original.mp4').read_bytes()) != state['output_sha256']:
                raise Blocked('cached_video_changed')
            return state
        return collect(access, identity, state, folder)
    ref = root / REFERENCE
    if not ref.is_file() or sha(ref.read_bytes()) != REFERENCE_SHA:
        raise Blocked('approved_reference_missing_or_changed')
    catalog = request(access, '/drivers/call', {'interface': 'puter-video-generation',
        'driver': 'ai-video', 'method': 'models', 'args': {}})
    contract_hash = validate_model(catalog)
    # Fresh account flags and usage immediately before the single generation.
    identity = request(access, '/whoami')
    budget = free_pool(identity, request(access, '/metering/usage'))
    folder.mkdir(parents=True, exist_ok=True)
    lock = folder / 'submission.lock'
    try:
        with lock.open('x', encoding='utf8') as handle:
            handle.write('one_generation_only\n')
    except FileExistsError:
        raise Blocked('submission_lock_exists_never_resubmit') from None
    key = sha(json.dumps({'plan': PLAN, 'reference': REFERENCE_SHA,
        'account': budget['account_fingerprint']}, sort_keys=True).encode())
    state = {**budget, 'version': 1, 'request_key': key, 'plan': PLAN,
        'reference_sha256': REFERENCE_SHA, 'catalog_sha256': contract_hash,
        'remote_filename': 'novela-malu-puter-' + key[:24] + '.mp4',
        'phase': 'submission_started', 'started_at': stamp(), 'production_ready': False}
    save(checkpoint, state)  # Durable before POST, even if the connection is lost.
    payload = {'interface': 'puter-video-generation', 'driver': 'ai-video', 'method': 'generate',
        'test_mode': False, 'args': {**PLAN, 'input_reference':
            'data:image/png;base64,' + base64.b64encode(ref.read_bytes()).decode(),
            'puter_output_path': '~/' + state['remote_filename']}}
    payload['args'].pop('version')
    try:
        result = request(access, '/drivers/call', payload, timeout=600)
        if not isinstance(result, dict) or result.get('success') is not True:
            raise Blocked('generation_response_unresolved')
        state.update(phase='provider_completed', provider_completed_at=stamp())
        save(checkpoint, state)
        return collect(access, identity, state, folder)
    except Exception as error:
        state['phase'] = 'submission_unresolved_no_retry'
        state['error_code'] = str(error) if isinstance(error, Blocked) else 'provider_response_unresolved'
        save(checkpoint, state)
        raise Blocked(state['error_code']) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'run', 'resume'])
    args = parser.parse_args()
    try:
        result = audition(args.mode)
        # Prompts, account identifiers, URLs and credentials are never printed.
        print(json.dumps({k: result[k] for k in ['phase', 'production_ready',
            'remaining_credits_before', 'remaining_credits_after', 'observed_pool_debit_credits',
            'output_sha256', 'output_bytes', 'maximum_free_pool_credits'] if k in result}))
    except Exception as error:
        print(json.dumps({'status': 'blocked', 'code': str(error) if isinstance(error, Blocked)
                         else 'audition_failed', 'production_ready': False}))
        raise SystemExit(1) from None
