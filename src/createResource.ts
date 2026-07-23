import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type MutationFunctionContext,
  type QueryClient,
  type UseQueryResult,
  type UseMutationResult,
  type QueryKey,
} from '@tanstack/react-query';
import { createAxiosCaller } from './adapters/axios';
import {
  invalidate,
  invalidateDetail,
  invalidateList,
  removeDetailCache,
  setDetailCache,
  updateAllLists,
} from './cache';
import { runInvalidation } from './invalidation';
import type {
  Caller,
  CreateConfig,
  CustomActionConfig,
  DeleteConfig,
  GetListConfig,
  InferActionData,
  InvalidatesConfig,
  InvalidationTarget,
  MutationCallbacks,
  MutationPrepare,
  Pagination,
  PaginationConfig,
  QueryCallbacks,
  QueryTQOptions,
  ResourceConfig,
  ResourceOnError,
  UpdateConfig,
} from './types';

// Internal generic-erased versions of the exported callback/prepare
// shapes. `any` in the generic slots is deliberate: the user's typed
// config (e.g. MutationCallbacks<T, Partial<T>>) needs to be assignable
// here, which requires bivariance on the callback parameter positions.
type ErasedMutationCallbacks = MutationCallbacks<any, any, any>;
type ErasedMutationPrepare   = MutationPrepare<any>;

// -- Hook signature types ------------------------------------------

// find: lookup by the resource's configured id field, or by predicate -
// bound to a specific useList() call's own data via closure (see useList
// below), not to the static resource. That means: no extra useQuery
// subscription (reuses the .data the caller already fetched), and it's
// correct in the presence of multiple simultaneous cache entries for the
// same resource (e.g. useList() vs useList({ status: 'open' }) - each
// call's find only ever searches its own list, never a sibling filter's).
// It's a plain function by the time you have it, not a hook itself, so
// it's safe to call from non-component contexts like a DataTable column's
// `selector` callback where hooks aren't legal.
export type FindHelper<T> = {
  (id: string | number): T | undefined;
  (predicate: (item: T, index: number, list: T[]) => boolean): T | undefined;
};

// useList's shape depends on whether pagination is configured.
export type PaginatedListResult<T> = Omit<UseQueryResult<T[], Error>, 'data'> & {
  data: T[] | undefined;
  pagination: Pagination | undefined;
  find: FindHelper<T>;
};

export type ListResult<T> = UseQueryResult<T[], Error> & { find: FindHelper<T> };

// Filter type inference: the parameter type of getList.prepareParams
// is the source of truth. Falls back to Record<string, any> without one.
type ListFilters<C> = C extends {
  actions: { getList: { prepareParams: (filters: infer F) => any } };
}
  ? F
  : Record<string, any>;

// When pagination is on, users can also pass offset/limit as part of
// useList's argument object (call site merges filters + pagination).
type ListParams<C> = HasPagination<C> extends true
  ? ListFilters<C> & { offset?: number; limit?: number }
  : ListFilters<C>;

type ListHook<T, C> = HasPagination<C> extends true
  ? (params?: ListParams<C>, tqOptions?: QueryTQOptions<T[]>) => PaginatedListResult<T>
  : (params?: ListParams<C>, tqOptions?: QueryTQOptions<T[]>) => ListResult<T>;

type GetHook<T>      = (id: string | number, tqOptions?: QueryTQOptions<T>) => UseQueryResult<T, Error>;
type SingleHook<T>   = (tqOptions?: QueryTQOptions<T>) => UseQueryResult<T, Error>;
type CreateHook<T>   = () => UseMutationResult<T, Error, Partial<T>>;
type UpdateHook<T>   = () => UseMutationResult<T, Error, Partial<T>>;
type DeleteHook<T>   = () => UseMutationResult<void, Error, Partial<T>>;

type CustomActionHook<T, A> = () => UseMutationResult<T, Error, InferActionData<A>>;

// -- SSR helper types ---------------------------------------------
// Query options shape returned by *Options helpers - compatible with
// TQ's useQuery, useSuspenseQuery, queryClient.prefetchQuery, and
// queryClient.fetchQuery. `unknown` is used for the raw response cache
// value; select transforms it to T[] where applicable.

export type ListQueryOptions<T> = {
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<unknown>;
  select?: (raw: unknown) => T[];
};

export type DetailQueryOptions<T> = {
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
  enabled?: boolean;
};

