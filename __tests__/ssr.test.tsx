import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

type Task = { id: number; title: string; done: boolean };
type Stats = { open: number; closed: number };

function makeMockAxios(handler: (config: any) => any): jest.Mock & AxiosInstance {
  const fn = jest.fn().mockImplementation(async (config) => ({
    data: handler(config),
  }));
  return fn as any;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

// -- listOptions / prefetchList / fetchList -----------------------

describe('list SSR helpers', () => {
  it('listOptions returns a queryKey and queryFn usable by prefetchQuery', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });

    const opts = tasks.listOptions();
    expect(opts.queryKey).toEqual(['tasks', 'list', {}]);
    expect(typeof opts.queryFn).toBe('function');

    const qc = makeQueryClient();
    await qc.prefetchQuery(opts);

    expect(qc.getQueryData(['tasks', 'list', {}])).toEqual(items);
  });

  it('prefetchList populates cache without returning data', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });

    const qc = makeQueryClient();
    const result = await tasks.prefetchList(qc);

    expect(result).toBeUndefined();
    expect(qc.getQueryData(['tasks', 'list', {}])).toEqual(items);
  });

  it('fetchList returns T[] for non-paginated', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });

    const qc = makeQueryClient();
    const list: Task[] = await tasks.fetchList(qc);

    expect(list).toEqual(items);
  });

  it('fetchList extracts items for paginated resources', async () => {
    const response = {
      count: 42,
      results: [{ id: 1, title: 'A', done: false }] as Task[],
    };
    const axios = makeMockAxios(() => response);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      ssr: true,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r: any) => r.results,
            extractMeta: (r: any) => ({ count: r.count }),
          },
        },
      },
    });

    const qc = makeQueryClient();
    const list: Task[] = await tasks.fetchList(qc);

    expect(list).toEqual(response.results);
  });

  it('prefetchList accepts params for filtered/paginated variants', async () => {
    const axios = makeMockAxios((c) => {
      if (c.params?.status === 'open') return [{ id: 1, title: 'A', done: false }];
      return [];
    });
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });

    const qc = makeQueryClient();
    await tasks.prefetchList(qc, { status: 'open' });

    expect(qc.getQueryData(['tasks', 'list', { status: 'open' }]))
      .toEqual([{ id: 1, title: 'A', done: false }]);
  });
});

// -- detailOptions / prefetchGet / fetchGet ----------------------

describe('get SSR helpers', () => {
  it('detailOptions returns a queryKey and queryFn', () => {
    const axios = makeMockAxios(() => undefined);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true }, ssr: true,
    });

    const opts = tasks.detailOptions(42);
    expect(opts.queryKey).toEqual(['tasks', 'detail', 42]);
    expect(typeof opts.queryFn).toBe('function');
  });

  it('prefetchGet populates the detail cache', async () => {
    const item: Task = { id: 42, title: 'X', done: true };
    const axios = makeMockAxios(() => item);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true }, ssr: true,
    });

    const qc = makeQueryClient();
    await tasks.prefetchGet(qc, 42);

    expect(qc.getQueryData(['tasks', 'detail', 42])).toEqual(item);
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'get', url: '/tasks/42' })
    );
  });

  it('fetchGet returns T', async () => {
    const item: Task = { id: 42, title: 'X', done: true };
    const axios = makeMockAxios(() => item);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true }, ssr: true,
    });

    const qc = makeQueryClient();
    const result: Task = await tasks.fetchGet(qc, 42);

    expect(result).toEqual(item);
  });

  it('fetchGet propagates errors (e.g., for 404 checks)', async () => {
    const axios = jest.fn().mockRejectedValue(new Error('Not found')) as any;
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true }, ssr: true,
    });

    const qc = makeQueryClient();
    await expect(tasks.fetchGet(qc, 42)).rejects.toThrow('Not found');
  });
});

// -- singleOptions / prefetchSingle / fetchSingle -----------------

