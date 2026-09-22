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
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>AI browser · Vectra</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#e4e7ee;background:#0b0b0d}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
body{display:flex;flex-direction:column}header{padding:14px 18px;background:#16181e;border-bottom:1px solid #30343e}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.title{font-weight:700;margin-right:auto}
button,textarea{font:inherit;color:inherit;background:#242833;border:1px solid #424858;border-radius:8px}
button{padding:9px 14px;cursor:pointer}button:disabled{opacity:.5;cursor:default}
#take,#done{background:#b9f5c4;color:#15241a;border-color:#b9f5c4;font-weight:650}
#hint{font-size:13px;color:#b7bdcb;margin:10px 0 0;line-height:1.5}
#notes{width:100%;margin-top:10px;padding:10px;resize:vertical;min-height:44px;max-height:110px}
#status,#error{padding:10px 18px;font-size:13px;line-height:1.5;background:#16181e}
#error{color:#ffb1ae;white-space:pre-wrap;border-top:1px solid #443032}
#screen{flex:1;min-height:0;overflow:hidden;position:relative;background:#0b0b0d}
[hidden]{display:none!important}
</style></head><body>
<header id="toolbar" ${desktop ? '' : 'hidden'}>
<div class="row"><span class="title">AI browser</span><span id="mode">View only</span>
<button id="retry">Reconnect</button><button id="take" disabled>Take control</button>
<button id="done" hidden>Done &amp; continue</button></div>
<p id="hint">This is the browser the AI is using, not your project preview. Watching does not interrupt the AI.</p>
<textarea id="notes" hidden maxlength="4000" rows="2" aria-label="What did you change?" placeholder="Optional: tell the AI what you changed. Do not include passwords or other secrets."></textarea>
</header>
<div id="status" role="status">Connecting to the AI browser…</div>
<div id="error" role="alert" hidden></div><div id="screen"></div>
<script type="module">
${desktop ? 'import RFB from "./rfb.mjs";' : moduleScript}
const RFB=${desktop ? 'RFB' : 'window.SuperchargeNoVNC.RFB'};
const initial=$initial;
const screen=document.getElementById('screen');
const status=document.getElementById('status');
const error=document.getElementById('error');
const take=document.getElementById('take');
const done=document.getElementById('done');
const retry=document.getElementById('retry');
const notes=document.getElementById('notes');
const mode=document.getElementById('mode');
const hint=document.getElementById('hint');
let rfb=null,connected=false,currentGeneration=-1,attemptedGeneration=-1;
let state=initial,lastStateAt=Date.now(),actionPending=false,ended=false,polling=false;
function notify(kind,extra={}){
  if(!initial.desktop&&window.BrowserViewer){
    window.BrowserViewer.postMessage(JSON.stringify({kind,generation:initial.generation,...extra}));
  }
}
function message(text){status.textContent=text;}
function showError(text){error.hidden=!text;error.textContent=text||'';}
function mayControl(){
  return !ended&&state.phase==='controlling'&&Number(state.expiresAt)>Date.now()
    &&(!initial.desktop||Date.now()-lastStateAt<2500);
}
function applyMode(){
  const manual=mayControl();
  if(rfb){rfb.viewOnly=!manual;rfb.focusOnClick=manual;}
  mode.textContent=manual?'You have control · AI stopped':'View only';
  take.hidden=Boolean(state.hasControl)||manual;
  done.hidden=!state.hasControl&&!manual;
  done.textContent=state.canContinue?'Done & continue':'Return control';
  notes.hidden=!state.canContinue;
  take.disabled=!connected||Boolean(state.busy)||actionPending||ended;
  done.disabled=Boolean(state.busy)||actionPending||ended;
  retry.disabled=Boolean(state.busy)||actionPending||ended;
  hint.textContent=manual
    ?'The AI is stopped. Stay in this same tab so the AI can inspect your changes. Done & continue returns control to the AI.'
    :'This is the browser the AI is using, not your project preview. Watching does not interrupt the AI.';
}
function disconnect(){
  connected=false;
  const previous=rfb;rfb=null;
  if(previous){previous.viewOnly=true;previous.focusOnClick=false;previous.disconnect();}
  screen.replaceChildren();
  applyMode();
}
function connect(url,generation){
  disconnect();currentGeneration=generation;attemptedGeneration=generation;
  message('Connecting to the AI browser…');
  try{
    const client=new RFB(screen,url,{shared:true,credentials:{}});
    rfb=client;client.scaleViewport=true;client.resizeSession=false;
    client.viewOnly=!mayControl();client.focusOnClick=mayControl();
    client.addEventListener('connect',()=>{
      if(client!==rfb)return;
      connected=true;showError('');
      message(mayControl()?'Live browser · you have control':'Live browser · view only');
      notify('connected');applyMode();
    });
    client.addEventListener('disconnect',event=>{
      if(ended){notify('suspended');return;}
      if(client!==rfb)return;
      connected=false;applyMode();
      const text=event.detail.clean?'Browser view disconnected. Reconnect to watch again.'
        :'Could not connect to the AI browser. Reconnect for a fresh ticket. The sandbox and gateway must support browser VNC.';
      message(text);notify('disconnected',{message:text});
    });
    client.addEventListener('credentialsrequired',()=>{
      const text='The browser requested unsupported VNC credentials. Check the sandbox browser configuration.';
      showError(text);notify('error',{message:text});client.disconnect();
    });
    client.addEventListener('securityfailure',()=>{
      const text='The AI browser rejected the VNC connection. Reconnect or update the sandbox.';
      showError(text);notify('error',{message:text});
    });
  }catch(_){
    const text='The browser viewer could not start. Reconnect to try again.';
    message(text);notify('error',{message:text});
  }
}
window.SuperchargeBrowser={suspend(){
  ended=true;
  const wasConnected=connected;
  connected=false;
  if(rfb){rfb.viewOnly=true;rfb.focusOnClick=false;rfb.disconnect();}
  if(!wasConnected)notify('suspended');
  message('Browser input disabled. Returning control…');applyMode();return true;
}};
function update(next){
  state=next;lastStateAt=Date.now();
  const generation=Number(next.generation);
  if(currentGeneration!==generation&&rfb)disconnect();
  if(next.busy){disconnect();message(next.phase==='takingControl'?'Stopping the AI before enabling control…':'Returning control to the AI…');}
  else if(!ended&&(next.phase==='watching'||next.phase==='controlling')&&attemptedGeneration!==generation){
    const url=new URL('vnc',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
    url.searchParams.set('generation',String(generation));connect(url.href,generation);
  }
  showError(next.error||'');applyMode();
}
async function poll(){
  if(polling||ended)return;polling=true;
  try{
    const response=await fetch('state',{cache:'no-store'});
    if(!response.ok)throw new Error();
    update(await response.json());
  }catch(_){
    disconnect();message('Connection to the app was lost. Input is disabled. Reopen the viewer from the app.');
  }finally{polling=false;}
}
async function action(action){
  if(actionPending||ended)return;actionPending=true;applyMode();
  if(action!=='takeControl')disconnect();
  try{
    const response=await fetch('action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,notes:notes.value})});
    if(!response.ok)throw new Error();
    update(await response.json());
  }catch(_){
    showError('The app could not complete this action. Check its browser-control screen before trying again.');
  }finally{actionPending=false;applyMode();await poll();}
}
take.addEventListener('click',()=>action('takeControl'));
done.addEventListener('click',()=>action('returnControl'));
retry.addEventListener('click',()=>action('reconnect'));
setInterval(()=>{
  applyMode();
  if(rfb&&state.phase==='controlling'&&!mayControl()){
    rfb.viewOnly=true;message('Control is paused or expired. Input is disabled. Return to the app to continue.');
  }
},200);
window.addEventListener('pagehide',()=>{ended=true;disconnect();});
if(initial.desktop){await poll();setInterval(poll,750);}
else connect(initial.wsUrl,initial.generation);
</script></body></html>''';
}
