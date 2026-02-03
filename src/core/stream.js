/**
 * Parse a single SSE event block
 * @param {string} eventBlock - A single SSE event (lines separated by \n)
 * @returns {{ event?: string, data?: string, id?: string, retry?: number } | null}
 */
function parseSSEEvent(eventBlock) {
  const lines = eventBlock.split("\n");
  const result = {};
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("data:")) {
      // Support both "data: content" and "data:content"
      const content = line.slice(5);
      dataLines.push(content.startsWith(" ") ? content.slice(1) : content);
    } else if (line.startsWith("event:")) {
      result.event = line.slice(6).trim();
    } else if (line.startsWith("id:")) {
      result.id = line.slice(3).trim();
    } else if (line.startsWith("retry:")) {
      const retry = parseInt(line.slice(6).trim(), 10);
      if (!isNaN(retry)) result.retry = retry;
    }
    // Ignore comments (lines starting with :) and unknown fields
  }

  // Join multiple data lines with newline (per SSE spec)
  if (dataLines.length > 0) {
    result.data = dataLines.join("\n");
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parse SSE data chunk (simple, stateless version)
 * @param {string} sseText - Raw SSE text chunk
 * @param {Function} onMessage - Callback receiving data content string
 */
export function parseSSEChunk(sseText, onMessage) {
  const events = sseText.split("\n\n").filter(Boolean);
  for (const eventBlock of events) {
    const parsed = parseSSEEvent(eventBlock);
    if (parsed?.data) {
      onMessage(parsed.data);
    }
  }
}

/**
 * Create a stateful SSE parser with buffer for handling chunks that may be split
 * @param {Function} onMessage - Callback receiving parsed SSE event object { event?, data?, id?, retry? }
 * @returns {Function} Parser function that accepts raw chunk string
 */
export function createSSEParser(onMessage) {
  let buffer = "";

  return (chunk) => {
    buffer += chunk;
    // Split by double newline (SSE event separator)
    const parts = buffer.split("\n\n");
    // Keep the last incomplete part in buffer
    buffer = parts.pop() || "";

    for (const eventBlock of parts) {
      if (!eventBlock.trim()) continue;
      const parsed = parseSSEEvent(eventBlock);
      if (parsed) {
        onMessage(parsed);
      }
    }
  };
}

/**
 * Create a stream request function bound to an axios instance
 * @param {import('axios').AxiosInstance} instance
 */
export const createStreamRequest = (instance) => {
  return async (options = {}, onChunk, onComplete, onError) => {
    const controller = new AbortController();
    let reader = null;
    let externalSignalHandler = null;

    // Handle external signal
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        externalSignalHandler = () => controller.abort();
        options.signal.addEventListener("abort", externalSignalHandler);
      }
    }

    const cleanup = () => {
      if (options.signal && externalSignalHandler) {
        options.signal.removeEventListener("abort", externalSignalHandler);
        externalSignalHandler = null;
      }
    };

    const cancelRequest = () => {
      try {
        cleanup();
        controller.abort();
        reader?.releaseLock();
        if (onError) onError("Stream request cancelled manually");
      } catch (err) {
        console.error("Failed to cancel stream request:", err);
      }
    };

    try {
      const response = await instance({
        ...options,
        isStream: true,
        // Force critical config for streaming
        adapter: "fetch",
        responseType: "stream",
        timeout: 0,
        signal: controller.signal,
      });

      // Handle both standard axios response and unwrapped response (by user interceptors)
      // If user's interceptor returned response.data, 'response' itself might be the stream
      const readableStream =
        response.data ||
        response.body ||
        (response.getReader ? response : null);

      if (!readableStream || typeof readableStream.getReader !== "function") {
        throw new Error(
          "Browser does not support stream response, API did not return stream, or response was transformed incorrectly",
        );
      }

      const decoder = new TextDecoder("utf-8");
      reader = readableStream.getReader();

      const readStreamChunk = async () => {
        try {
          const { done, value } = await reader.read();
          if (done) {
            cleanup();
            if (onComplete) onComplete();
            return;
          }
          const chunk = decoder.decode(value, { stream: true });

          if (onChunk) onChunk(chunk);
          await readStreamChunk();
        } catch (err) {
          cleanup();
          if (err.name === "AbortError") return;
          if (onError) onError(`Read stream failed: ${err.message}`);
        }
      };

      readStreamChunk();
    } catch (err) {
      if (err.name === "CanceledError" || err.code === "ERR_CANCELED") {
        // Handle axios cancellation if needed
        return cancelRequest;
      }
      const errorMsg = err.message || "Stream request failed";
      if (onError) onError(errorMsg);
      console.error("Stream request failed:", errorMsg);
    }

    return cancelRequest;
  };
};
