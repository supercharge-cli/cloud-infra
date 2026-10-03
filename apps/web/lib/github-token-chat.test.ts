import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openToken, sealToken } from './github-token-chat';

test('owner-requested token chat value is authenticated and scoped to one instance', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'isolated-test-auth-secret-over-24-characters';
  try {
    const value = 'gho_' + 'a'.repeat(40);
    const sealed = sealToken('instance-a', value);
    assert.equal(openToken('instance-a', sealed), value);
    assert.equal(JSON.stringify(sealed).includes(value), false);
    assert.throws(() => openToken('instance-b', sealed));
    assert.throws(() => openToken('instance-a', { ...sealed, ciphertext: Buffer.from('corrupt').toString('base64') }));
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});
