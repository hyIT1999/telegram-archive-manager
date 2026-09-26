import { expect, vi } from 'vitest';

/** One message of a server-sent events stream. */
export interface SseMessage {
  data?: unknown;
  comment?: string;
  retry?: number;
  id?: string;
  event?: string;
}

export interface EventStream {
  /** Every message so far, in order. */
  readonly messages: readonly SseMessage[];
  /** Waits for a message (received before or after the call) that `match` accepts. */
  next(match: (message: SseMessage) => boolean, timeoutMs?: number): Promise<SseMessage>;
  /** Resolves when the server ends the stream. */
  readonly ended: Promise<void>;
  close(): void;
}

/** A message whose JSON data has this `type` (and, optionally, more). */
export function eventOf(
  type: string,
  more: (data: Record<string, unknown>) => boolean = () => true,
) {
  return (message: SseMessage): boolean => {
    const data = message.data as Record<string, unknown> | undefined;
    return data?.type === type && more(data);
  };
}

/**
 * Opens `url` like a browser's EventSource and reads it as it comes (supertest would wait for
 * the end of the response, which a stream never reaches). A refused request (401…) resolves with
 * its status and JSON body instead.
 */
export async function openEventStream(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body?: unknown; stream?: EventStream }> {
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream', ...headers },
    signal: abort.signal,
  });
  if (response.status !== 200 || !response.body) {
    return { status: response.status, body: await response.json().catch(() => undefined) };
  }
  expect(response.headers.get('content-type')).toBe('text/event-stream');

  const messages: SseMessage[] = [];
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const ended = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        buffer += value;
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const message = parseBlock(block);
          if (message) {
            messages.push(message);
          }
          end = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Closed by the test (abort) or by the server going away.
    }
  })();

  return {
    status: 200,
    stream: {
      messages,
      ended,
      close: () => abort.abort(),
      async next(match, timeoutMs = 5_000) {
        return vi.waitFor(
          () => {
            const found = messages.find(match);
            if (!found) {
              throw new Error(`No matching event yet (received: ${JSON.stringify(messages)})`);
            }
            return found;
          },
          { timeout: timeoutMs, interval: 20 },
        );
      },
    },
  };
}

function parseBlock(block: string): SseMessage | null {
  const message: SseMessage = {};
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '') {
      continue;
    }
    if (line.startsWith(':')) {
      message.comment = line.slice(1).trim();
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') {
      data.push(value);
    } else if (field === 'retry') {
      message.retry = Number(value);
    } else if (field === 'id') {
      message.id = value;
    } else if (field === 'event') {
      message.event = value;
    }
  }
  if (data.length > 0) {
    const text = data.join('\n');
    try {
      message.data = JSON.parse(text);
    } catch {
      message.data = text;
    }
  }
  return Object.keys(message).length > 0 ? message : null;
}
