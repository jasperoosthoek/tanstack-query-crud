import type { AxiosInstance } from 'axios';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import { createResource } from '../src';

type Task = { id: number; title: string; done: boolean };

const axios = {} as AxiosInstance;

// -- Resource with ALL standard actions -----------------------------

const full = createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios,
  actions: {
    getList: true,
    get: true,
    getSingle: true,
    create: true,
    update: true,
    delete: true,
  },
});

const _name: 'tasks' = full.name;
const _list:   UseQueryResult<Task[], Error> = full.useList();
const _detail: UseQueryResult<Task, Error>   = full.useGet(42);
const _single: UseQueryResult<Task, Error>   = full.useSingle();
const _create: UseMutationResult<Task, Error, Partial<Task>> = full.useCreate();
const _update: UseMutationResult<Task, Error, Partial<Task>> = full.useUpdate();
const _delete: UseMutationResult<void, Error, Partial<Task>> = full.useDelete();

// -- Resource with NO actions ---------------------------------------

const empty = createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios,
  actions: {},
});

// @ts-expect-error - useList not configured
empty.useList;
// @ts-expect-error - useGet not configured
empty.useGet;
// @ts-expect-error - useSingle not configured
empty.useSingle;
// @ts-expect-error - useCreate not configured
empty.useCreate;
// @ts-expect-error - useUpdate not configured
empty.useUpdate;
// @ts-expect-error - useDelete not configured
empty.useDelete;

// -- Custom actions -------------------------------------------------

const withCustom = createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios,
  actions: { getList: true },
  customActions: {
    approve: {
      path: (t: Task) => `/tasks/${t.id}/approve`,
      method: 'post',
    },
    reject: {
      path: (t: Task) => `/tasks/${t.id}/reject`,
      method: 'post',
    },
    stringPath: {
      path: '/tasks/reset',
      method: 'post',
    },
  },
});

// Hook names - capitalized from config keys
const _approve: UseMutationResult<Task, Error, Task> = withCustom.useApprove();
const _reject: UseMutationResult<Task, Error, Task> = withCustom.useReject();
const _stringPath: UseMutationResult<Task, Error, any> = withCustom.useStringPath();

// Data type inferred from path function
withCustom.useApprove().mutate({ id: 1, title: 'x', done: false });  // ✓ Task
// @ts-expect-error - wrong shape
withCustom.useApprove().mutate({ title: 'x' });  // missing id + done
// @ts-expect-error - not a Task
withCustom.useApprove().mutate('not-a-task');

// String-path actions accept any data
withCustom.useStringPath().mutate({ anything: true });
withCustom.useStringPath().mutate('anything');

// Standard actions still typed properly
withCustom.useList();

// @ts-expect-error - action name not in customActions
withCustom.useRefund;

// -- Resource without customActions ---------------------------------

const noCustom = createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios,
  actions: { getList: true },
});

// @ts-expect-error - no custom actions configured
noCustom.useApprove;

// -- Custom action with unusual key (multi-word) --------------------

const multi = createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios,
  actions: {},
  customActions: {
    markComplete: {
      path: (t: Task) => `/tasks/${t.id}/mark-complete`,
      method: 'post',
    },
  },
});

// Capitalize only affects the first letter - multi-word keys stay camelCase-ish
const _markComplete: UseMutationResult<Task, Error, Task> = multi.useMarkComplete();

// -- axios vs caller mutex still holds ------------------------------

// @ts-expect-error - can't provide both axios and caller
createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios,
  caller: async () => ({ data: [] }),
  actions: { getList: true },
});

// -- v0.4 Invalidation types ----------------------------------------

type Stats = { open: number; closed: number };
const taskStats = createResource<Stats>()({
  name: 'taskStats', route: '/tasks/stats', axios,
  actions: { getSingle: true },
});

// String targets on standard mutations
createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: {
    create: { invalidates: ['list'] },
    update: { invalidates: ['list', 'detail'] },
    delete: { invalidates: 'all' },
  },
});

// Resource reference (cross-resource)
createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: {
    create: { invalidates: ['list', taskStats] },
  },
});

// Tuple form for specific cross-resource key
createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: {
    update: { invalidates: [[taskStats, 'single']] },
  },
});

// Custom actions accept the same invalidates shape
createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: {},
  customActions: {
    approve: {
      path: (t: Task) => `/tasks/${t.id}/approve`,
      method: 'post',
      invalidates: ['list', taskStats, [taskStats, 'single']],
    },
    noop: {
      path: '/tasks/noop',
      method: 'post',
      invalidates: [],  // empty array = no invalidation
    },
  },
});

createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  // @ts-expect-error - invalid string target
  actions: { create: { invalidates: ['bogus'] } },
});

// -- v0.6 Cache manipulation types ---------------------------------