export type SingleQueryOptions<T> = {
  queryKey: QueryKey;
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
};

type ListOptionsHelper<T>   = (params?: Record<string, any>) => ListQueryOptions<T>;
type DetailOptionsHelper<T> = (id: string | number) => DetailQueryOptions<T>;
type SingleOptionsHelper<T> = () => SingleQueryOptions<T>;

type PrefetchListHelper<T>   = (queryClient: QueryClient, params?: Record<string, any>) => Promise<void>;
type PrefetchGetHelper<T>    = (queryClient: QueryClient, id: string | number) => Promise<void>;
type PrefetchSingleHelper<T> = (queryClient: QueryClient) => Promise<void>;

type FetchListHelper<T>   = (queryClient: QueryClient, params?: Record<string, any>) => Promise<T[]>;
type FetchGetHelper<T>    = (queryClient: QueryClient, id: string | number) => Promise<T>;
type FetchSingleHelper<T> = (queryClient: QueryClient) => Promise<T>;

// -- usePaginatedList options and result ---------------------------

export type UsePaginatedListOptions = {
  initialOffset?: number;
  initialLimit?: number;
  /**
   * External filter object. When it changes (deep-equal), offset resets to 0.
   * Users should memoize this to avoid unnecessary resets on every render.
   */
  filters?: Record<string, any>;
};

export type UsePaginatedListResult<T> = Omit<UseQueryResult<T[], Error>, 'data'> & {
  data: T[] | undefined;
  pagination: Pagination;
  find: FindHelper<T>;
  offset: number;
  limit: number;
  next: () => void;
  prev: () => void;
  goto: (page: number) => void;
  setOffset: (offset: number) => void;
  setLimit: (limit: number) => void;
  hasNext: boolean;
  hasPrev: boolean;
};

type PaginatedListHook<T> = (options?: UsePaginatedListOptions) => UsePaginatedListResult<T>;

// -- Custom action hooks - mapped type -----------------------------

type CustomActionHooks<T, C> = C extends { customActions: infer CA }
  ? {
      [K in keyof CA & string as `use${Capitalize<K>}`]:
        CA[K] extends CustomActionConfig<any> ? CustomActionHook<T, CA[K]> : never;
    }
  : {};

// -- Detect if getList has pagination configured -------------------

type HasPagination<C> = C extends { actions: { getList: { pagination: object } } }
  ? true
  : false;

// -- Return-type morphing based on config --------------------------

// SSR helpers are attached only when `ssr: true` is set on the config.

type SSREnabled<C> = C extends { ssr: true } ? true : false;

export type Resource<T, C extends ResourceConfig<T>> = {
  name: C['name'];
  useInvalidate: () => () => void;
}
& (C['actions'] extends { getList: true | object }
    ? { useInvalidateList: () => () => void }
    : {})
& (C['actions'] extends { get: true | object }
    ? { useInvalidateDetail: () => (id?: string | number) => void }
    : {})
& (C['actions'] extends { getList: true | object }
    ? { useList: ListHook<T, C> }
      & (SSREnabled<C> extends true
          ? {
              listOptions: ListOptionsHelper<T>;
              prefetchList: PrefetchListHelper<T>;
              fetchList: FetchListHelper<T>;
            }
          : {})
    : {})
& (C['actions'] extends { getList: { pagination: object } }
    ? { usePaginatedList: PaginatedListHook<T> }
    : {})
& (C['actions'] extends { get: true | object }
    ? { useGet: GetHook<T> }
      & (SSREnabled<C> extends true
          ? {
              detailOptions: DetailOptionsHelper<T>;
              prefetchGet: PrefetchGetHelper<T>;
              fetchGet: FetchGetHelper<T>;
            }
          : {})
    : {})
& (C['actions'] extends { getSingle: true | object }
    ? { useSingle: SingleHook<T> }
      & (SSREnabled<C> extends true
          ? {
              singleOptions: SingleOptionsHelper<T>;
              prefetchSingle: PrefetchSingleHelper<T>;
              fetchSingle: FetchSingleHelper<T>;
            }
          : {})
    : {})
& (C['actions'] extends { create:    true | object } ? { useCreate: CreateHook<T> } : {})
& (C['actions'] extends { update:    true | object } ? { useUpdate: UpdateHook<T> } : {})
& (C['actions'] extends { delete:    true | object } ? { useDelete: DeleteHook<T> } : {})
& CustomActionHooks<T, C>;

