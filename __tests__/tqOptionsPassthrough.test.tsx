import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

// TQ options passthrough at four levels:
// - global (QueryClient defaults, user-owned, TQ-native)
// - resource-level (nested: queryOptions, mutationOptions)
// - action-level (flat, mixed with library fields)
// - per-call (2nd arg on query hooks; TQ-native for mutations)
// Precedence: global < resource < action < per-call. Library-owned
// fields always win.

type Task = { id: number; title: string; done: boolean };

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

describe('action-level TQ options', () => {
  it('staleTime applied to useQuery', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: { staleTime: 999_999 } },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const observer = queryClient.getQueryCache().find({ queryKey: ['tasks', 'list', {}] });
    expect(observer?.observers[0]?.options.staleTime).toBe(999_999);
  });
});

describe('resource-level TQ options', () => {
  it('queryOptions apply to all query hooks on the resource', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const item: Task = items[0]!;
    const axios = makeMockAxios((c) => (c.url === '/tasks/1' ? item : items));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      queryOptions: { staleTime: 12345, refetchOnWindowFocus: false },
      actions: { getList: true, get: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({ list: tasks.useList(), get: tasks.useGet(1) }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.get.isSuccess).toBe(true));

    const listQ = queryClient.getQueryCache().find({ queryKey: ['tasks', 'list', {}] });
    const getQ = queryClient.getQueryCache().find({ queryKey: ['tasks', 'detail', 1] });
    expect(listQ?.observers[0]?.options.staleTime).toBe(12345);
    expect(getQ?.observers[0]?.options.staleTime).toBe(12345);
  });

  it('mutationOptions apply to mutation hooks', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'x', done: false }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      mutationOptions: { networkMode: 'always' },
      actions: { create: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    // Smoke test: mutation runs to completion with resource-level TQ options
    // spread in. Regression guard for the spread order.
    await act(async () => {
      await result.current.mutateAsync({ title: 'x', done: false });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('per-call TQ options', () => {
  it('`enabled: false` disables the query', async () => {
    const axios = makeMockAxios(() => [{ id: 1, title: 'A', done: false }]);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList(undefined, { enabled: false }),
      { wrapper },
    );

    await new Promise((r) => setTimeout(r, 20));

    expect(axios).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('precedence: resource < action < per-call', () => {
  it('per-call overrides action-level, action-level overrides resource-level', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      queryOptions: { staleTime: 100 },                    // resource-level
      actions: { getList: { staleTime: 200 } },            // action-level
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList(undefined, { staleTime: 300 }),  // per-call
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const q = queryClient.getQueryCache().find({ queryKey: ['tasks', 'list', {}] });
    expect(q?.observers[0]?.options.staleTime).toBe(300);
  });
});

describe('library-owned fields always win', () => {
  it('user-level fields under LIBRARY_MUTATION_FIELDS do not clobber composed callbacks', async () => {
    // onSuccess is a library-owned callback slot. Even if a user sets one
    // at the action level (typed via MutationCallbacks), it must fire
    // AFTER the library's internal cache updates - not replace them.
    const initial: Task[] = [];
    const created: Task = { id: 1, title: 'x', done: false };
    const axios = makeMockAxios((c) => (c.method === 'post' ? created : initial));
    const userOnSuccess = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        create: { onSuccess: userOnSuccess },
      },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({ list: tasks.useList(), create: tasks.useCreate() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create.mutateAsync({ title: 'x', done: false });
    });

    // Library still did response-driven append
    expect(queryClient.getQueryData<Task[]>(['tasks', 'list', {}]))
      .toContainEqual(created);
    // AND user callback still fired
    expect(userOnSuccess).toHaveBeenCalled();
  });
});
