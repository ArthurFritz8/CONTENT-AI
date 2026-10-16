import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

import puter_malu_audition as p

IDENTITY = {'uuid': '11111111-2222-4333-8444-555555555555', 'username': 'fixture',
    'subscribed': False, 'subscription': None, 'is_temp': False, 'email_confirmed': True,
    'requires_email_confirmation': False, 'requires_phone_verification': False,
    'requires_card_verification': False, 'card_fallback_available': False}
USAGE = {'allowanceInfo': {'unit': 'credits', 'monthUsageAllowance': 1000,
    'remaining': 999.9, 'addons': {}}}
CATALOG = {'success': True, 'result': [{'id': p.MODEL, 'provider': p.PROVIDER,
    'durationSeconds': [2, 3, 4, 5], 'fps': [30], 'dimensions': ['720P', '1080P'],
    'ratios': ['9:16'], 'keyframes': ['first'], 'costs_currency': 'usd-cents',
    'costs': {'per-second': 2}}]}
REFERENCE = b'fixture-image-no-real-service'
VIDEO = b'\0\0\0\x20ftyp' + bytes(128)


class PuterAuditionTest(unittest.TestCase):
    def setUp(self):
        # Small retained fixtures stay under the ignored audit directory. No recursive deletion.
        self.root = p.ROOT / '.audit-tmp/puter-audition-unit' / str(uuid4())
        ref = self.root / p.REFERENCE
        ref.parent.mkdir(parents=True, exist_ok=True)
        ref.write_bytes(REFERENCE)
        self.calls = []
        self.patch_ref = patch.object(p, 'REFERENCE_SHA', p.sha(REFERENCE))
        self.patch_token = patch.object(p, 'token', return_value='fixture-credential')
        self.patch_request = patch.object(p, 'request', side_effect=self.fake_request)
        for obj in [self.patch_ref, self.patch_token, self.patch_request]:
            obj.start()
            self.addCleanup(obj.stop)
        self.fail_generate = False

    def fake_request(self, access, path, body=None, **kwargs):
        self.assertEqual(access, 'fixture-credential')
        self.calls.append((path, body))
        if path == '/whoami':
            return copy.deepcopy(IDENTITY)
        if path == '/metering/usage':
            return copy.deepcopy(USAGE)
        if path.startswith('/read?file='):
            return VIDEO
        self.assertEqual(path, '/drivers/call')
        if body['method'] == 'models':
            return copy.deepcopy(CATALOG)
        self.assertEqual(body['method'], 'generate')
        if self.fail_generate:
            raise p.Blocked('provider_response_unresolved')
        self.assertIs(body['test_mode'], False)
        self.assertEqual(body['args']['model'], p.MODEL)
        self.assertEqual(body['args']['seconds'], 5)
        self.assertEqual(body['args']['fps'], 30)
        self.assertTrue(body['args']['generate_audio'])
        self.assertTrue(body['args']['puter_output_path'].startswith('~/novela-malu-puter-'))
        self.assertTrue(body['args']['input_reference'].startswith('data:image/png;base64,'))
        return {'success': True, 'result': 'https://not-followed.example.invalid/private'}

    def test_free_pool_is_not_a_quote_or_dollar_conversion(self):
        result = p.free_pool(IDENTITY, USAGE)
        self.assertEqual(result['free_pool_ceiling_credits'], 1000)
        self.assertIsNone(result['exact_call_credit_quote'])
        self.assertFalse(result['cash_fallback_available'])

    def test_paid_card_guest_or_unverified_accounts_are_blocked(self):
        for key, bad in [('subscribed', True), ('subscription', {}), ('is_temp', True),
                ('email_confirmed', False), ('card_fallback_available', True),
                ('requires_card_verification', True)]:
            identity = {**IDENTITY, key: bad}
            with self.assertRaises(p.Blocked):
                p.free_pool(identity, USAGE)
        identity = dict(IDENTITY)
        del identity['card_fallback_available']
        with self.assertRaises(p.Blocked):
            p.free_pool(identity, USAGE)

    def test_changed_unit_allowance_or_purchased_credit_is_blocked(self):
        for changed in [{'unit': 'usd'}, {'monthUsageAllowance': 2000}, {'remaining': 0},
                {'remaining': 1001}, {'remaining': True}, {'addons': None},
                {'addons': {'purchasedCredits': 1}}, {'addons': {'unknown': 100}}]:
            with self.assertRaises(p.Blocked):
                p.free_pool(IDENTITY, {'allowanceInfo': {**USAGE['allowanceInfo'], **changed}})

    def test_changed_model_contract_is_blocked(self):
        for changed in [{'fps': [24]}, {'durationSeconds': [10]}, {'costs_currency': 'credits'},
                {'costs': {'per-second': 3}}, {'provider': 'other'}, {'keyframes': []}]:
            catalog = {'success': True, 'result': [{**CATALOG['result'][0], **changed}]}
            with self.assertRaises(p.Blocked):
                p.validate_model(catalog)

    def test_success_uses_original_reference_one_post_and_private_fs_read(self):
        result = p.audition('run', self.root)
        self.assertEqual(result['phase'], 'downloaded_review_pending')
        self.assertEqual(result['output_sha256'], p.sha(VIDEO))
        self.assertFalse(result['production_ready'])
        self.assertEqual(sum(body is not None and body.get('method') == 'generate'
                             for _, body in self.calls), 1)
        self.assertFalse(any(path.startswith('https:') for path, _ in self.calls))
        state = (self.root / 'output/puter-malu-audition/state.json').read_text('utf8')
        self.assertNotIn('fixture-credential', state)
        self.assertNotIn('not-followed', state)

    def test_existing_checkpoint_cannot_submit_twice(self):
        p.audition('run', self.root)
        self.calls.clear()
        with self.assertRaisesRegex(p.Blocked, 'checkpoint_exists'):
            p.audition('run', self.root)
        self.assertEqual(self.calls, [])

    def test_lost_response_is_durable_and_resume_only_reads(self):
        self.fail_generate = True
        with self.assertRaises(p.Blocked):
            p.audition('run', self.root)
        state = json.loads((self.root / 'output/puter-malu-audition/state.json').read_text('utf8'))
        self.assertEqual(state['phase'], 'submission_unresolved_no_retry')
        self.calls.clear()
        result = p.audition('resume', self.root)
        self.assertEqual(result['phase'], 'downloaded_review_pending')
        self.assertTrue(all(body is None for _, body in self.calls))

    def test_changed_reference_never_submits(self):
        (self.root / p.REFERENCE).write_bytes(b'changed')
        with self.assertRaisesRegex(p.Blocked, 'approved_reference'):
            p.audition('run', self.root)
        self.assertTrue(all(body is None or body.get('method') != 'generate' for _, body in self.calls))

    def test_resume_checks_cached_video_hash(self):
        p.audition('run', self.root)
        (self.root / 'output/puter-malu-audition/original.mp4').write_bytes(b'changed')
        self.calls.clear()
        with self.assertRaisesRegex(p.Blocked, 'cached_video_changed'):
            p.audition('resume', self.root)
        self.assertTrue(all(body is None for _, body in self.calls))


if __name__ == '__main__':
    unittest.main()
