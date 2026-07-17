import type { AxiosInstance } from 'axios';
import type { Caller, CallerConfig } from '../types';

/**
 * Wraps an AxiosInstance as a Caller.
 * Called internally when the user provides `axios` in the resource config.
 * Also exported for users who want to configure the caller explicitly.
 */
export function createAxiosCaller(axios: AxiosInstance): Caller {
  return async (config: CallerConfig) => {
    const response = await axios({
      method: config.method,
      url: config.url,
      headers: config.headers,
      params: config.params,
      data: config.data,
      signal: config.signal,
    });
    return { data: response.data };
  };
}
