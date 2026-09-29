const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element() {
  const listeners = new Map();
  return {
    value: '', hidden: false, textContent: '', title: '', children: [], attrs: {}, style: {},
    addEventListener(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); },
    emit(name, extra = {}) { for (const listener of listeners.get(name) || []) listener({ preventDefault() {}, stopPropagation() {}, ...extra }); },
    setAttribute(name, value) { this.attrs[name] = value; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    focus() { this.focused = true; }, blur() { this.focused = false; this.emit('blur'); },
  };
}

async function check(touch) {
  let script = fs.readFileSync(process.argv[2], 'utf8');
  const elements = Object.fromEntries(['screen', 'status', 'error', 'done', 'retry', 'keyboard', 'keyboard-input', 'keys'].map(id => [id, element()]));
  const events = [], clients = [], intervals = [];
  class RFB {
    constructor() { this.keys = []; this.listeners = new Map(); clients.push(this); }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    sendKey(...args) { this.keys.push(args); }
    disconnect() { this.listeners.get('disconnect')?.({ detail: { clean: true } }); }
  }
  const window = { SuperchargeNoVNC: { RFB }, BrowserViewer: { postMessage(value) { events.push(JSON.parse(value)); } }, addEventListener() {} };
  const context = vm.createContext({
    console, URL, URLSearchParams, Date,
    window, document: { hidden: false, getElementById: id => elements[id], createElement: element, addEventListener() {} },
    matchMedia: () => ({ matches: touch }), location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} },
    setTimeout, clearTimeout, setInterval: fn => { intervals.push(fn); },
  });
  script = script.replace('const ne=class RFB{};window.SuperchargeNoVNC={RFB:ne};', '');
  await vm.runInContext(`(async()=>{${script}})()`, context);
  const client = clients[0];
  assert.ok(client, 'control connects only after explicit controlling state');
  assert.equal(client.qualityLevel, 9, 'request maximum JPEG quality before connecting');
  assert.equal(client.compressionLevel, 0, 'request minimum compression without replacing zero with a default');
  client.listeners.get('connect')();
  elements.keyboard.emit('click');
  assert.equal(elements.keyboard.attrs['aria-pressed'], 'true');
  if (touch) {
    const input = elements['keyboard-input'];
    assert.equal(input.focused, true);
    input.value += 'a'; input.emit('input');
    assert.equal(client.keys.at(-1)[0], 97);
    input.value += 'é'; input.emit('input');
    assert.equal(client.keys.at(-1)[0], 233);
    input.value += '🙂'; input.emit('input');
    assert.equal(client.keys.at(-1)[0], 0x01000000 + 0x1f642);
    const before = client.keys.length;
    input.emit('compositionstart'); input.value += '你'; input.emit('input', { isComposing: true });
    assert.equal(client.keys.length, before);
    input.emit('compositionend'); input.emit('input');
    assert.equal(client.keys.length, before + 1, 'composition is committed once');
    assert.equal(client.keys.at(-1)[0], 0x01000000 + '你'.codePointAt(0));
    input.value = input.value.slice(0, -1); input.emit('input');
    assert.equal(client.keys.at(-1)[0], 0xff08);
    input.emit('keydown', { key: 'Enter' });
    assert.equal(client.keys.at(-1)[0], 0xff0d);
  } else {
    assert.equal(elements.keys.hidden, false);
    const button = elements.keys.children[1].children[0];
    button.emit('click');
    assert.equal(client.keys.at(-1)[0], 'q'.charCodeAt(0));
  }
  elements.done.emit('click');
  assert.equal(events.at(-1).kind, 'returnControl');
  assert.equal(elements.keyboard.attrs['aria-pressed'], 'false');
  window.SuperchargeBrowser.suspend();
  const before = client.keys.length;
  elements['keyboard-input'].value += 'private'; elements['keyboard-input'].emit('input');
  assert.equal(client.keys.length, before, 'suspended viewer cannot send keys');
}

(async () => { await check(true); await check(false); console.log('keyboard forwarding, Unicode, composition, backspace, return, and suspension passed'); })().catch(error => { console.error(error); process.exitCode = 1; });