import type { QueryClient } from '@tanstack/react-query';
import {
  getListCache,
  setListCache,
  getDetailCache,
  setDetailCache,
  updateAllLists,
  updateAllDetails,
} from '../src';

declare const qc: QueryClient;

// getListCache returns T[] | undefined - not `any`
const _cacheListResult: Task[] | undefined = getListCache<Task>(qc, 'tasks');

// setListCache requires T[] - array of the entity type
setListCache<Task>(qc, 'tasks', [{ id: 1, title: 'A', done: false }]);

// @ts-expect-error - setListCache rejects a non-array
setListCache<Task>(qc, 'tasks', { id: 1, title: 'A', done: false });

// @ts-expect-error - setListCache rejects an array of wrong shape
setListCache<Task>(qc, 'tasks', [{ id: 1, wrongField: 'x' }]);

// @ts-expect-error - setListCache rejects a plain string
setListCache<Task>(qc, 'tasks', 'not-an-array');

// getDetailCache returns T | undefined
const _cacheDetailResult: Task | undefined = getDetailCache<Task>(qc, 'tasks', 42);

// setDetailCache requires T
setDetailCache<Task>(qc, 'tasks', 42, { id: 42, title: 'X', done: true });

// @ts-expect-error - setDetailCache rejects wrong shape
setDetailCache<Task>(qc, 'tasks', 42, { id: 42, wrong: 'x' });

// updateAllLists updater sees T[] and must return T[]
updateAllLists<Task>(qc, 'tasks', (list) => list.filter((t) => !t.done));

// @ts-expect-error - updater must return T[]
updateAllLists<Task>(qc, 'tasks', (list) => list.length);

// updateAllDetails updater sees T and must return T
updateAllDetails<Task>(qc, 'tasks', (t) => ({ ...t, done: true }));

// @ts-expect-error - updater must return T
updateAllDetails<Task>(qc, 'tasks', (t) => t.id);

// -- v0.7 SSR helpers -----------------------------------------------

// With `ssr: true`, SSR helpers attach as public methods
const ssrResource = createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  ssr: true,
  actions: { getList: true, get: true, getSingle: true },
});

// listOptions returns queryOptions - has queryKey and queryFn
const _listOpts = ssrResource.listOptions();
const _listKey: readonly unknown[] = _listOpts.queryKey;

// prefetchList/prefetchGet/prefetchSingle return Promise<void>
const _pl: Promise<void> = ssrResource.prefetchList(qc);
const _pg: Promise<void> = ssrResource.prefetchGet(qc, 42);
const _ps: Promise<void> = ssrResource.prefetchSingle(qc);

// fetchList returns Promise<T[]>, fetchGet/fetchSingle return Promise<T>
const _fl: Promise<Task[]> = ssrResource.fetchList(qc);
const _fg: Promise<Task> = ssrResource.fetchGet(qc, 42);
const _fs: Promise<Task> = ssrResource.fetchSingle(qc);

// prefetchList accepts optional params
ssrResource.prefetchList(qc, { status: 'open' });
ssrResource.fetchList(qc, { status: 'open' });

// SSR helpers absent when action not configured
const noQueriesResource = createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: { create: true },
});

// @ts-expect-error - no getList configured
noQueriesResource.listOptions;
// @ts-expect-error - no getList configured
noQueriesResource.prefetchList;
// @ts-expect-error - no getList configured
noQueriesResource.fetchList;
// @ts-expect-error - no get configured
noQueriesResource.detailOptions;
// @ts-expect-error - no get configured
noQueriesResource.prefetchGet;
// @ts-expect-error - no getSingle configured
noQueriesResource.singleOptions;

// Default resource (no ssr: true) - SSR helpers absent from public type
// even when actions are configured.
const nonSsrResource = createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: { getList: true, get: true, getSingle: true },
});

// Regular hooks still available
nonSsrResource.useList();
nonSsrResource.useGet(42);
nonSsrResource.useSingle();

// SSR helpers NOT on the resource type without ssr: true
// @ts-expect-error - ssr: true not set
nonSsrResource.listOptions;
// @ts-expect-error - ssr: true not set
nonSsrResource.prefetchList;
// @ts-expect-error - ssr: true not set
nonSsrResource.fetchList;
// @ts-expect-error - ssr: true not set
nonSsrResource.detailOptions;
// @ts-expect-error - ssr: true not set
nonSsrResource.prefetchGet;
// @ts-expect-error - ssr: true not set
nonSsrResource.singleOptions;

// -- v0.5 Pagination types ------------------------------------------

// Without pagination: useList returns standard UseQueryResult<T[]>,
// no usePaginatedList
const plain = createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: { getList: true },
});
plain.useList();
// @ts-expect-error - usePaginatedList not available without pagination config
plain.usePaginatedList;