// -- Helpers -------------------------------------------------------

function getInvalidates(actionConfig: true | { invalidates?: InvalidatesConfig } | undefined): InvalidatesConfig | undefined {
  if (actionConfig === true || actionConfig === undefined) return undefined;
  return actionConfig.invalidates;
}

/**
 * Determine if the user's `invalidates` config wants same-resource invalidation
 * (as opposed to just cross-resource extras). If yes, skip response-driven
 * updates for the same resource.
 *
 * Rules:
 * - undefined: use response-driven (default in v0.6+)
 * - 'all': explicit invalidation, skip response-driven
 * - Array containing any string ('list', 'detail', 'single', 'all'): skip response-driven
 * - Array with only cross-resource targets (ResourceRef or [ResourceRef, string]): keep response-driven
 * - Empty array []: skip response-driven (user opted out of everything)
 */
function shouldSkipResponseDriven(invalidates: InvalidatesConfig | undefined): boolean {
  if (invalidates === undefined) return false;  // default: use response-driven
  if (invalidates === 'all') return true;
  if (invalidates.length === 0) return true;  // opted out
  // If any target is a string, user wants invalidation for same resource
  return invalidates.some((t) => typeof t === 'string');
}

/**
 * Extract just the cross-resource targets from an invalidates config,
 * ignoring same-resource strings. Used when response-driven is active
 * and we still want to fire cross-resource invalidations.
 */
function crossResourceOnly(invalidates: InvalidatesConfig | undefined): InvalidationTarget[] {
  if (!invalidates || invalidates === 'all' || invalidates.length === 0) return [];
  return invalidates.filter((t) => typeof t !== 'string') as InvalidationTarget[];
}

function getListPagination(actionConfig: boolean | GetListConfig<unknown> | undefined): PaginationConfig | undefined {
  if (!actionConfig || actionConfig === true) return undefined;
  return actionConfig.pagination;
}

// -- Callback extraction helpers -----------------------------------
// Action configs can be `true`, an object with callbacks, or undefined.
// These helpers normalize to a plain callbacks object with no `true`
// branch to worry about at the call site.

// Narrow an action config (which may be `true` for the "just enable
// this action" case, or `undefined`, or the object config) to the
// object case, defaulting to `{}` for the sugar cases.
function narrowActionConfig<T extends object>(actionConfig: true | T | undefined): T {
  return actionConfig === true || actionConfig == null ? ({} as T) : actionConfig;
}

// -- Library-owned action-config field names -----------------------
// Everything NOT in these sets flows through as an action-level TQ option.

const LIBRARY_QUERY_FIELDS = new Set<string>([
  'pagination', 'prepareParams', 'onError',
]);

const LIBRARY_MUTATION_FIELDS = new Set<string>([
  'invalidates', 'prepare', 'prepareParams',
  'onMutate', 'onSuccess', 'onError', 'onSettled',
]);

const LIBRARY_CUSTOM_ACTION_FIELDS = new Set<string>([
  'path', 'method',
  ...Array.from(LIBRARY_MUTATION_FIELDS),
]);

function extractTQOptions(
  actionConfig: true | Record<string, unknown> | undefined,
  libraryFields: Set<string>,
): Record<string, unknown> {
  if (actionConfig === true || actionConfig == null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actionConfig)) {
    if (!libraryFields.has(k)) out[k] = v;
  }
  return out;
}

// Fire library's error handler chain: resource-level, then action-level.
// Per-call onError fires alongside via TQ's native mutation handling.
function fireMutationErrorHandlers(
  resourceOnError: ResourceOnError | undefined,
  actionOnError: ErasedMutationCallbacks['onError'],
  actionName: string,
  error: Error,
  variables: unknown,
  onMutateResult: unknown,
  mutationContext: MutationFunctionContext,
): void | Promise<void> {
  resourceOnError?.(error, { action: actionName, variables });
  return actionOnError?.(error, variables, onMutateResult, mutationContext);
}

// Effect that fires the action-level query onError callback once per
// distinct error. Deduped via ref on error identity.
function useQueryOnErrorEffect(
  error: Error | null,
  onError: ((error: Error) => void) | undefined,
): void {
  const lastErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      onError?.(error);
    } else if (!error) {
      lastErrorRef.current = null;
    }
  }, [error, onError]);
}

