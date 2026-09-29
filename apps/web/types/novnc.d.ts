declare module "@novnc/novnc" {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>);
    scaleViewport: boolean;
    resizeSession: boolean;
    qualityLevel: number;
    compressionLevel: number;
    viewOnly: boolean;
    focusOnClick: boolean;
    sendKey(keysym: number, code?: string, down?: boolean): void;
    addEventListener(type: string, listener: () => void): void;
    disconnect(): void;
  }
}
