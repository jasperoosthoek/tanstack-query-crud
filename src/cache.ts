import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Cache manipulation primitives. All take a `queryClient` explicitly
 * since the library doesn't own one.
 *
 * For an ergonomic React form that binds queryClient from context,
 * use `useResourceUtils(resource)`.
 */

// -- Detail cache -------------------------------------------------

export function getDetailCache<T>(
  queryClient: QueryClient,
  resourceName: string,
  id: string | number,
): T | undefined {
  return queryClient.getQueryData<T>([resourceName, 'detail', id]);
}

export function setDetailCache<T>(
  queryClient: QueryClient,
  resourceName: string,
  id: string | number,
  item: T,
): void {
  queryClient.setQueryData<T>([resourceName, 'detail', id], item);
}

export function removeDetailCache(
  queryClient: QueryClient,
  resourceName: string,
  id: string | number,
): void {
  queryClient.removeQueries({ queryKey: [resourceName, 'detail', id] });
}

// -- List cache ---------------------------------------------------
// These helpers target the common case of non-paginated resources
// (cache holds T[] directly). For paginated resources the cache
// holds the raw response shape - use `queryClient.getQueryData` /
// `setQueryData` directly with the key ['name', 'list', params], or
// invalidate via `invalidateList`.

export function getListCache<T>(
  queryClient: QueryClient,
  resourceName: string,
  params?: Record<string, any>,
): T[] | undefined {
  const key: QueryKey = params !== undefined
    ? [resourceName, 'list', params]
    : [resourceName, 'list', {}];
  return queryClient.getQueryData<T[]>(key);
}

export function setListCache<T>(
  queryClient: QueryClient,
  resourceName: string,
  data: T[],
  params?: Record<string, any>,
): void {
  const key: QueryKey = params !== undefined
    ? [resourceName, 'list', params]
    : [resourceName, 'list', {}];
  queryClient.setQueryData<T[]>(key, data);
}

/**
 * Apply a functional update to every list cache variant for this resource
 * (regardless of params/filters).
 *
 * Only operates on cache entries where the value is an array (non-paginated
 * resources). Paginated caches hold complex shapes and are skipped; users
 * of paginated resources should use `invalidateList` instead.
 */
export function updateAllLists<T>(
  queryClient: QueryClient,
  resourceName: string,
  updater: (list: T[]) => T[],
): void {
  const entries = queryClient.getQueriesData({ queryKey: [resourceName, 'list'] });
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      queryClient.setQueryData(key, updater(value as T[]));
    }
    // Non-array (paginated) caches are skipped; user should invalidate.
  }
}

/**
 * Apply a functional update to every detail cache entry for this resource.
 */
export function updateAllDetails<T>(
  queryClient: QueryClient,
  resourceName: string,
  updater: (item: T) => T,
): void {
  const entries = queryClient.getQueriesData<T>({ queryKey: [resourceName, 'detail'] });
  for (const [key, value] of entries) {
    if (value !== undefined) {
      queryClient.setQueryData<T>(key, updater(value));
    }
  }
}

// -- Invalidation --------------------------------------------------

export function invalidate(
  queryClient: QueryClient,
  resourceName: string,
): void {
  queryClient.invalidateQueries({ queryKey: [resourceName] });
}

export function invalidateList(
  queryClient: QueryClient,
  resourceName: string,
): void {
  queryClient.invalidateQueries({ queryKey: [resourceName, 'list'] });
}

export function invalidateDetail(
  queryClient: QueryClient,
  resourceName: string,
  id?: string | number,
): void {
  const key: QueryKey = id != null
    ? [resourceName, 'detail', id]
    : [resourceName, 'detail'];
  queryClient.invalidateQueries({ queryKey: key });
}