/**
 * Extract the id value from an entity or partial entity.
 *
 * Pattern borrowed from ZCR (`createStoreRegistry.ts`): cast to
 * `Record<string, unknown>` (safer than `any` - only allows string-keyed
 * access and returns `unknown`), then normalize primitive results.
 *
 * Field name is configurable via `id: 'fieldName'` on the resource
 * config; defaults to `'id'`.
 */
function makeExtractId(idField: string) {
  return function extractId(item: unknown): string | number | undefined {
    if (item == null || typeof item !== 'object') return undefined;
    const v = (item as Record<string, unknown>)[idField];
    if (v == null) return undefined;
    if (typeof v === 'string' || typeof v === 'number') return v;
    // Non-primitive ids (bigint, boolean, object) get coerced to string,
    // matching ZCR's `String(...)` normalization pattern.
    return String(v);
  };
}

// Merge pagination defaults into params. Returns the effective params
// used both for the query key AND passed to prepareParams.
function withPaginationDefaults(
  params: Record<string, any> | undefined,
  pagConfig: PaginationConfig | undefined,
): Record<string, any> {
  if (!pagConfig) return params ?? {};
  return {
    offset: 0,
    limit: pagConfig.defaultLimit,
    ...params,
  };
}

// Build the actual axios params from effective params, running the
// filter prepareParams on the filter portion and pagination's
// prepareParams on offset/limit.
function buildWireParams(
  effectiveParams: Record<string, any>,
  pagConfig: PaginationConfig | undefined,
  filterPrepareParams: ((filters: any) => Record<string, any> | undefined) | undefined,
): Record<string, any> {
  if (!pagConfig) {
    return filterPrepareParams ? filterPrepareParams(effectiveParams) ?? {} : effectiveParams;
  }
  const { offset, limit, ...rest } = effectiveParams;
  const filterWire = filterPrepareParams ? filterPrepareParams(rest) ?? {} : rest;
  const paginationWire = pagConfig.prepareParams
    ? pagConfig.prepareParams({ offset, limit })
    : { offset, limit };
  return { ...filterWire, ...paginationWire };
}

// -- Factory -------------------------------------------------------

