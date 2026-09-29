import 'dart:convert';

String browserViewerDocument({
  required bool desktop,
  String? viewerModule,
  String? wsUrl,
  bool controlling = false,
  int? expiresAt,
  int generation = 0,
}) {
  const exportMarker = 'export{ne as default};';
  if (!desktop &&
      (viewerModule == null ||
          !viewerModule.contains(exportMarker) ||
          viewerModule.toLowerCase().contains('</script'))) {
    throw StateError('The packaged noVNC viewer is incompatible.');
  }
  final moduleScript = desktop
      ? ''
      : viewerModule!.replaceFirst(
          exportMarker,
          'window.SuperchargeNoVNC={RFB:ne};',
        );
  final initial = jsonEncode({
    'desktop': desktop,
    'wsUrl': wsUrl,
    'phase': controlling ? 'controlling' : 'watching',
    'expiresAt': expiresAt,
    'generation': generation,
  }).replaceAll('<', r'\u003c');
  return '''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content">
<meta name="referrer" content="no-referrer">
<title>Control desktop · Vectra</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#ecf2f5;background:#0b141a}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;flex-direction:column}button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;border-radius:6px}
button:disabled{opacity:.45;cursor:default}button:hover:not(:disabled){background:#25373f}button:focus-visible{outline:2px solid #6ee5c4;outline-offset:-2px}
#screen{flex:1;min-height:0;overflow:hidden;position:relative;background:#090d10}
#screen>div{background:#090d10!important}
footer{display:flex;align-items:center;gap:8px;flex:0 0 46px;padding:0 10px;background:#111b21;border-top:1px solid #314149}
#status{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#afbec7}
.icon{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0}.icon svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
#keyboard[aria-pressed=true]{color:#6ee5c4;background:#1f4038}
#done{padding:8px 12px;color:#6ee5c4;font-size:13px;font-weight:650;white-space:nowrap}
#error{padding:7px 12px;font-size:12px;line-height:1.4;color:#ffb1ae;background:#111b21;max-height:64px;overflow:auto}
#keyboard-input{position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;resize:none;overflow:hidden;pointer-events:none;font-size:16px}
#keys{flex-shrink:0;background:#111b21;border-top:1px solid #314149;padding:8px;max-height:36vh;overflow:auto}
.keyrow{display:flex;justify-content:center;gap:4px;margin:3px auto;max-width:760px}.key{min-width:28px;min-height:34px;flex:1;max-width:58px;background:#202f38;font-size:13px}.key.wide{flex:2;max-width:110px}.key.space{flex:5;max-width:340px}.key[aria-pressed=true]{background:#236052;color:white}
[hidden]{display:none!important}@media(max-width:480px){footer{padding:0 6px;gap:4px}#status{font-size:11px}#done{padding:8px}.icon{width:36px}}
</style></head><body>
<div id="screen"></div>
<textarea id="keyboard-input" aria-label="Remote keyboard input" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="text" tabindex="-1"></textarea>
<div id="keys" aria-label="On-screen keyboard" hidden></div>
<div id="error" role="alert" hidden></div>
<footer>
<span id="status" role="status">Taking over…</span>
<button id="keyboard" class="icon" title="Open keyboard" aria-label="Open keyboard" aria-pressed="false" disabled><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg></button>
<button id="retry" class="icon" title="Reconnect" aria-label="Reconnect desktop"><svg viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg></button>
<button id="done">Return control</button>
</footer>
<script type="module">
${desktop ? 'import RFB from "./rfb.mjs";' : moduleScript}
${desktop ? '' : 'const RFB=window.SuperchargeNoVNC.RFB;'}
const initial=$initial;
const settings=new URLSearchParams(location.hash.slice(1));
const reconnectEnabled=settings.get('reconnect')!=='0';
const reconnectDelay=Math.min(10000,Math.max(1000,Number(settings.get('reconnect_delay'))||2000));
const screen=document.getElementById('screen'),status=document.getElementById('status'),error=document.getElementById('error');
const done=document.getElementById('done'),retry=document.getElementById('retry'),keyboard=document.getElementById('keyboard');
const input=document.getElementById('keyboard-input'),keys=document.getElementById('keys');
const touchKeyboard=matchMedia('(pointer:coarse)').matches;
let rfb=null,connected=false,currentGeneration=-1,attemptedGeneration=-1,reconnectTimer=null;
let state=initial,lastStateAt=Date.now(),actionPending=false,ended=false,polling=false,keyboardOpen=false,composing=false;
let previousInput='',shift=false;
const held=new Map();
function notify(kind,extra={}){
  if(!initial.desktop&&window.BrowserViewer)window.BrowserViewer.postMessage(JSON.stringify({kind,generation:initial.generation,...extra}));
}
function message(text){status.textContent=text;}
function showError(text){error.hidden=!text;error.textContent=text||'';}
function mayControl(){
  return !ended&&!state.busy&&!state.inputPaused&&state.phase==='controlling'&&Number(state.expiresAt)>Date.now()
    &&(!initial.desktop||Date.now()-lastStateAt<2500);
}
function key(keysym,code){if(connected&&rfb&&mayControl())rfb.sendKey(keysym,code);}
function sendText(text){
  for(const char of text){const point=char.codePointAt(0);key(char==='\\n'?0xff0d:char==='\\t'?0xff09:point<=255?point:0x01000000+point);}
}
function resetInput(){input.value=' '.repeat(64);previousInput=input.value;input.setSelectionRange(input.value.length,input.value.length);}
function releaseKeys(){
  if(rfb)for(const [code,symbol] of held)rfb.sendKey(symbol,code,false);
  held.clear();shift=false;
}
function hideKeyboard(){
  keyboardOpen=false;input.blur();input.value='';previousInput='';composing=false;keys.hidden=true;releaseKeys();
  keyboard.setAttribute('aria-pressed','false');keyboard.setAttribute('aria-label','Open keyboard');keyboard.title='Open keyboard';
  if(rfb)rfb.focusOnClick=mayControl();
}
function applyMode(){
  const manual=mayControl();
  if(!manual&&keyboardOpen)hideKeyboard();
  if(rfb){rfb.viewOnly=!manual;rfb.focusOnClick=manual&&!keyboardOpen;}
  keyboard.disabled=!connected||!manual||actionPending;
  retry.disabled=Boolean(state.busy)||actionPending||ended;
  done.disabled=Boolean(state.busy)||actionPending||ended;
}
function editInput(event){
  if(composing||event.isComposing)return;
  if(!mayControl()||!connected){resetInput();return;}
  const old=Array.from(previousInput),next=Array.from(input.value);
  let same=0;while(same<old.length&&same<next.length&&old[same]===next[same])same++;
  for(let i=same;i<old.length;i++)key(0xff08,'Backspace');
  sendText(next.slice(same).join(''));
  resetInput();
}
input.addEventListener('compositionstart',()=>composing=true);
input.addEventListener('compositionend',event=>{composing=false;editInput(event);});
input.addEventListener('input',editInput);
input.addEventListener('keydown',event=>{
  event.stopPropagation();if(event.isComposing||composing)return;
  const special={Enter:[0xff0d,'Enter'],Tab:[0xff09,'Tab'],Escape:[0xff1b,'Escape'],ArrowLeft:[0xff51,'ArrowLeft'],ArrowUp:[0xff52,'ArrowUp'],ArrowRight:[0xff53,'ArrowRight'],ArrowDown:[0xff54,'ArrowDown']};
  if(special[event.key]){event.preventDefault();key(...special[event.key]);resetInput();}
});
input.addEventListener('keyup',event=>event.stopPropagation());
input.addEventListener('blur',()=>{if(keyboardOpen&&touchKeyboard){keyboardOpen=false;keyboard.setAttribute('aria-pressed','false');keyboard.setAttribute('aria-label','Open keyboard');keyboard.title='Open keyboard';if(rfb)rfb.focusOnClick=mayControl();}});
function drawKeys(){
  keys.replaceChildren();
  const rows=['1234567890','qwertyuiop','asdfghjkl','zxcvbnm'];
  function button(row,label,action,wide=false){const element=document.createElement('button');element.type='button';element.className=wide?'key wide':'key';element.textContent=label;element.addEventListener('pointerdown',event=>event.preventDefault());element.addEventListener('click',action);row.append(element);return element;}
  for(const chars of rows){const row=document.createElement('div');row.className='keyrow';for(const char of chars)button(row,shift?char.toUpperCase():char,()=>sendText(shift?char.toUpperCase():char));keys.append(row);}
  const row=document.createElement('div');row.className='keyrow';
  button(row,'Esc',()=>key(0xff1b,'Escape'));button(row,'Tab',()=>key(0xff09,'Tab'));
  button(row,'Shift',()=>{shift=!shift;drawKeys();},true).setAttribute('aria-pressed',String(shift));
  button(row,'Space',()=>key(32,'Space'),true).className='key space';
  button(row,'⌫',()=>key(0xff08,'Backspace'),true).setAttribute('aria-label','Backspace');
  button(row,'Enter',()=>key(0xff0d,'Enter'),true);keys.append(row);
}
keyboard.addEventListener('click',()=>{
  if(keyboardOpen){hideKeyboard();applyMode();return;}
  if(!connected||!mayControl())return;
  keyboardOpen=true;keyboard.setAttribute('aria-pressed','true');keyboard.setAttribute('aria-label','Hide keyboard');keyboard.title='Hide keyboard';
  if(touchKeyboard){resetInput();input.focus({preventScroll:true});}else{drawKeys();keys.hidden=false;}
  applyMode();
});
function disconnect(){
  clearTimeout(reconnectTimer);reconnectTimer=null;hideKeyboard();connected=false;
  const previous=rfb;rfb=null;
  if(previous){previous.viewOnly=true;previous.focusOnClick=false;previous.disconnect();}
  screen.replaceChildren();applyMode();
}
function connect(url,generation){
  disconnect();currentGeneration=generation;attemptedGeneration=generation;message('Connecting…');
  try{
    const client=new RFB(screen,url,{shared:true,credentials:{}});rfb=client;
    client.qualityLevel=9;client.compressionLevel=0;
    client.scaleViewport=true;client.resizeSession=false;client.viewOnly=!mayControl();client.focusOnClick=mayControl();
    client.addEventListener('connect',()=>{
      if(client!==rfb)return;connected=true;showError('');message(mayControl()?'You have control':'Input paused');notify('connected');applyMode();
    });
    client.addEventListener('disconnect',event=>{
      if(ended){notify('suspended');return;}if(client!==rfb)return;connected=false;hideKeyboard();applyMode();
      const reason=String(event.detail.reason||'').trim();
      const text=/^(Browser VNC|Unable to establish|Viewer connection)/.test(reason)?reason:'Desktop disconnected. Reconnect or return control.';
      message('Disconnected');showError(text);notify('disconnected',{message:text});
      if(initial.desktop&&reconnectEnabled&&!ended&&!state.busy&&!actionPending&&state.phase==='controlling')reconnectTimer=setTimeout(()=>action('reconnect'),reconnectDelay);
    });
    client.addEventListener('credentialsrequired',()=>{showError('Unsupported VNC credentials. Return control and check the sandbox.');client.disconnect();});
    client.addEventListener('securityfailure',()=>{showError('The desktop rejected the connection. Reconnect or return control.');notify('error');});
  }catch(_){message('Connection failed');showError('Could not connect to the AI browser. Reconnect or return control.');notify('error');}
}
window.SuperchargeBrowser={suspend(){
  ended=true;hideKeyboard();const wasConnected=connected;connected=false;
  if(rfb){rfb.viewOnly=true;rfb.focusOnClick=false;rfb.disconnect();}
  if(!wasConnected)notify('suspended');message('Returning control…');applyMode();return true;
}};
function update(next){
  state=next;lastStateAt=Date.now();
  settings.set('view_only',mayControl()?'0':'1');history.replaceState(null,'',location.pathname+location.search+'#'+settings.toString());
  const generation=Number(next.generation);
  if(currentGeneration!==generation&&rfb)disconnect();
  if(next.busy||next.inputPaused){disconnect();message(next.inputPaused?'Input paused':next.phase==='takingControl'?'Taking over…':'Returning control…');}
  else if(!ended&&!actionPending&&next.phase==='controlling'&&attemptedGeneration!==generation){
    const url=new URL('vnc',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';url.hash='';
    url.searchParams.set('generation',String(generation));connect(url.href,generation);
  }
  showError(next.error||'');applyMode();
}
async function poll(){
  if(polling||ended)return;polling=true;
  try{const response=await fetch('state',{cache:'no-store'});if(!response.ok)throw new Error();update(await response.json());}
  catch(_){disconnect();message('App disconnected');showError('Input is disabled. Return to the app.');}
  finally{polling=false;}
}
async function action(name){
  if(actionPending||ended)return;hideKeyboard();
  if(!initial.desktop){notify(name);return;}
  actionPending=true;applyMode();disconnect();
  try{
    const response=await fetch('action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:name,notes:''})});
    if(!response.ok)throw new Error();update(await response.json());
  }catch(_){if(!ended)showError('Action could not be confirmed. Retry in the app.');}
  finally{actionPending=false;applyMode();await poll();}
}
done.addEventListener('click',()=>action('returnControl'));retry.addEventListener('click',()=>action('reconnect'));
setInterval(()=>{applyMode();if(rfb&&!mayControl()){rfb.viewOnly=true;message('Input paused');}},200);
window.addEventListener('pagehide',()=>{ended=true;disconnect();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideKeyboard();});
if(initial.desktop){await poll();setInterval(poll,750);}else if(initial.phase==='controlling')connect(initial.wsUrl,initial.generation);
</script></body></html>''';
}
