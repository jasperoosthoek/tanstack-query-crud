import type { AxiosInstance } from 'axios';
import type {
  MutationFunctionContext,
  UseMutationOptions,
  UseQueryOptions,
} from '@tanstack/react-query';

export type { MutationFunctionContext };

// -- TQ options passthrough ----------------------------------------
// Pass-through TQ options at four levels: global (QueryClient defaults),
// resource-level (nested), action-level (flat), per-call. Library-owned
// fields are Omitted so users can't accidentally override them.

// Note: raw slot uses `any` (not `unknown`) so spreading these into
// useQuery calls with specific TQueryFnData types (T vs T[] vs raw
// paginated) doesn't produce assignability errors on `enabled`, which
// is generic over TQueryFnData in TQ v5.
export type QueryTQOptions<TData = unknown> = Omit<
  UseQueryOptions<any, Error, TData>,
  'queryKey' | 'queryFn' | 'select'
>;

export type MutationTQOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, Error, TVariables>,
  'mutationFn' | 'onMutate' | 'onSuccess' | 'onError' | 'onSettled'
>;

// -- Caller abstraction --------------------------------------------

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type CallerConfig = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: any;
  signal?: AbortSignal;
};

export type Caller = (config: CallerConfig) => Promise<{ data: any }>;

// -- Invalidation targets ------------------------------------------

export type InvalidationStringTarget = 'list' | 'detail' | 'single' | 'all';

export type ResourceRef = { name: string };

export type InvalidationTarget =
  | InvalidationStringTarget
  | ResourceRef
  | [ResourceRef, InvalidationStringTarget];

/**
 * How to keep the cache in sync after a mutation succeeds.
 *
 * When omitted from a standard mutation config (create / update / delete),
 * the response drives the cache update in place - no refetch:
 * - `create` appends the returned entity to all list caches and stores
 *   it in the detail cache
 * - `update` replaces the matching entity by id in all list caches and
 *   refreshes its detail cache
 * - `delete` removes the entity by id from all list caches and clears
 *   its detail cache
 *
 * Set to `'all'`, `['list']`, `['detail']`, etc. to invalidate matching
 * queries instead (the classic TanStack Query pattern - queries refetch
 * on next access).
 *
 * Cross-resource targets (`[otherResource]`, `[[otherResource, 'list']]`)
 * are additive to the response-driven default - they always invalidate,
 * even when no same-resource string target is present.
 *
 * Note: paginated lists always fall back to invalidation for create and
 * delete because the library can't safely insert into or remove from a
 * fixed-offset page window.
 *
 * For custom actions, the default is `'all'` (invalidate every query on
 * the resource) - matching TanStack Query's usual pattern, since custom
 * mutations rarely return the entity in a shape the library can splice
 * into the cache.
 */
export type InvalidatesConfig = InvalidationTarget[] | 'all';

// -- Pagination ----------------------------------------------------
// v0.5: server-side pagination shape configured on getList.
// The library holds pagination metadata alongside the data array.

export type Pagination = {
  count: number;
  offset: number;
  limit: number;
};

export type PaginationConfig = {
  /** Default limit if useList is called without one. */
  defaultLimit: number;
  /**
   * Optional: transform pagination fields for the wire.
   * Use for backends that expect page/per_page instead of offset/limit.
   */
  prepareParams?: (p: { offset: number; limit: number }) => Record<string, any>;
  /**
   * Extract the entity array from the response.
   * Django REST default: (r) => r.results.
   * Bare-array API: (r) => r.
   */
  extractItems: (response: any) => any[];
  /**
   * Extract pagination metadata (count) from the response.
   * Django REST default: (r) => ({ count: r.count }).
   */
  extractMeta: (response: any) => { count: number };
};

// -- Callback shapes -----------------------------------------------
// TQ-native shapes for mutation callbacks. Users configure these at
// action-level; the library composes them with its internal cache
// updates (library first, user callbacks after).
//
// Signatures match TQ v5.60+: onMutate returns TOnMutateResult which
// flows to onSuccess/onError/onSettled as the `onMutateResult` param.
// The trailing `mutationContext` object carries `{ client, meta,
// mutationKey }` from TQ.

export type MutationCallbacks<TData, TVariables, TOnMutateResult = unknown> = {
  onMutate?: (
    variables: TVariables,
    mutationContext: MutationFunctionContext,
  ) => TOnMutateResult | Promise<TOnMutateResult> | void | Promise<void>;
  onSuccess?: (
    data: TData,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    mutationContext: MutationFunctionContext,
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    mutationContext: MutationFunctionContext,
  ) => void | Promise<void>;
  onSettled?: (
    data: TData | undefined,
    error: Error | null,
    variables: TVariables,
    onMutateResult: TOnMutateResult | undefined,
    mutationContext: MutationFunctionContext,
  ) => void | Promise<void>;
};

// Query callbacks - opt-in. TQ v5 removed onSuccess/onSettled from
// useQuery; only onError is exposed here via a useEffect wrapper.
// `throwOnError` and other TQ options flow through via the intersected
// QueryTQOptions on each query config.