describe('single SSR helpers', () => {
  it('singleOptions returns a queryKey and queryFn', () => {
    const axios = makeMockAxios(() => undefined);
    const stats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true }, ssr: true,
    });

    const opts = stats.singleOptions();
    expect(opts.queryKey).toEqual(['taskStats', 'single']);
    expect(typeof opts.queryFn).toBe('function');
  });

  it('prefetchSingle populates the single cache', async () => {
    const data: Stats = { open: 5, closed: 3 };
    const axios = makeMockAxios(() => data);
    const stats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true }, ssr: true,
    });

    const qc = makeQueryClient();
    await stats.prefetchSingle(qc);

    expect(qc.getQueryData(['taskStats', 'single'])).toEqual(data);
  });

  it('fetchSingle returns T', async () => {
    const data: Stats = { open: 5, closed: 3 };
    const axios = makeMockAxios(() => data);
    const stats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true }, ssr: true,
    });

    const qc = makeQueryClient();
    const result: Stats = await stats.fetchSingle(qc);

    expect(result).toEqual(data);
  });
});

// -- Conditional presence -----------------------------------------

describe('SSR helpers appear only when the action is configured', () => {
  it('no getList -> no listOptions/prefetchList/fetchList', () => {
    const axios = makeMockAxios(() => undefined);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    expect((tasks as any).listOptions).toBeUndefined();
    expect((tasks as any).prefetchList).toBeUndefined();
    expect((tasks as any).fetchList).toBeUndefined();
  });

  it('no get -> no detailOptions/prefetchGet/fetchGet', () => {
    const axios = makeMockAxios(() => undefined);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });

    expect((tasks as any).detailOptions).toBeUndefined();
    expect((tasks as any).prefetchGet).toBeUndefined();
    expect((tasks as any).fetchGet).toBeUndefined();
  });

  it('no getSingle -> no singleOptions/prefetchSingle/fetchSingle', () => {
    const axios = makeMockAxios(() => undefined);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });

    expect((tasks as any).singleOptions).toBeUndefined();
    expect((tasks as any).prefetchSingle).toBeUndefined();
    expect((tasks as any).fetchSingle).toBeUndefined();
  });
});

// -- Integration with TQ's dehydrate/hydrate ----------------------

describe('SSR: dehydrate -> hydrate round-trip', () => {
  it('server prefetch dehydrates, client hydrates and hits cache', async () => {
    // Server side
    const items: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: true },
    ];
    const serverAxios = makeMockAxios(() => items);
    const serverTasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios: serverAxios,
      actions: { getList: true }, ssr: true,
    });

    const serverQc = makeQueryClient();
    await serverTasks.prefetchList(serverQc);

    // Serialize
    const state = dehydrate(serverQc);

    // Client side - fresh queryClient, hydrate the server state
    const clientQc = makeQueryClient();
    hydrate(clientQc, state);

    // Cache hit without a network call
    expect(clientQc.getQueryData(['tasks', 'list', {}])).toEqual(items);
  });

  it('multiple resources can be prefetched into the same queryClient', async () => {
    const taskItems: Task[] = [{ id: 1, title: 'A', done: false }];
    const statsData: Stats = { open: 5, closed: 3 };
    const axios = makeMockAxios((c) => {
      if (c.url === '/tasks/stats') return statsData;
      if (c.url === '/tasks') return taskItems;
      return undefined;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true }, ssr: true,
    });
    const stats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true }, ssr: true,
    });

    const qc = makeQueryClient();
    await tasks.prefetchList(qc);
    await stats.prefetchSingle(qc);

    const state = dehydrate(qc);
    const clientQc = makeQueryClient();
    hydrate(clientQc, state);

    expect(clientQc.getQueryData(['tasks', 'list', {}])).toEqual(taskItems);
    expect(clientQc.getQueryData(['taskStats', 'single'])).toEqual(statsData);
  });
});
