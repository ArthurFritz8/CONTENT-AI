import test from 'node:test';
import assert from 'node:assert/strict';
import {messages} from '../lib/messages.ts';
test('English and Spanish cover all Brazilian Portuguese interface strings',()=>{
  const keys=Object.keys(messages['pt-BR']).sort();
  for(const lang of ['en','es']) { assert.deepEqual(Object.keys(messages[lang]).sort(),keys,`${lang} translation parity`); for(const value of Object.values(messages[lang])) assert.ok(value.trim()); }
});
