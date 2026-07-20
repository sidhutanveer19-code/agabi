/**
 * NDJSON stream reader — turns a chunked-fetch Response body into an async
 * iterable of parsed JSON objects (one per line). Buffers partial lines across
 * chunks, stops on abort, and always releases the reader.
 */
export async function* ndjsonStream(res: Response, signal?: AbortSignal): AsyncGenerator<unknown> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          try {
            yield JSON.parse(line);
          } catch {
            /* skip a malformed line rather than kill the stream */
          }
        }
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try {
        yield JSON.parse(tail);
      } catch {
        /* ignore trailing junk */
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}
