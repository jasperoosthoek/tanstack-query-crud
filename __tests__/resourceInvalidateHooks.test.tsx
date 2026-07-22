import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

type Task = { id: number; title: string; done: boolean };

function makeMockAxios(response: unknown = undefined): jest.Mock & AxiosInstance {
  return jest.fn().mockResolvedValue({ data: response }) as any;
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('resource invalidate hooks', () => {
  it('useInvalidate is present on every resource shape', () => {
    // Full CRUD
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios: makeMockAxios(),
      actions: { getList: true, get: true, create: true, update: true, delete: true },
    });
    expect(typeof tasks.useInvalidate).toBe('function');
    expect(typeof tasks.useInvalidateList).toBe('function');
    expect(typeof tasks.useInvalidateDetail).toBe('function');

    // Action-only resource
    const auth = createResource<{ id: never }>()({
      name: 'auth', route: '/auth', axios: makeMockAxios(),
      actions: {},
      customActions: {
        login: { path: '/auth/login', method: 'post' },
      },
    });
    expect(typeof auth.useInvalidate).toBe('function');
    expect((auth as any).useInvalidateList).toBeUndefined();
    expect((auth as any).useInvalidateDetail).toBeUndefined();

    // getList only
    const listOnly = createResource<Task>()({
      name: 'listOnly', route: '/list', axios: makeMockAxios(),
      actions: { getList: true },
    });
    expect(typeof listOnly.useInvalidate).toBe('function');
    expect(typeof listOnly.useInvalidateList).toBe('function');
    expect((listOnly as any).useInvalidateDetail).toBeUndefined();

    // get only
    const getOnly = createResource<Task>()({
      name: 'getOnly', route: '/get', axios: makeMockAxios(),
      actions: { get: true },
    });
    expect(typeof getOnly.useInvalidate).toBe('function');
    expect((getOnly as any).useInvalidateList).toBeUndefined();
    expect(typeof getOnly.useInvalidateDetail).toBe('function');
  });

  it('useInvalidate marks all resource queries stale', async () => {
    const axios = makeMockAxios([{ id: 1, title: 'a', done: false }]);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, get: true },
    });
    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(
      () => ({
        list: tasks.useList(),
        invalidate: tasks.useInvalidate(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    axios.mockClear();

    act(() => { result.current.invalidate(); });

    await waitFor(() => expect(axios).toHaveBeenCalledTimes(1));
    // Confirms query key matches [name, ...]
    const cache = queryClient.getQueryCache().findAll({ queryKey: ['tasks'] });
    expect(cache.length).toBeGreaterThan(0);
  });

  it('useInvalidateList marks only list queries stale, not detail', async () => {
    const axios = makeMockAxios([]);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, get: true },
    });
    const { queryClient, wrapper } = makeWrapper();

    // Seed both list and detail cache
    queryClient.setQueryData(['tasks', 'list', {}], [{ id: 1, title: 'a', done: false }]);
    queryClient.setQueryData(['tasks', 'detail', 1], { id: 1, title: 'a', done: false });

    const { result } = renderHook(() => tasks.useInvalidateList(), { wrapper });
    act(() => { result.current(); });

    // List query is marked stale, detail is not
    const listState = queryClient.getQueryState(['tasks', 'list', {}]);
    const detailState = queryClient.getQueryState(['tasks', 'detail', 1]);
    expect(listState?.isInvalidated).toBe(true);
    expect(detailState?.isInvalidated).toBe(false);
  });

  it('useInvalidateDetail with id marks only that detail stale', async () => {
    const axios = makeMockAxios();
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, get: true },
    });
    const { queryClient, wrapper } = makeWrapper();

    queryClient.setQueryData(['tasks', 'list', {}], []);
    queryClient.setQueryData(['tasks', 'detail', 1], { id: 1, title: 'a', done: false });
    queryClient.setQueryData(['tasks', 'detail', 2], { id: 2, title: 'b', done: true });

    const { result } = renderHook(() => tasks.useInvalidateDetail(), { wrapper });
    act(() => { result.current(1); });

    expect(queryClient.getQueryState(['tasks', 'detail', 1])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['tasks', 'detail', 2])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(['tasks', 'list', {}])?.isInvalidated).toBe(false);
  });

  it('useInvalidateDetail without id marks all details stale', async () => {
    const axios = makeMockAxios();
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, get: true },
    });
    const { queryClient, wrapper } = makeWrapper();

    queryClient.setQueryData(['tasks', 'detail', 1], { id: 1, title: 'a', done: false });
    queryClient.setQueryData(['tasks', 'detail', 2], { id: 2, title: 'b', done: true });

    const { result } = renderHook(() => tasks.useInvalidateDetail(), { wrapper });
    act(() => { result.current(); });

    expect(queryClient.getQueryState(['tasks', 'detail', 1])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['tasks', 'detail', 2])?.isInvalidated).toBe(true);
  });
});
