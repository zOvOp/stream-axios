/**
 * Parse SSE data chunk
 * @param {string} sseText
 * @param {Function} onMessage
 */
export function parseSSEChunk(sseText, onMessage) {
  const sseLines = sseText.split("\n\n").filter(Boolean);
  for (const line of sseLines) {
    const dataPrefix = "data: ";
    if (line.startsWith(dataPrefix)) {
      const validContent = line.slice(dataPrefix.length).trim();
      if (validContent) {
        onMessage(validContent);
      }
    }
  }
}

/**
 * Create a stream request function bound to an axios instance
 * @param {import('axios').AxiosInstance} instance
 */
export const createStreamRequest = (instance) => {
  return async (options = {}, onChunk, onComplete, onError) => {
    const controller = new AbortController();
    let reader = null;

    const cancelRequest = () => {
      try {
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
            if (onComplete) onComplete();
            return;
          }
          const chunk = decoder.decode(value, { stream: true });

          if (onChunk) onChunk(chunk);
          await readStreamChunk();
        } catch (err) {
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