export const createResource = <T>() => <const C extends ResourceConfig<T>>(config: C): Resource<T, C> => {
  const caller: Caller = 'caller' in config && config.caller
    ? config.caller
    : createAxiosCaller(config.axios!);

  const extractId = makeExtractId(config.id ?? 'id');

  // Internal: bound into a FindHelper closed over one useList() call's own
  // `data` below - not part of the public surface itself.
  const findInList = (
    list: T[] | undefined,
    idOrPredicate: string | number | ((item: T, index: number, list: T[]) => boolean),
  ): T | undefined => {
    if (!list) return undefined;
    if (typeof idOrPredicate === 'function') return list.find(idOrPredicate);
    // String-coerce rather than strict === - callers routinely pass an id
    // sourced from a route param (always a string) against an entity whose
    // id field is numeric; extractId deliberately preserves the original
    // primitive type, so the two sides won't match under strict equality.
    return list.find((item) => String(extractId(item)) === String(idOrPredicate));
  };

  const getListActionConfig = config.actions?.getList;
  const pagConfig = getListPagination(getListActionConfig);
  const isPaginated = !!pagConfig;

  const detailUrl = (id: string | number | undefined) =>
    config.route.endsWith('/')
      ? `${config.route}${id}/`
      : `${config.route}/${id}`;

  // -- listOptions and useList (v0.5: pagination-aware) ------------
  // listOptions is the shared queryOptions builder. useList wraps it
  // for React, and prefetchList/fetchList delegate to queryClient.

  const listFilterPrepareParams = getListActionConfig && getListActionConfig !== true
      ? getListActionConfig.prepareParams
      : undefined;

  const listOptions: ListOptionsHelper<T> = (params?) => {
    const effectiveParams = withPaginationDefaults(params, pagConfig);
    const wireParams = buildWireParams(effectiveParams, pagConfig, listFilterPrepareParams);
    return {
      queryKey: [config.name, 'list', effectiveParams],
      queryFn: async ({ signal }) => {
        const response = await caller({
          method: 'get',
          url: config.route,
          params: Object.keys(wireParams).length > 0 ? wireParams : undefined,
          signal,
        });
        return response.data;  // raw response held in cache
      },
      // select transforms the cache value into T[] for TQ hooks.
      // Does NOT apply to fetchQuery/prefetchQuery (they return raw).
      ...(pagConfig
        ? { select: (raw: unknown) => pagConfig.extractItems(raw) as T[] }
        : {}),
    };
  };

  const prefetchList: PrefetchListHelper<T> = async (queryClient, params?) => {
    await queryClient.prefetchQuery(listOptions(params));
  };

  const fetchList: FetchListHelper<T> = async (queryClient, params?) => {
    const raw = await queryClient.fetchQuery(listOptions(params));
    return pagConfig ? (pagConfig.extractItems(raw) as T[]) : (raw as T[]);
  };

  const useList = (params?: Record<string, any>, tqOptions?: Record<string, any>) => {
    const opts = listOptions(params);
    const effectiveParams = withPaginationDefaults(params, pagConfig);
    const queryCallbacks: QueryCallbacks = narrowActionConfig(
      getListActionConfig as true | QueryCallbacks | undefined,
    );
    const actionTQ = extractTQOptions(
      getListActionConfig as true | Record<string, unknown> | undefined,
      LIBRARY_QUERY_FIELDS,
    );

    // Precedence: resource-level < action-level < per-call; library-owned
    // queryKey/queryFn always win.
    // Cache value is either T[] (non-paginated) or the raw paginated
    // response (extracted below via pagConfig).
    const raw = useQuery<unknown, Error, unknown>({
      ...(config.queryOptions ?? {}),
      ...actionTQ,
      ...(tqOptions ?? {}),
      queryKey: opts.queryKey,
      queryFn: opts.queryFn,
    });

    useQueryOnErrorEffect(raw.error, queryCallbacks.onError);

    // No pagination: raw data IS the array (or undefined)
    if (!pagConfig) {
      const list = raw.data as T[] | undefined;
      const find: FindHelper<T> = useMemo(
        () => ((idOrPredicate: any) => findInList(list, idOrPredicate)) as FindHelper<T>,
        [list],
      );
      return { ...raw, find } as ListResult<T>;
    }

    // With pagination: derive data + pagination from raw response
    const data = raw.data !== undefined
      ? pagConfig.extractItems(raw.data) as T[]
      : undefined;

    const pagination = raw.data !== undefined
      ? {
          count: pagConfig.extractMeta(raw.data).count,
          offset: effectiveParams.offset,
          limit: effectiveParams.limit,
        }
      : undefined;

    const find: FindHelper<T> = useMemo(
      () => ((idOrPredicate: any) => findInList(data, idOrPredicate)) as FindHelper<T>,
      [data],
    );

    return { ...raw, data, pagination, find };
  };

  // -- usePaginatedList helper -------------------------------------
  // Only meaningful when pagination is configured, but we generate it
  // anyway; if pagination isn't configured, it just uses useList directly
  // and returns a stub pagination. The conditional hook presence
  // (via Resource<T, C>) hides it at the type level.

  const usePaginatedList = (options: UsePaginatedListOptions = {}) => {
    const [offset, setOffset] = useState(options.initialOffset ?? 0);
    const [limit, setLimit] = useState(
      options.initialLimit ?? pagConfig?.defaultLimit ?? 20
    );

    // Serialize filters for change detection. Users should memoize
    // filters to keep this stable, but JSON.stringify handles the case
    // where they don't (at a small perf cost).
    const filtersKey = JSON.stringify(options.filters ?? null);
    const mountedRef = useRef(false);
    useEffect(() => {
      // Skip the mount effect - we only want to reset on actual filter CHANGES,
      // not on initial render (which would overwrite initialOffset).
      if (!mountedRef.current) {
        mountedRef.current = true;
        return;
      }
      setOffset(0);
    }, [filtersKey]);

    const params = { ...options.filters, offset, limit };
    const result = useList(params) as PaginatedListResult<T>;

    const setLimitAndReset = (l: number) => {
      setLimit(l);
      setOffset(0);
    };
    const next = () => setOffset((o) => o + limit);
    const prev = () => setOffset((o) => Math.max(0, o - limit));
    const goto = (page: number) => setOffset(page * limit);

    const pagination = result.pagination ?? { count: 0, offset, limit };
    const hasNext = pagination.count > 0 && offset + limit < pagination.count;
    const hasPrev = offset > 0;

    return {
      ...result,
      pagination,
      offset,
      limit,
      next,
      prev,
      goto,
      setOffset,
      setLimit: setLimitAndReset,
      hasNext,
      hasPrev,
    };
  };

  // -- Standard queries --------------------------------------------

  const detailOptions: DetailOptionsHelper<T> = (id) => ({
    queryKey: [config.name, 'detail', id],
    queryFn: async ({ signal }) => {
      const response = await caller({
        method: 'get',
        url: detailUrl(id),
        signal,
      });
      return response.data as T;
    },
    enabled: id != null,
  });

  const prefetchGet: PrefetchGetHelper<T> = async (queryClient, id) => {
    await queryClient.prefetchQuery(detailOptions(id));
  };

  const fetchGet: FetchGetHelper<T> = async (queryClient, id) => {
    return await queryClient.fetchQuery(detailOptions(id));
  };

  const useGet: GetHook<T> = (id, tqOptions?) => {
    const queryCallbacks: QueryCallbacks = narrowActionConfig(
      config.actions?.get as true | QueryCallbacks | undefined,
    );
    const actionTQ = extractTQOptions(
      config.actions?.get as true | Record<string, unknown> | undefined,
      LIBRARY_QUERY_FIELDS,
    );
    const { queryKey, queryFn, enabled: defaultEnabled } = detailOptions(id);
    const result = useQuery<T, Error>({
      enabled: defaultEnabled,
      ...(config.queryOptions ?? {}) as Record<string, unknown>,
      ...actionTQ,
      ...(tqOptions ?? {}),
      queryKey,
      queryFn,
    });
    useQueryOnErrorEffect(result.error, queryCallbacks.onError);
    return result;
  };

  const singleOptions: SingleOptionsHelper<T> = () => ({
    queryKey: [config.name, 'single'],
    queryFn: async ({ signal }) => {
      const response = await caller({ method: 'get', url: config.route, signal });
      return response.data as T;
    },
  });

  const prefetchSingle: PrefetchSingleHelper<T> = async (queryClient) => {
    await queryClient.prefetchQuery(singleOptions());
  };

  const fetchSingle: FetchSingleHelper<T> = async (queryClient) => {
    return await queryClient.fetchQuery(singleOptions());
  };

  const useSingle: SingleHook<T> = (tqOptions?) => {
    const queryCallbacks: QueryCallbacks = narrowActionConfig(
      config.actions?.getSingle as true | QueryCallbacks | undefined,
    );
    const actionTQ = extractTQOptions(
      config.actions?.getSingle as true | Record<string, unknown> | undefined,
      LIBRARY_QUERY_FIELDS,
    );
    const { queryKey, queryFn } = singleOptions();
    const result = useQuery<T, Error>({
      ...(config.queryOptions ?? {}) as Record<string, unknown>,
      ...actionTQ,
      ...(tqOptions ?? {}),
      queryKey,
      queryFn,
    });
    useQueryOnErrorEffect(result.error, queryCallbacks.onError);
    return result;
  };

  // -- Standard mutations ------------------------------------------

  const useCreate: CreateHook<T> = () => {
    const queryClient = useQueryClient();
    const actionConfig = config.actions?.create as true | CreateConfig<T> | undefined;
    const callbacks: ErasedMutationCallbacks = narrowActionConfig(actionConfig);
    const prepare: ErasedMutationPrepare = narrowActionConfig(actionConfig);
    const invalidates = getInvalidates(actionConfig);
    const actionTQ = extractTQOptions(
      actionConfig as true | Record<string, unknown> | undefined,
      LIBRARY_MUTATION_FIELDS,
    );
    return useMutation<T, Error, Partial<T>>({
      ...(config.mutationOptions ?? {}) as Record<string, unknown>,
      ...actionTQ,
      mutationFn: async (variables) => {
        const response = await caller({
          method: 'post',
          url: config.route,
          data: prepare.prepare ? prepare.prepare(variables) : variables,
          params: prepare.prepareParams?.(variables),
        });
        return response.data as T;
      },
      onMutate: callbacks.onMutate as any,
      onSuccess: async (created, variables, onMutateResult, mutationContext) => {
        // Library's cache updates run first
        if (shouldSkipResponseDriven(invalidates)) {
          runInvalidation(queryClient, config.name, invalidates);
        } else {
          // Response-driven update: append to all list caches (non-paginated only),
          // set detail cache, plus any cross-resource invalidations.
          if (!isPaginated) {
            updateAllLists<T>(queryClient, config.name, (list) => [...list, created]);
          } else {
            runInvalidation(queryClient, config.name, 'all');
          }
          const createdId = extractId(created);
          if (createdId !== undefined) {
            setDetailCache(queryClient, config.name, createdId, created);
          }
          const extras = crossResourceOnly(invalidates);
          if (extras.length > 0) {
            runInvalidation(queryClient, config.name, extras);
          }
        }
        // Then user's onSuccess
        await callbacks.onSuccess?.(created, variables, onMutateResult, mutationContext);
      },
      onError: async (error, variables, onMutateResult, mutationContext) => {
        await fireMutationErrorHandlers(
          config.onError, callbacks.onError, 'create', error, variables, onMutateResult, mutationContext,
        );
      },
      onSettled: callbacks.onSettled as any,
    });
  };

  const useUpdate: UpdateHook<T> = () => {
    const queryClient = useQueryClient();
    const actionConfig = config.actions?.update as true | UpdateConfig<T> | undefined;
    const callbacks: ErasedMutationCallbacks = narrowActionConfig(actionConfig);
    const prepare: ErasedMutationPrepare = narrowActionConfig(actionConfig);
    const invalidates = getInvalidates(actionConfig);
    const actionTQ = extractTQOptions(
      actionConfig as true | Record<string, unknown> | undefined,
      LIBRARY_MUTATION_FIELDS,
    );
    return useMutation<T, Error, Partial<T>>({
      ...(config.mutationOptions ?? {}) as Record<string, unknown>,
      ...actionTQ,
      mutationFn: async (variables) => {
        const id = extractId(variables);
        const response = await caller({
          method: 'patch',
          url: detailUrl(id),
          data: prepare.prepare ? prepare.prepare(variables) : variables,
          params: prepare.prepareParams?.(variables),
        });
        return response.data as T;
      },
      onMutate: callbacks.onMutate as any,
      onSuccess: async (updated, variables, onMutateResult, mutationContext) => {
        if (shouldSkipResponseDriven(invalidates)) {
          runInvalidation(queryClient, config.name, invalidates);
        } else {
          const updatedId = extractId(updated);
          if (!isPaginated) {
            updateAllLists<T>(queryClient, config.name, (list) =>
              list.map((item) => (extractId(item) === updatedId ? updated : item))
            );
          } else {
            runInvalidation(queryClient, config.name, 'all');
          }
          if (updatedId !== undefined) {
            setDetailCache(queryClient, config.name, updatedId, updated);
          }
          const extras = crossResourceOnly(invalidates);
          if (extras.length > 0) {
            runInvalidation(queryClient, config.name, extras);
          }
        }
        await callbacks.onSuccess?.(updated, variables, onMutateResult, mutationContext);
      },
      onError: async (error, variables, onMutateResult, mutationContext) => {
        await fireMutationErrorHandlers(
          config.onError, callbacks.onError, 'update', error, variables, onMutateResult, mutationContext,
        );
      },
      onSettled: callbacks.onSettled as any,
    });
  };

  const useDelete: DeleteHook<T> = () => {
    const queryClient = useQueryClient();
    const actionConfig = config.actions?.delete as true | DeleteConfig<T> | undefined;
    const callbacks: ErasedMutationCallbacks = narrowActionConfig(actionConfig);
    const prepare: ErasedMutationPrepare = narrowActionConfig(actionConfig);
    const invalidates = getInvalidates(actionConfig);
    const actionTQ = extractTQOptions(
      actionConfig as true | Record<string, unknown> | undefined,
      LIBRARY_MUTATION_FIELDS,
    );
    return useMutation<void, Error, Partial<T>>({
      ...(config.mutationOptions ?? {}) as Record<string, unknown>,
      ...actionTQ,
      mutationFn: async (variables) => {
        const id = extractId(variables);
        await caller({
          method: 'delete',
          url: detailUrl(id),
          data: prepare.prepare ? prepare.prepare(variables) : undefined,
          params: prepare.prepareParams?.(variables),
        });
      },
      onMutate: callbacks.onMutate as any,
      onSuccess: async (_data, variables, onMutateResult, mutationContext) => {
        if (shouldSkipResponseDriven(invalidates)) {
          runInvalidation(queryClient, config.name, invalidates);
        } else {
          const deletedId = extractId(variables);
          if (!isPaginated) {
            updateAllLists<T>(queryClient, config.name, (list) =>
              list.filter((item) => extractId(item) !== deletedId)
            );
          } else {
            runInvalidation(queryClient, config.name, 'all');
          }
          if (deletedId !== undefined) {
            removeDetailCache(queryClient, config.name, deletedId);
          }
          const extras = crossResourceOnly(invalidates);
          if (extras.length > 0) {
            runInvalidation(queryClient, config.name, extras);
          }
        }
        await callbacks.onSuccess?.(_data, variables, onMutateResult, mutationContext);
      },
      onError: async (error, variables, onMutateResult, mutationContext) => {
        await fireMutationErrorHandlers(
          config.onError, callbacks.onError, 'delete', error, variables, onMutateResult, mutationContext,
        );
      },
      onSettled: callbacks.onSettled as any,
    });
  };

  // -- Custom action hooks -----------------------------------------

  const customActionHooks: Record<string, () => any> = {};
  if (config.customActions) {
    for (const [name, actionConfig] of Object.entries(config.customActions)) {
      const hookName = `use${name[0]!.toUpperCase()}${name.slice(1)}`;
      const callbacks: ErasedMutationCallbacks = actionConfig;
      const prepare: ErasedMutationPrepare = actionConfig;
      const actionTQ = extractTQOptions(
        actionConfig as unknown as Record<string, unknown>,
        LIBRARY_CUSTOM_ACTION_FIELDS,
      );
      customActionHooks[hookName] = () => {
        const queryClient = useQueryClient();
        return useMutation({
          ...(config.mutationOptions ?? {}) as Record<string, unknown>,
          ...actionTQ,
          mutationFn: async (variables: unknown) => {
            const url = typeof actionConfig.path === 'function'
              ? actionConfig.path(variables)
              : actionConfig.path;
            const response = await caller({
              method: actionConfig.method,
              url,
              data: prepare.prepare ? prepare.prepare(variables) : variables,
              params: prepare.prepareParams?.(variables),
            });
            return response.data;
          },
          onMutate: callbacks.onMutate as any,
          onSuccess: async (data, variables, onMutateResult, mutationContext) => {
            runInvalidation(queryClient, config.name, actionConfig.invalidates);
            await callbacks.onSuccess?.(data, variables, onMutateResult, mutationContext);
          },
          onError: async (error, variables, onMutateResult, mutationContext) => {
            await fireMutationErrorHandlers(
              config.onError, callbacks.onError, name, error, variables, onMutateResult, mutationContext,
            );
          },
          onSettled: callbacks.onSettled as any,
        });
      };
    }
  }

  // -- Invalidation hooks (always available on every resource) -----

  const useInvalidate = () => {
    const queryClient = useQueryClient();
    return useCallback(() => invalidate(queryClient, config.name), [queryClient]);
  };

  const useInvalidateList = () => {
    const queryClient = useQueryClient();
    return useCallback(() => invalidateList(queryClient, config.name), [queryClient]);
  };

  const useInvalidateDetail = () => {
    const queryClient = useQueryClient();
    return useCallback(
      (id?: string | number) => invalidateDetail(queryClient, config.name, id),
      [queryClient],
    );
  };

  // -- Build the resource ------------------------------------------

  const actions = config.actions ?? {};
  const ssrEnabled = config.ssr === true;

  const resource = {
    name: config.name,
    useInvalidate,
    ...(actions.getList ? { useInvalidateList } : {}),
    ...(actions.get ? { useInvalidateDetail } : {}),
    ...(actions.getList ? { useList } : {}),
    ...(actions.getList && ssrEnabled
      ? { listOptions, prefetchList, fetchList }
      : {}),
    ...(isPaginated       ? { usePaginatedList } : {}),
    ...(actions.get ? { useGet } : {}),
    ...(actions.get && ssrEnabled
      ? { detailOptions, prefetchGet, fetchGet }
      : {}),
    ...(actions.getSingle ? { useSingle } : {}),
    ...(actions.getSingle && ssrEnabled
      ? { singleOptions, prefetchSingle, fetchSingle }
      : {}),
    ...(actions.create    ? { useCreate } : {}),
    ...(actions.update    ? { useUpdate } : {}),
    ...(actions.delete    ? { useDelete } : {}),
    ...customActionHooks,
  };

  return resource as Resource<T, C>;
};
