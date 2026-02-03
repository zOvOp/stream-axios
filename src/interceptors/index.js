/**
 * Setup request interceptor
 * @param {import('axios').AxiosInstance} instance
 */
export const setupRequestInterceptor = (instance) => {
  instance.interceptors.request.use(
    (config) => {
      // Add custom headers if needed
      // config.headers["test"] = "testHEADER";
      return config;
    },
    (error) => {
      console.error("Request error:", error);
      return Promise.reject(error);
    },
  );
};

/**
 * Setup response interceptor
 * @param {import('axios').AxiosInstance} instance
 */
export const setupResponseInterceptor = (instance) => {
  instance.interceptors.response.use(
    (response) => {
      // If stream request, return response directly
      if (response.config.isStream) {
        return response;
      }

      // Normal response handling
      return response.data;
    },
    (error) => {
      console.error("Response error:", error);
      return Promise.reject(error);
    },
  );
};

export const setupInterceptors = (instance) => {
  setupRequestInterceptor(instance);
  setupResponseInterceptor(instance);
};
