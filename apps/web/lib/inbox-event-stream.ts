export function inboxEventStream(
  upstream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  lifetimeMs: number,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => undefined;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  };

  return new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
        void reader.cancel().catch(() => undefined);
      };
      abort = close;
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        close();
        reader.releaseLock();
        return;
      }
      controller.enqueue(new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "ready", id: "ready", ts: Date.now() })}\n\n`,
      ));
      timer = setTimeout(close, Math.max(0, lifetimeMs));
      void (async () => {
        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (closed) break;
            if (done) {
              close();
              break;
            }
            controller.enqueue(value);
          }
        } catch (error) {
          if (!closed) {
            closed = true;
            cleanup();
            controller.error(error);
          }
        } finally {
          reader.releaseLock();
        }
      })();
    },
    cancel(reason) {
      closed = true;
      cleanup();
      return reader.cancel(reason);
    },
  });
}