export type QueryCallbacks = {
  onError?: (error: Error) => void;
};

// Resource-level error handler fires for every mutation on the
// resource. Composes with action-level callbacks (both fire).

export type ResourceErrorContext = {
  action: string;
  variables?: unknown;
};

export type ResourceOnError = (
  error: Error,
  context: ResourceErrorContext,
) => void;

// -- Standard action configs ---------------------------------------

export type GetListConfig<T> = {
  pagination?: PaginationConfig;
  /**
   * Optional filter transform for the wire. The parameter type is the
   * source of truth for `useList`'s first arg type (typed filters).
   * Example: `prepareParams: (f: TaskFilters) => f` for identity typing.
   */
  prepareParams?: (filters: any) => Record<string, any> | undefined;
} & QueryCallbacks
  & QueryTQOptions<T[]>;

export type GetConfig<T> = QueryCallbacks & QueryTQOptions<T>;
export type GetSingleConfig<T> = QueryCallbacks & QueryTQOptions<T>;

// Mutation body/params transforms. Run inside the generated mutationFn
// between the user's mutate() call and the caller adapter. `prepare`
// shapes the request body; `prepareParams` shapes the query string.
// Neither affects the variables seen by callbacks.

export type MutationPrepare<TVariables> = {
  prepare?: (variables: TVariables) => unknown;
  prepareParams?: (variables: TVariables) => Record<string, any> | undefined;
};

export type CreateConfig<T, TOnMutateResult = unknown> = {
  /** Cache sync strategy - see {@link InvalidatesConfig}. */
  invalidates?: InvalidatesConfig;
} & MutationPrepare<Partial<T>>
  & MutationCallbacks<T, Partial<T>, TOnMutateResult>
  & MutationTQOptions<T, Partial<T>>;

export type UpdateConfig<T, TOnMutateResult = unknown> = {
  /** Cache sync strategy - see {@link InvalidatesConfig}. */
  invalidates?: InvalidatesConfig;
} & MutationPrepare<Partial<T>>
  & MutationCallbacks<T, Partial<T>, TOnMutateResult>
  & MutationTQOptions<T, Partial<T>>;

export type DeleteConfig<T, TOnMutateResult = unknown> = {
  /** Cache sync strategy - see {@link InvalidatesConfig}. */
  invalidates?: InvalidatesConfig;
} & MutationPrepare<Partial<T>>
  & MutationCallbacks<void, Partial<T>, TOnMutateResult>
  & MutationTQOptions<void, Partial<T>>;

export type Actions<T> = {
  getList?: boolean | GetListConfig<T>;
  get?: boolean | GetConfig<T>;
  getSingle?: boolean | GetSingleConfig<T>;
  create?: boolean | CreateConfig<T>;
  update?: boolean | UpdateConfig<T>;
  delete?: boolean | DeleteConfig<T>;
};

// -- Custom actions (mutations only) -------------------------------

export type CustomActionMethod = 'post' | 'put' | 'patch' | 'delete';

export type CustomActionConfig<D = any, TData = any, TOnMutateResult = unknown> = {
  path: string | ((variables: D) => string);
  method: CustomActionMethod;
  /** Cache sync strategy - see {@link InvalidatesConfig}. */
  invalidates?: InvalidatesConfig;
} & MutationPrepare<D>
  & MutationCallbacks<TData, D, TOnMutateResult>
  & MutationTQOptions<TData, D>;

export type CustomActions = {
  [name: string]: CustomActionConfig<any, any, any>;
};

export type InferActionData<A> =
  A extends { path: (data: infer D, ...args: any[]) => any } ? D
  : A extends { prepare: (data: infer D, ...args: any[]) => any } ? D
  : any;

// -- Resource config -----------------------------------------------

export type ResourceCallerConfig =
  | { axios: AxiosInstance; caller?: never }
  | { caller: Caller; axios?: never };

export type ResourceConfig<T> = {
  name: string;
  route: string;
  actions?: Actions<T>;
  customActions?: CustomActions;
  /**
   * Opt in to attaching SSR helpers (prefetchList, fetchList, listOptions,
   * etc.) as public methods on the resource. Default false to keep the
   * resource surface clean for client-only apps.
   */
  ssr?: boolean;
  /**
   * Resource-level error handler - fires for every mutation on this
   * resource (create, update, delete, custom actions). Composes with
   * action-level onError; both fire.
   */
  onError?: ResourceOnError;
  /**
   * Field name for the entity's primary key. Used for detail-cache keys
   * and response-driven list updates. Defaults to `'id'`.
   */
  id?: string;
  /**
   * Resource-level TQ options applied to every query hook on this
   * resource. Merged with QueryClient defaults, action-level, and
   * per-call options - later wins.
   */
  queryOptions?: QueryTQOptions<T>;
  /**
   * Resource-level TQ options applied to every mutation hook on this
   * resource. Merged with QueryClient defaults and action-level options
   * - later wins. Per-call is TQ-native via mutate().
   */
  mutationOptions?: MutationTQOptions<T, Partial<T>>;
} & ResourceCallerConfig;
