import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getDetailCache,
  getListCache,
  invalidate,
  invalidateDetail,
  invalidateList,
  removeDetailCache,
  setDetailCache,
  setListCache,
  updateAllDetails,
  updateAllLists,
} from './cache';
import type { ResourceRef } from './types';

export type ResourceUtils<T> = {
  // Detail cache
  getDetailCache: (id: string | number) => T | undefined;
  setDetailCache: (id: string | number, item: T) => void;
  removeDetailCache: (id: string | number) => void;
  updateAllDetails: (updater: (item: T) => T) => void;

  // List cache (for non-paginated resources; paginated users should
  // access the raw cache via queryClient directly).
  getListCache: (params?: Record<string, any>) => T[] | undefined;
  setListCache: (data: T[], params?: Record<string, any>) => void;
  updateAllLists: (updater: (list: T[]) => T[]) => void;

  // Invalidation
  invalidate: () => void;
  invalidateList: () => void;
  invalidateDetail: (id?: string | number) => void;
};

/**
 * React hook that binds cache manipulation methods to the resource's
 * queryClient from context. For non-React contexts (WebSocket handlers,
 * module-scope code), import the standalone functions from '.' and pass
 * queryClient explicitly.
 */
export function useResourceUtils<T>(resource: ResourceRef): ResourceUtils<T> {
  const queryClient = useQueryClient();
  const name = resource.name;

  return useMemo<ResourceUtils<T>>(() => ({
    getDetailCache: (id) => getDetailCache<T>(queryClient, name, id),
    setDetailCache: (id, item) => setDetailCache<T>(queryClient, name, id, item),
    removeDetailCache: (id) => removeDetailCache(queryClient, name, id),
    updateAllDetails: (updater) => updateAllDetails<T>(queryClient, name, updater),

    getListCache: (params) => getListCache<T>(queryClient, name, params),
    setListCache: (data, params) => setListCache<T>(queryClient, name, data, params),
    updateAllLists: (updater) => updateAllLists<T>(queryClient, name, updater),

    invalidate: () => invalidate(queryClient, name),
    invalidateList: () => invalidateList(queryClient, name),
    invalidateDetail: (id) => invalidateDetail(queryClient, name, id),
  }), [queryClient, name]);
}
