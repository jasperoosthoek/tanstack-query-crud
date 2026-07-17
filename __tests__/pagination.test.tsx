import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

type Task = { id: number; title: string; done: boolean };

// Django REST-style paginated response
type DjangoPaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

function makeMockAxios(handler?: (config: any) => any): jest.Mock & AxiosInstance {
  const fn = jest.fn().mockImplementation(async (config) => ({
    data: handler ? handler(config) : undefined,
  }));
  return fn as any;
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

// -- Non-paginated useList (v0.5: still supports params) -----------

describe('useList without pagination (v0.5 backwards compat)', () => {
  it('still works without params', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(items);
    // No pagination field when not configured
    expect((result.current as any).pagination).toBeUndefined();
  });

  it('accepts params that flow into axios and query key', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList({ status: 'open' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        url: '/tasks',
        params: { status: 'open' },
      })
    );

    // Cache keyed with params
    expect(
      queryClient.getQueryData(['tasks', 'list', { status: 'open' }])
    ).toEqual(items);
  });
});

// -- Paginated useList ---------------------------------------------

describe('useList with pagination configured', () => {
  it('applies extractItems and extractMeta on the response', async () => {
    const response: DjangoPaginatedResponse<Task> = {
      count: 42,
      next: '/tasks/?offset=20',
      previous: null,
      results: [
        { id: 1, title: 'A', done: false },
        { id: 2, title: 'B', done: true },
      ],
    };
    const axios = makeMockAxios(() => response);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r) => r.results,
            extractMeta: (r) => ({ count: r.count }),
          },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(response.results);
    expect(result.current.pagination).toEqual({
      count: 42,
      offset: 0,
      limit: 20,
    });
  });

  it('uses default limit when params omit it', async () => {
    const axios = makeMockAxios(() => ({ count: 0, results: [] }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 50,
            extractItems: (r) => r.results,
            extractMeta: (r) => ({ count: r.count }),
          },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { offset: 0, limit: 50 },
      })
    );
  });

  it('accepts explicit offset and limit', async () => {
    const axios = makeMockAxios(() => ({ count: 100, results: [] }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r) => r.results,
            extractMeta: (r) => ({ count: r.count }),
          },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList({ offset: 40, limit: 10 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { offset: 40, limit: 10 },
      })
    );
    expect(result.current.pagination).toEqual({
      count: 100,
      offset: 40,
      limit: 10,
    });
  });

  it('runs prepareParams to transform pagination fields for the wire', async () => {
    const axios = makeMockAxios(() => ({ total: 100, items: [] }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            // Page-based server
            prepareParams: (p) => ({
              page: Math.floor(p.offset / p.limit) + 1,
              per_page: p.limit,
            }),
            extractItems: (r) => r.items,
            extractMeta: (r) => ({ count: r.total }),
          },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList({ offset: 40, limit: 20 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Wire uses page/per_page, not offset/limit
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { page: 3, per_page: 20 },
      })
    );
    // But return pagination is in offset/limit form
    expect(result.current.pagination).toEqual({
      count: 100,
      offset: 40,
      limit: 20,
    });
  });

  it('merges filter fields alongside pagination', async () => {
    const axios = makeMockAxios(() => ({ count: 0, results: [] }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r) => r.results,
            extractMeta: (r) => ({ count: r.count }),
          },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList({ status: 'open', assignee: 42 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          status: 'open',
          assignee: 42,
          offset: 0,
          limit: 20,
        },
      })
    );
  });

  it('different params produce different cache entries', async () => {
    const axios = makeMockAxios(() => ({ count: 0, results: [] }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r) => r.results,
            extractMeta: (r) => ({ count: r.count }),
          },
        },
      },
    });

    const { queryClient, wrapper } = makeWrapper();
    const page1 = renderHook(
      () => tasks.useList({ offset: 0, limit: 20 }),
      { wrapper }
    );
    const page2 = renderHook(
      () => tasks.useList({ offset: 20, limit: 20 }),
      { wrapper }
    );
    await waitFor(() => expect(page1.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(page2.result.current.isSuccess).toBe(true));

    // Both cache entries exist independently
    expect(queryClient.getQueryData(['tasks', 'list', { offset: 0, limit: 20 }]))
      .toBeDefined();
    expect(queryClient.getQueryData(['tasks', 'list', { offset: 20, limit: 20 }]))
      .toBeDefined();
  });
});

// -- usePaginatedList helper ---------------------------------------

describe('usePaginatedList', () => {
  const tasksResponse = (offset = 0, limit = 20, total = 100): DjangoPaginatedResponse<Task> => ({
    count: total,
    next: offset + limit < total ? '/tasks/?next' : null,
    previous: offset > 0 ? '/tasks/?prev' : null,
    results: Array.from({ length: Math.min(limit, total - offset) }, (_, i) => ({
      id: offset + i,
      title: `T${offset + i}`,
      done: false,
    })),
  });

  const makeTasks = (axios: any) =>
    createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r) => r.results,
            extractMeta: (r) => ({ count: r.count }),
          },
        },
      },
    });

  it('returns pagination + navigation controls', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.usePaginatedList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.offset).toBe(0);
    expect(result.current.limit).toBe(20);
    expect(result.current.pagination).toEqual({ count: 100, offset: 0, limit: 20 });
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);
  });

  it('next() advances offset by limit', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.usePaginatedList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => result.current.next());
    expect(result.current.offset).toBe(20);
    await waitFor(() => expect(result.current.pagination.offset).toBe(20));
    expect(result.current.hasPrev).toBe(true);
  });

  it('prev() decreases offset by limit', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.usePaginatedList({ initialOffset: 40 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.offset).toBe(40);

    act(() => result.current.prev());
    expect(result.current.offset).toBe(20);
  });

  it('goto(n) jumps to page n', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.usePaginatedList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    act(() => result.current.goto(3));
    // page 3 with limit 20 = offset 60
    expect(result.current.offset).toBe(60);
  });

  it('setLimit resets offset to 0', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.usePaginatedList({ initialOffset: 40 }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.offset).toBe(40);

    act(() => result.current.setLimit(50));
    expect(result.current.limit).toBe(50);
    expect(result.current.offset).toBe(0);
  });

  it('hasNext is false on the last page', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 50)  // total: 50
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.usePaginatedList({ initialOffset: 40 }),  // offset 40, limit 20 -> reaches end
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // offset 40 + limit 20 = 60 > count 50, so hasNext is false
    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrev).toBe(true);
  });

  it('filter change resets offset', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      ({ filters }) => tasks.usePaginatedList({ filters, initialOffset: 40 }),
      {
        wrapper,
        initialProps: { filters: { status: 'open' } },
      }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.offset).toBe(40);

    // Change filters
    rerender({ filters: { status: 'closed' } });

    // Offset should have been reset to 0
    await waitFor(() => expect(result.current.offset).toBe(0));
  });

  it('sends filter fields alongside pagination', async () => {
    const axios = makeMockAxios((c) =>
      tasksResponse(c.params.offset, c.params.limit, 100)
    );
    const tasks = makeTasks(axios);

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.usePaginatedList({ filters: { status: 'open' } }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          status: 'open',
          offset: 0,
          limit: 20,
        },
      })
    );
  });
});

// -- Presence checks -----------------------------------------------

describe('conditional hook presence', () => {
  it('usePaginatedList only exists when pagination is configured', () => {
    const axios = makeMockAxios(() => []);

    const withoutPagination = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    expect((withoutPagination as any).usePaginatedList).toBeUndefined();

    const withPagination = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
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

    expect(typeof withPagination.usePaginatedList).toBe('function');
  });
});
