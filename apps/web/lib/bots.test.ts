import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(deps: Record<string, unknown>) {
  let source = readFileSync(new URL('./bots.ts', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replace(/export /g, '');
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function(...Object.keys(deps), `${js}; return {botName,botIcon,botFolder,botInstructions,ensureMainBot,createBot,updateBot,exposedBot};`)(...Object.values(deps));
}

const instance = {id:'instance-a',userId:'user-a'};
function fixture() {
  const rows = new Map<string, any>();
  let id = 0;
  const key = (query:any) => `${query.instanceId}:${query.id}`;
  const col = {
    async findOne(query:any) {
      if (query.createKey) return [...rows.values()].find((row) => row.instanceId === query.instanceId && row.createKey === query.createKey) ?? null;
      const row = rows.get(key(query));
      if (row && query.archived !== undefined && row.archived !== query.archived) return null;
      return row ?? null;
    },
    async updateOne(query:any, update:any) { if (!rows.has(key(query))) rows.set(key(query), update.$setOnInsert); },
    async insertOne(row:any) {rows.set(key(row), row);},
    async findOneAndUpdate(query:any, update:any) {
      const row = rows.get(key(query));
      if (!row || row.revision !== query.revision) return null;
      const updated = {...row,...update.$set,revision:row.revision+1};rows.set(key(query),updated);return updated;
    },
  };
  const api = load({getDb:async () => ({collection:() => col}),nanoid:() => `bot-${++id}`,Buffer});
  return {api,rows};
}

test('each new bot gets a unique immutable identity and default folder', async () => {
  const {api} = fixture();
  const a = await api.createBot(instance,{name:'Research'});
  const b = await api.createBot(instance,{name:'Research'});
  assert.notEqual(a.id,b.id);
  assert.notEqual(a.defaultFolder,b.defaultFolder);
  assert.equal(a.userId,'user-a');
});

test('Main migration is repeatable and does not overwrite user edits', async () => {
  const {api,rows} = fixture();
  const main = await api.ensureMainBot(instance);
  rows.set('instance-a:main',{...main,name:'My Main',instructions:'Keep this',revision:2});
  const again = await api.ensureMainBot(instance);
  assert.equal(again.name,'My Main');assert.equal(again.instructions,'Keep this');
});

test('repeated create request reuses same bot and rejects mismatched payload', async () => {
  const {api} = fixture();
  const input = {name:'Research',createKey:'unique-request-1'};
  assert.equal((await api.createBot(instance,input)).id,(await api.createBot(instance,input)).id);
  await assert.rejects(api.createBot(instance,{...input,name:'Another'}), /already used/);
});

test('owner-scoped lookup prevents edits across instances and Main cannot be archived', async () => {
  const {api} = fixture();
  const bot = await api.createBot(instance,{name:'Research'});
  assert.equal(await api.updateBot({id:'instance-b',userId:'user-b'},bot.id,{name:'Stolen'}),null);
  await api.ensureMainBot(instance);
  await assert.rejects(api.updateBot(instance,'main',{archived:true}), /cannot be archived/);
});

test('rejects folder escapes, control characters, and unsafe icon URLs', () => {
  const {api} = fixture();
  for (const path of ['/etc','/home/user/workspace/../secret','/home/user/workspace2/a','/home/user/workspace//a']) {
    assert.throws(() => api.botFolder(path,'a'));
  }
  assert.throws(() => api.botName('bad\nname'));
  assert.throws(() => api.botIcon('https://arbitrary.invalid/icon.svg'));
  assert.throws(() => api.botIcon('data:image/svg+xml;base64,AA=='));
  assert.throws(() => api.botIcon('data:image/png;base64,iVBORw0KGgo='));
  assert.equal(api.botIcon('🔎'),'🔎');
});

test('public bot excludes internal owner and idempotency identifiers', async () => {
  const {api} = fixture();
  const bot = await api.createBot(instance,{name:'Research',createKey:'unique-request-2'});
  const exposed = api.exposedBot({...bot,_id:'mongo'});
  assert.equal(exposed.userId,undefined);assert.equal(exposed.createKey,undefined);assert.equal(exposed._id,undefined);
});
