import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDirectGitHubConversation, isGitHubCliToken } from './github-token';

const listing = { conversations: [
  { sessionId: 'direct-1', source: 'direct' },
  { sessionId: 'group-1', source: 'group' },
  { sessionId: 'bot-github', source: 'delegation' },
] };

test('only a direct GitHub conversation may receive a token', () => {
  assert.equal(isDirectGitHubConversation(listing, 'direct-1'), true);
  for (const id of ['group-1', 'bot-github', 'missing', 'direct-1; echo leak']) {
    assert.equal(isDirectGitHubConversation(listing, id), false);
  }
  assert.equal(isDirectGitHubConversation({}, 'direct-1'), false);
});

test('reject multiline and malformed CLI output before disclosure', () => {
  assert.equal(isGitHubCliToken('gho_' + 'a'.repeat(36)), true);
  assert.equal(isGitHubCliToken('github_pat_' + 'b'.repeat(60)), true);
  for (const token of ['', 'a'.repeat(19), 'gho_' + 'a'.repeat(36) + '\nwarning', 'a'.repeat(513)]) {
    assert.equal(isGitHubCliToken(token), false);
  }
});
