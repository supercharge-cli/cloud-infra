import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computerBotId, computerBotQuery, matchesComputerBot } from './computer-target';

test('defaults omitted desktop target to Main and preserves specialist IDs', () => {
  assert.equal(computerBotId(undefined), 'main');
  assert.equal(computerBotId(''), 'main');
  assert.equal(computerBotId('research_1'), 'research_1');
  assert.equal(computerBotQuery('research_1'), 'botId=research_1');
});

test('rejects malformed desktop targets before proxying requests', () => {
  for (const value of ['../main', 'a/b', 'a b', 'x'.repeat(65), {}, 4]) {
    assert.equal(computerBotId(value), null);
  }
});

test('does not show Main when an older daemon ignores a specialist target', () => {
  assert.equal(matchesComputerBot({ desktop: { botId: 'research' } }, 'research'), true);
  assert.equal(matchesComputerBot({ botId: 'research' }, 'research'), true);
  assert.equal(matchesComputerBot({ desktop: { botId: 'main' } }, 'research'), false);
  assert.equal(matchesComputerBot({ connected: true }, 'research'), false);
  assert.equal(matchesComputerBot({ connected: true }, 'main'), true);
});