// With pagination: useList returns extended shape, usePaginatedList exists
const paginated = createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  actions: {
    getList: {
      pagination: {
        defaultLimit: 20,
        extractItems: (r: any) => r.results as Task[],
        extractMeta: (r: any) => ({ count: r.count }),
      },
    },
  },
});

// Both hooks available
const listResult = paginated.useList();
const _paginationField: { count: number; offset: number; limit: number } | undefined = listResult.pagination;

const paginatedResult = paginated.usePaginatedList();
const _n: () => void = paginatedResult.next;
const _p: () => void = paginatedResult.prev;
const _goto: (page: number) => void = paginatedResult.goto;
const _hn: boolean = paginatedResult.hasNext;
const _hp: boolean = paginatedResult.hasPrev;
const _off: number = paginatedResult.offset;
const _lim: number = paginatedResult.limit;

// Filters accepted
paginated.usePaginatedList({ filters: { status: 'open' } });
paginated.usePaginatedList({ initialOffset: 40, initialLimit: 10 });

// -- v0.8 Callback surface ------------------------------------------

import type { MutationFunctionContext } from '@tanstack/react-query';

// Mutation callback signatures - TQ-native shapes with the trailing
// mutationContext param (TQ v5.60+).
const callbackResource = createResource<Task>()({
  name: 'tasks', route: '/tasks', axios,
  onError: (err, ctx) => {
    const _errMsg: string = err.message;
    const _actionName: string = ctx.action;
    const _vars: unknown = ctx.variables;
  },
  actions: {
    getList: {
      onError: (err: Error) => { void err.message; },
      throwOnError: true,
    },
    get: { onError: (err) => { void err; } },
    getSingle: { throwOnError: true },
    create: {
      onMutate: (variables: Partial<Task>, mctx: MutationFunctionContext) => {
        void variables.title;
        void mctx.client;
        return { startedAt: 0 };
      },
      onSuccess: (data: Task, variables, onMutateResult, mctx) => {
        const _id: number = data.id;
        const _t: string | undefined = variables.title;
        // onMutateResult is unknown by default (not narrowed unless generic set)
        void onMutateResult;
        void mctx.client;
      },
      onError: (error: Error, variables, onMutateResult, mctx) => {
        void error.message;
        void variables.title;
        void onMutateResult;
        void mctx.client;
      },
      onSettled: (data: Task | undefined, error, variables, onMutateResult, mctx) => {
        void data?.id;
        void error?.message;
        void variables.title;
        void onMutateResult;
        void mctx.client;
      },
    },
    update: {
      onSuccess: (data: Task) => { void data.id; },
    },
    delete: {
      // useDelete's data is void
      onSuccess: (data: void, variables: Partial<Task>) => {
        void data;
        void variables.id;
      },
    },
  },
  customActions: {
    approve: {
      path: (t: Task) => `/tasks/${t.id}/approve`,
      method: 'post',
      onMutate: (v: Task) => { void v.id; },
      onSuccess: (_data, variables) => { void variables.id; },
      onError: (err) => { void err.message; },
      onSettled: (_data, err, variables) => {
        void err?.message;
        void variables.id;
      },
    },
  },
});
void callbackResource;

// Per-call callbacks via TQ-native mutate options (untyped in probe)
// require a full render, so we skip runtime typing here.

// -- v0.9 Configurable id, prepare, typed filters, TQ options -------

// Custom id field on the resource
type TaskU = { uuid: string; title: string };
const uuidResource = createResource<TaskU>()({
  name: 'tasksU', route: '/tasks', axios,
  id: 'uuid',
  actions: { create: true, update: true },
});
void uuidResource;

// prepare + prepareParams on mutation actions
const prepareResource = createResource<Task>()({
  name: 'tasksP', route: '/tasks', axios,
  actions: {
    create: {
      prepare: (v: Partial<Task>) => ({ payload: v }),
      prepareParams: (v) => ({ title: v.title }),
    },
    update: {
      prepare: (v: Partial<Task>) => ({ payload: v }),
    },
  },
  customActions: {
    upload: {
      path: (v: { id: number }) => `/upload/${v.id}`,
      method: 'post',
      prepare: (v) => ({ fileName: v.id }),
    },
  },
});
void prepareResource;

// Typed filter params via getList.prepareParams
type TaskFiltersP = { status?: 'open' | 'closed'; assignee?: number };
const filteredResource = createResource<Task>()({
  name: 'tasksF', route: '/tasks', axios,
  actions: {
    getList: {
      prepareParams: (f: TaskFiltersP) => f,
    },
  },
});
// useList now typed against TaskFiltersP
filteredResource.useList({ status: 'open' });
filteredResource.useList({ status: 'closed', assignee: 42 });
filteredResource.useList();
// @ts-expect-error - 'invalid' not in status union
filteredResource.useList({ status: 'invalid' });
// @ts-expect-error - unknown key
filteredResource.useList({ nonexistent: true });

