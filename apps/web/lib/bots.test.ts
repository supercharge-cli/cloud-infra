import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(deps: Record<string, unknown>) {
  let source = readFileSync(new URL('./bots.ts', import.meta.url), 'utf8');
  source = source.replace(/^import .*;\n/gm, '').replace(/export /g, '');
  const js = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function(...Object.keys(deps), `${js}; return {botName,botIcon,botFolder,botInstructions,ensureMainBot,ensureGithubBot,listBots,getBot,createBot,updateBot,exposedBot,CHIEF_INSTRUCTIONS,GITHUB_INSTRUCTIONS};`)(...Object.values(deps));
}

const instance = {id:'instance-a',userId:'user-a',runtime:'supercharge'};
function fixture(ids: string[] = []) {
  const rows = new Map<string, any>();
  let id = 0;
  const key = (query:any) => `${query.instanceId}:${query.id}`;
  const matches = (row:any, query:any) => Object.entries(query).every(([field,value]) => row[field] === value);
  const col = {
    async findOne(query:any) { return [...rows.values()].find((row) => matches(row,query)) ?? null; },
    async updateOne(query:any, update:any) {
      if (!rows.has(key(query))) rows.set(key(query), update.$setOnInsert);
    },
    async insertOne(row:any) { if (rows.has(key(row))) throw Object.assign(new Error('duplicate'),{code:11000}); rows.set(key(row), row); },
    async findOneAndUpdate(query:any, update:any) {
      const row = rows.get(key(query));
      if (!row || !matches(row,query)) return null;
      const updated = {...row,...update.$set,revision:row.revision+(update.$inc?.revision ?? 0)};
      rows.set(key(query),updated);return updated;
    },
    find(query:any) { return {sort:() => ({toArray:async () => [...rows.values()].filter((row) => matches(row,query))})}; },
  };
  const api = load({getDb:async () => ({collection:() => col}),nanoid:() => ids.shift() ?? `bot-${++id}`,Buffer});
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

test('stock Main migration retains identity, and customized bots are not clobbered', async () => {
  const {api,rows} = fixture();
  const old = {id:'main',instanceId:instance.id,userId:instance.userId,name:'Main',icon:'🤖',
    instructions:'',defaultFolder:'/home/user/workspace',archived:false,revision:1,
    createdAt:'2020-01-01',updatedAt:'2020-01-01'};
  rows.set('instance-a:main',old);
  const migrated = await api.ensureMainBot(instance);
  assert.equal(migrated.id,'main');assert.equal(migrated.name,'Chief');
  assert.equal(migrated.instructions,api.CHIEF_INSTRUCTIONS);
  assert.equal(migrated.createdAt,old.createdAt);
  assert.equal((await api.ensureMainBot(instance)).revision,migrated.revision);
  rows.set('instance-a:main',{...old,name:'My Main',instructions:'Keep this',revision:2});
  assert.equal((await api.ensureMainBot(instance)).name,'My Main');
  for (const change of [{icon:'🔎'}, {instructions:'custom'}, {defaultFolder:'/home/user/workspace/custom'}]) {
    rows.set('instance-a:main',{...old,...change});
    assert.equal((await api.ensureMainBot(instance)).name,'Main');
  }
});

test('concurrent seed and lookup yield one Chief and one GitHub in stable order', async () => {
  const {api,rows} = fixture();
  const custom = await api.createBot(instance,{name:'Research'});
  const [first,second] = await Promise.all([api.listBots(instance),api.listBots(instance)]);
  assert.deepEqual(first.map((bot:any) => bot.id),['main','github',custom.id]);
  assert.deepEqual(second.map((bot:any) => bot.id),first.map((bot:any) => bot.id));
  assert.equal(rows.size,3);
  assert.equal((await api.getBot(instance,'github')).instructions,api.GITHUB_INSTRUCTIONS);
  assert.match((await api.getBot(instance,'main')).instructions,/vectra_bot action send/);
  assert.match(api.GITHUB_INSTRUCTIONS,/CLI login and GitHub MCP authentication are separate/);
  assert.equal((await api.listBots(instance)).length,3);
});

test('GitHub archive recovery keeps customization and cannot be archived again', async () => {
  const {api,rows} = fixture();
  const github = await api.ensureGithubBot(instance);
  rows.set('instance-a:github',{...github,name:'Repos',icon:'🔎',instructions:'Personal rules',
    defaultFolder:'/home/user/workspace/my-repos',archived:true});
  const restored = await api.getBot(instance,'github');
  assert.equal(restored.name,'Repos');assert.equal(restored.instructions,'Personal rules');
  assert.equal(restored.icon,'🔎');assert.equal(restored.defaultFolder,'/home/user/workspace/my-repos');
  assert.equal(restored.archived,false);
  assert.equal((await api.getBot(instance,'github')).revision,restored.revision);
  await assert.rejects(api.updateBot(instance,'github',{archived:true}),/cannot be archived/);
  const edited = await api.updateBot(instance,'github',{name:'My GitHub',icon:'🤖'});
  assert.equal(edited.name,'My GitHub');assert.equal((await api.getBot(instance,'github')).icon,'🤖');
});

test('sync publishes Chief and GitHub together without another VM', async () => {
  const {api} = fixture();
  const source = readFileSync(new URL('./bot-service.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
  const js = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  const payloads:any[] = [];
  const sync = new Function('listBots','exposedBot','ensureBotCapability','proxyInbox',`${js};return syncBots;`)(
    api.listBots,api.exposedBot,async () => 'capability',async (_:any, path:string, options:any) => {
      assert.equal(path,'/v1/app/bots/sync');payloads.push(JSON.parse(options.body));return {ok:true};
    });
  await sync(instance);
  assert.equal(payloads.length,1);
  assert.deepEqual(payloads[0].bots.map((bot:any) => bot.id),['main','github']);
  assert.equal(payloads[0].bots[0].name,'Chief');
});

test('arbitrary creates cannot allocate reserved bot identities', async () => {
  const {api} = fixture(['main','github','bot-custom']);
  const bot = await api.createBot(instance,{name:'Research'});
  assert.equal(bot.id,'bot-custom');
  const exhausted = fixture(Array(11).fill('github'));
  await assert.rejects(exhausted.api.createBot(instance,{name:'Research'}),/Could not allocate/);
});

test('non-Supercharge instances retain only stock Main behavior', async () => {
  const {api} = fixture();
  const legacy = {...instance,runtime:'xibecode',id:'old-instance'};
  assert.deepEqual((await api.listBots(legacy)).map((bot:any) => bot.id),['main']);
  assert.equal((await api.getBot(legacy,'main')).name,'Main');
  assert.equal(await api.ensureGithubBot(legacy),null);
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

test('web avatar renders the GitHub preset and preserves custom images', () => {
  const source = readFileSync(new URL('../components/agent-chats.tsx', import.meta.url),'utf8');
  const avatar = source.slice(source.indexOf('function Avatar('),source.indexOf('export function AgentChats('));
  const js = ts.transpileModule(avatar, {compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.None}}).outputText;
  const element = (type:any, props:any, ...children:any[]) => ({type,props,children});
  const render = new Function('React','useState','Github','CircleUserRound',`${js}; return Avatar;`)(
    {createElement:element},() => [undefined,() => {}], 'GithubIcon', 'FallbackIcon');
  assert.equal(render({bot:{id:'github',icon:'github'},instance:'instance'}).children[0].type,'GithubIcon');
  assert.equal(render({bot:{id:'main',icon:'🤖'},instance:'instance'}).children[0].type,'FallbackIcon');
  const custom = render({bot:{id:'github',icon:'data:image/png;base64,YWJj'},instance:'instance'});
  assert.equal(custom.children[0].type,'img');
});

test('public bot excludes internal owner and idempotency identifiers', async () => {
  const {api} = fixture();
  const bot = await api.createBot(instance,{name:'Research',createKey:'unique-request-2'});
  const exposed = api.exposedBot({...bot,_id:'mongo'});
  assert.equal(exposed.userId,undefined);assert.equal(exposed.createKey,undefined);assert.equal(exposed._id,undefined);
});
