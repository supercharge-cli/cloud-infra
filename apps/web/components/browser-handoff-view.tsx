"use client";

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard, RefreshCw } from 'lucide-react';

type Props = {
  wsUrl: string;
  expiresAt: number;
  paused?: boolean;
  onDisconnected?: () => void;
  onReturn: () => void;
  onReconnect: () => void;
};

type VncClient = {
  disconnect: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  scaleViewport: boolean;
  resizeSession: boolean;
  qualityLevel: number;
  compressionLevel: number;
  viewOnly: boolean;
  focusOnClick: boolean;
  sendKey: (keysym: number, code?: string, down?: boolean) => void;
};

export function BrowserHandoffView({ wsUrl, expiresAt, paused = false, onDisconnected, onReturn, onReconnect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const client = useRef<VncClient | null>(null);
  const permission = useRef({ paused, expiresAt });
  const composing = useRef(false);
  const previous = useRef('');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('Connecting…');
  const [error, setError] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [shift, setShift] = useState(false);
  const notifyDisconnected = useEffectEvent(() => onDisconnected?.());
  const mayControl = () => !permission.current.paused && permission.current.expiresAt > Date.now() && !document.hidden;

  useEffect(() => {
    permission.current = { paused, expiresAt };
    const interactive = !paused && expiresAt > Date.now();
    if (client.current) {
      client.current.viewOnly = !interactive;
      client.current.focusOnClick = interactive && !keyboardOpen;
    }
    if (!interactive) { setKeyboardOpen(false); input.current?.blur(); }
  }, [paused, expiresAt, keyboardOpen]);

  useEffect(() => {
    let disposed = false;
    let rfb: VncClient | undefined;
    setConnected(false); setStatus('Connecting…'); setError('');
    void import('@novnc/novnc').then(({ default: RFB }) => {
      if (disposed || !host.current) return;
      rfb = new RFB(host.current, wsUrl, { shared: true, credentials: {} });
      client.current = rfb;
      rfb.qualityLevel = 9; rfb.compressionLevel = 0;
      rfb.scaleViewport = true; rfb.resizeSession = false;
      rfb.viewOnly = !mayControl(); rfb.focusOnClick = !rfb.viewOnly;
      rfb.addEventListener('connect', () => {
        if (!disposed) { setConnected(true); setStatus('You have control'); setError(''); }
      });
      rfb.addEventListener('disconnect', () => {
        if (!disposed) { setConnected(false); setStatus('Disconnected'); setError('Reconnect or return control.'); notifyDisconnected(); }
      });
    }).catch(() => { if (!disposed) setError('Unable to load desktop control. Return to viewing and retry.'); });
    const policy = setInterval(() => {
      if (!rfb) return;
      const interactive = mayControl();
      rfb.viewOnly = !interactive;
      if (!interactive) { rfb.focusOnClick = false; input.current?.blur(); setKeyboardOpen(false); setStatus(permission.current.expiresAt <= Date.now() ? 'Control expired' : 'Input paused'); }
    }, 200);
    return () => {
      disposed = true; clearInterval(policy);
      if (rfb) { rfb.viewOnly = true; rfb.focusOnClick = false; rfb.disconnect(); }
      client.current = null;
    };
  }, [wsUrl]);

  function key(keysym: number, code?: string) {
    if (connected && mayControl()) client.current?.sendKey(keysym, code);
  }
  function sendText(value: string) {
    for (const char of value) {
      const point = char.codePointAt(0)!;
      key(char === '\n' ? 0xff0d : char === '\t' ? 0xff09 : point <= 255 ? point : 0x01000000 + point);
    }
  }
  function resetInput() {
    if (!input.current) return;
    input.current.value = ' '.repeat(64); previous.current = input.current.value;
    input.current.setSelectionRange(input.current.value.length, input.current.value.length);
  }
  function editInput() {
    if (!input.current || composing.current) return;
    if (!mayControl()) { resetInput(); return; }
    const next = Array.from(input.current.value), old = Array.from(previous.current);
    let same = 0; while (same < next.length && same < old.length && next[same] === old[same]) same++;
    for (let i = same; i < old.length; i++) key(0xff08, 'Backspace');
    sendText(next.slice(same).join('')); resetInput();
  }
  function toggleKeyboard() {
    if (keyboardOpen) { setKeyboardOpen(false); input.current?.blur(); return; }
    if (!connected || !mayControl()) return;
    setKeyboardOpen(true);
    if (matchMedia('(pointer:coarse)').matches) { resetInput(); input.current?.focus({ preventScroll: true }); }
  }

  return <div className="browser-control-view">
    <div ref={host} className="browser-control-canvas" />
    <textarea ref={input} className="browser-keyboard-input" aria-label="Remote keyboard input" tabIndex={-1} autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; editInput(); }} onInput={editInput}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        const keys: Record<string, number> = { Enter: 0xff0d, Tab: 0xff09, Escape: 0xff1b, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54 };
        if (keys[event.key]) { event.preventDefault(); key(keys[event.key], event.key); resetInput(); }
      }} onKeyUp={(event) => event.stopPropagation()} onBlur={() => { if (matchMedia('(pointer:coarse)').matches) setKeyboardOpen(false); }} />
    {keyboardOpen && <div className="browser-keyboard-tray" aria-label="On-screen keyboard">
      {['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row) => <div key={row}>{[...row].map((char) => <button type="button" key={char} onMouseDown={(e) => e.preventDefault()} onClick={() => sendText(shift ? char.toUpperCase() : char)}>{shift ? char.toUpperCase() : char}</button>)}</div>)}
      <div><button type="button" onClick={() => key(0xff1b, 'Escape')}>Esc</button><button type="button" onClick={() => key(0xff09, 'Tab')}>Tab</button><button type="button" aria-pressed={shift} onClick={() => setShift(!shift)}>Shift</button><button type="button" className="space" onClick={() => key(32, 'Space')}>Space</button><button type="button" aria-label="Backspace" onClick={() => key(0xff08, 'Backspace')}>⌫</button><button type="button" onClick={() => key(0xff0d, 'Enter')}>Enter</button></div>
    </div>}
    {error && <div className="browser-control-error" role="alert">{error}</div>}
    <footer className="browser-control-bar">
      <span role="status">{paused ? 'Input paused' : status}</span>
      <button type="button" className="icon" title={keyboardOpen ? 'Hide keyboard' : 'Open keyboard'} aria-label={keyboardOpen ? 'Hide keyboard' : 'Open keyboard'} aria-pressed={keyboardOpen} disabled={!connected || paused} onClick={toggleKeyboard}><Keyboard size={19} /></button>
      <button type="button" className="icon" title="Reconnect" aria-label="Reconnect desktop" disabled={paused} onClick={onReconnect}><RefreshCw size={18} /></button>
      <button type="button" onClick={onReturn} disabled={paused}>Return control</button>
    </footer>
  </div>;
}
