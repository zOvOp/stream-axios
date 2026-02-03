import { createInstance } from "./core/axiosInstance.js";
import { parseSSEChunk, createStreamRequest } from "./core/stream.js";

// Create a default instance
const service = createInstance();

/**
 * Attach stream method to an existing axios instance
 * @param {import('axios').AxiosInstance} instance
 * @returns {import('axios').AxiosInstance}
 */
export const attachStream = (instance) => {
  instance.stream = createStreamRequest(instance);
  return instance;
};

export { createInstance, parseSSEChunk, createStreamRequest };
export default service;