// Filters + pagination merged
const filteredPaginated = createResource<Task>()({
  name: 'tasksFP', route: '/tasks', axios,
  actions: {
    getList: {
      prepareParams: (f: TaskFiltersP) => f,
      pagination: {
        defaultLimit: 20,
        extractItems: (r: any) => r.results as Task[],
        extractMeta: (r: any) => ({ count: r.count }),
      },
    },
  },
});
filteredPaginated.useList({ status: 'open', offset: 20, limit: 20 });
filteredPaginated.useList({ status: 'open' });
// @ts-expect-error - status must be in union
filteredPaginated.useList({ status: 'nope', offset: 0 });

// TQ options passthrough - resource-level
const resourceLevelTqResource = createResource<Task>()({
  name: 'tasksTQ', route: '/tasks', axios,
  queryOptions: {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    gcTime: 5 * 60_000,
  },
  mutationOptions: {
    retry: 2,
    networkMode: 'always',
  },
  actions: { getList: true, create: true },
});
void resourceLevelTqResource;

// TQ options at action-level (flat, mixed with library fields)
const actionLevelTqResource = createResource<Task>()({
  name: 'tasksTQ3', route: '/tasks', axios,
  actions: {
    getList: {
      pagination: {
        defaultLimit: 20,
        extractItems: (r: any) => r as Task[],
        extractMeta: () => ({ count: 0 }),
      },
      onError: (e) => { void e; },      // library callback
      staleTime: 30_000,                 // TQ passthrough
      refetchInterval: 10_000,           // TQ passthrough
      throwOnError: true,                // TQ passthrough
    },
    create: {
      invalidates: ['list'],             // library
      onSuccess: (t) => { void t.id; },  // library callback
      retry: 5,                           // TQ passthrough
      gcTime: 0,                          // TQ passthrough
    },
  },
});
void actionLevelTqResource;

// TQ options per-call
const perCallResource = createResource<Task>()({
  name: 'tasksTQ4', route: '/tasks', axios,
  actions: { getList: true, get: true, getSingle: true },
});
perCallResource.useList(undefined, { staleTime: 0 });
perCallResource.useList({ q: 'x' }, { enabled: true, refetchInterval: 5000 });
perCallResource.useGet(42, { staleTime: 60_000, retry: 1 });
perCallResource.useSingle({ enabled: false });

// -- Invalidation hooks (v0.1.2) -----------------------------------

// useInvalidate is present on EVERY resource shape, regardless of actions.
const invalFull: () => () => void = full.useInvalidate;
const invalEmpty: () => () => void = empty.useInvalidate;
const invalWithCustom: () => () => void = withCustom.useInvalidate;
const invalNoCustom: () => () => void = noCustom.useInvalidate;
const invalMulti: () => () => void = multi.useInvalidate;
const invalStats: () => () => void = taskStats.useInvalidate;
void [invalFull, invalEmpty, invalWithCustom, invalNoCustom, invalMulti, invalStats];

// The returned invalidator takes no args and returns void.
const _invalFn: () => void = full.useInvalidate();
_invalFn();
// @ts-expect-error - takes no arguments
full.useInvalidate()('bogus');

// useInvalidateList is present ONLY when getList is configured.
const _invalListFull: () => () => void = full.useInvalidateList;
const _invalListWithCustom: () => () => void = withCustom.useInvalidateList;
// noCustom has getList too
const _invalListNoCustom: () => () => void = noCustom.useInvalidateList;
// @ts-expect-error - no getList action -> no useInvalidateList
empty.useInvalidateList;
// @ts-expect-error - no getList action -> no useInvalidateList
multi.useInvalidateList;
// @ts-expect-error - no getList action (only getSingle) -> no useInvalidateList
taskStats.useInvalidateList;

// useInvalidateDetail is present ONLY when get is configured.
const _invalDetailFull: () => (id?: string | number) => void = full.useInvalidateDetail;
// @ts-expect-error - no get action -> no useInvalidateDetail
empty.useInvalidateDetail;
// @ts-expect-error - no get action -> no useInvalidateDetail
withCustom.useInvalidateDetail;
// @ts-expect-error - no get action -> no useInvalidateDetail
noCustom.useInvalidateDetail;
// @ts-expect-error - no get action -> no useInvalidateDetail
multi.useInvalidateDetail;
// @ts-expect-error - getSingle is NOT get -> no useInvalidateDetail
taskStats.useInvalidateDetail;

// invalidateDetail takes an optional id, and only string | number.
const _invalDetailFn: (id?: string | number) => void = full.useInvalidateDetail();
_invalDetailFn();
_invalDetailFn(42);
_invalDetailFn('abc');
// @ts-expect-error - id must be string | number, not object
_invalDetailFn({ id: 1 });
