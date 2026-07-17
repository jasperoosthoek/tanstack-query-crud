export { createResource } from './createResource';
export type {
  DetailQueryOptions,
  ListQueryOptions,
  PaginatedListResult,
  Resource,
  SingleQueryOptions,
  UsePaginatedListOptions,
  UsePaginatedListResult,
} from './createResource';

export { createAxiosCaller } from './adapters/axios';

export { runInvalidation } from './invalidation';

// Cache manipulation - standalone functions (take queryClient explicitly)
export {
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

// React hook wrapper (binds queryClient from context)
export { useResourceUtils } from './useResourceUtils';
export type { ResourceUtils } from './useResourceUtils';

export type {
  Actions,
  Caller,
  CallerConfig,
  CreateConfig,
  CustomActionConfig,
  CustomActionMethod,
  CustomActions,
  DeleteConfig,
  GetConfig,
  GetListConfig,
  GetSingleConfig,
  HttpMethod,
  InferActionData,
  InvalidatesConfig,
  InvalidationStringTarget,
  InvalidationTarget,
  Pagination,
  PaginationConfig,
  ResourceCallerConfig,
  ResourceConfig,
  ResourceRef,
  UpdateConfig,
} from './types';
