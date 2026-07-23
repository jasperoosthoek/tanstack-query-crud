import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource, useResourceUtils } from '../src';

type Task = { id: number; title: string; done: boolean };
type Stats = { open: number; closed: number };

function makeMockAxios(handler: (config: any) => any): jest.Mock & AxiosInstance {
  const fn = jest.fn().mockImplementation(async (config) => ({
    data: handler(config),
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
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidateSpy };
}

// -- Create with response-driven default --------------------------

describe('useCreate response-driven default', () => {
  it('appends the response to the list cache without invalidating', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const created: Task = { id: 2, title: 'B', done: false };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return created;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, create: true },
    });

    const { queryClient, wrapper, invalidateSpy } = makeWrapper();

    const both = renderHook(
      () => ({ list: tasks.useList(), cr: tasks.useCreate() }),
      { wrapper },
    );
    await waitFor(() => expect(both.result.current.list.isSuccess).toBe(true));
    expect(both.result.current.list.data).toEqual(initial);

    await act(async () => {
      await both.result.current.cr.mutateAsync({ title: 'B', done: false });
    });
    await waitFor(() => expect(both.result.current.cr.isSuccess).toBe(true));

    // List cache updated locally, no invalidation, no refetch
    expect(both.result.current.list.data).toEqual([...initial, created]);
    expect(queryClient.getQueryData(['tasks', 'list', {}])).toEqual([...initial, created]);
    expect(invalidateSpy).not.toHaveBeenCalled();

    // Only one GET (the initial), one POST (the create) - no refetch
    const getCount = axios.mock.calls.filter((c) => c[0].method === 'get').length;
    const postCount = axios.mock.calls.filter((c) => c[0].method === 'post').length;
    expect(getCount).toBe(1);
    expect(postCount).toBe(1);
  });

  it('sets the detail cache from the response', async () => {
    const created: Task = { id: 99, title: 'X', done: false };
    const axios = makeMockAxios(() => created);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { queryClient, wrapper } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'X', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['tasks', 'detail', 99])).toEqual(created);
  });
});

// -- Update with response-driven default --------------------------

describe('useUpdate response-driven default', () => {
  it('replaces the item in list caches with the response', async () => {
    const initial: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: false },
    ];
    const updated: Task = { id: 1, title: 'A-updated', done: true };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return updated;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, update: true },
    });

    const { queryClient, wrapper, invalidateSpy } = makeWrapper();

    // Both hooks in the same component so they share React lifecycle.
    // (Separate renderHook calls create isolated trees, which is a
    // testing artifact - real users have one component tree.)
    const both = renderHook(
      () => ({ list: tasks.useList(), upd: tasks.useUpdate() }),
      { wrapper },
    );
    await waitFor(() => expect(both.result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await both.result.current.upd.mutateAsync({ id: 1, title: 'A-updated', done: true });
    });
    await waitFor(() => expect(both.result.current.upd.isSuccess).toBe(true));

    expect(both.result.current.list.data).toEqual([updated, initial[1]]);
    expect(queryClient.getQueryData(['tasks', 'list', {}])).toEqual([updated, initial[1]]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('updates the detail cache from the response', async () => {
    const updated: Task = { id: 1, title: 'A-updated', done: true };
    const axios = makeMockAxios(() => updated);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { update: true },
    });

    const { queryClient, wrapper } = makeWrapper();

    // Seed detail cache manually
    queryClient.setQueryData(['tasks', 'detail', 1], { id: 1, title: 'old', done: false });

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'A-updated', done: true });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['tasks', 'detail', 1])).toEqual(updated);
  });
});

// -- Delete with response-driven default --------------------------

describe('useDelete response-driven default', () => {
  it('removes the item from list caches by id', async () => {
    const initial: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: false },
    ];

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return undefined;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, delete: true },
    });

    const { queryClient, wrapper, invalidateSpy } = makeWrapper();
    const both = renderHook(
      () => ({ list: tasks.useList(), del: tasks.useDelete() }),
      { wrapper },
    );
    await waitFor(() => expect(both.result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await both.result.current.del.mutateAsync({ id: 1 });
    });
    await waitFor(() => expect(both.result.current.del.isSuccess).toBe(true));

    expect(both.result.current.list.data).toEqual([initial[1]]);
    expect(queryClient.getQueryData(['tasks', 'list', {}])).toEqual([initial[1]]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('removes the detail cache', async () => {
    const axios = makeMockAxios(() => undefined);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { delete: true },
    });

    const { queryClient, wrapper } = makeWrapper();

    // Seed the detail cache
    queryClient.setQueryData(['tasks', 'detail', 42], { id: 42, title: 'X', done: false });

    const deleteHook = renderHook(() => tasks.useDelete(), { wrapper });
    await act(async () => {
      await deleteHook.result.current.mutateAsync({ id: 42 });
    });
    await waitFor(() => expect(deleteHook.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['tasks', 'detail', 42])).toBeUndefined();
  });
});

// -- Explicit invalidates opts OUT of response-driven -------------

describe('explicit invalidates skips response-driven', () => {
  it('invalidates: "all" triggers invalidation, no local cache update', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const created: Task = { id: 2, title: 'B', done: false };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return created;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        create: { invalidates: 'all' },  // opt into old behavior
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();
    const listHook = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'B', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    // Invalidation ran
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('invalidates: ["list"] uses invalidation, skips response-driven', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: false }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: { invalidates: ['list'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'X', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });

  it('invalidates: [] does nothing (no response-driven, no invalidation)', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const created: Task = { id: 2, title: 'B', done: false };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return created;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        create: { invalidates: [] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();
    const listHook = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'B', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    // No update, no invalidation
    expect(listHook.result.current.data).toEqual(initial);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('update: invalidates: ["list"] uses invalidation, skips response-driven', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const updated: Task = { id: 1, title: 'A-updated', done: true };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return updated;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        update: { invalidates: ['list'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();
    const listHook = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'A-updated', done: true });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    // No local splice - the list is unchanged until invalidation refetches
    expect(listHook.result.current.data).toEqual(initial);
  });

  it('delete: invalidates: ["list"] uses invalidation, skips response-driven', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return undefined;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        delete: { invalidates: ['list'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();
    const listHook = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));

    const deleteHook = renderHook(() => tasks.useDelete(), { wrapper });
    await act(async () => {
      await deleteHook.result.current.mutateAsync({ id: 1 });
    });
    await waitFor(() => expect(deleteHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    // No local removal - the list is unchanged until invalidation refetches
    expect(listHook.result.current.data).toEqual(initial);
  });
});

// -- Cross-resource additive with response-driven -----------------

describe('cross-resource invalidation is additive with response-driven', () => {
  it('resource reference invalidates other resource + keeps response-driven local update', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const created: Task = { id: 2, title: 'B', done: false };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get' && c.url === '/tasks') return initial;
      if (c.method === 'get' && c.url === '/tasks/stats') return { open: 3, closed: 1 };
      return created;
    });

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        create: { invalidates: [taskStats] },  // cross-resource only
      },
    });

    const { queryClient, wrapper, invalidateSpy } = makeWrapper();
    const both = renderHook(
      () => ({ list: tasks.useList(), cr: tasks.useCreate() }),
      { wrapper },
    );
    await waitFor(() => expect(both.result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await both.result.current.cr.mutateAsync({ title: 'B', done: false });
    });
    await waitFor(() => expect(both.result.current.cr.isSuccess).toBe(true));

    // Local update happened (response-driven)
    expect(both.result.current.list.data).toEqual([...initial, created]);
    expect(queryClient.getQueryData(['tasks', 'list', {}])).toEqual([...initial, created]);
    // taskStats was invalidated (cross-resource)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats'] });
    // But this resource's queries were NOT invalidated
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });

  it('update: resource reference invalidates other resource + keeps response-driven local update', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const updated: Task = { id: 1, title: 'A-updated', done: true };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get' && c.url === '/tasks') return initial;
      if (c.method === 'get' && c.url === '/tasks/stats') return { open: 3, closed: 1 };
      return updated;
    });

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        update: { invalidates: [taskStats] },  // cross-resource only
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();
    const both = renderHook(
      () => ({ list: tasks.useList(), upd: tasks.useUpdate() }),
      { wrapper },
    );
    await waitFor(() => expect(both.result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await both.result.current.upd.mutateAsync({ id: 1, title: 'A-updated', done: true });
    });
    await waitFor(() => expect(both.result.current.upd.isSuccess).toBe(true));

    // Local splice happened (response-driven)
    expect(both.result.current.list.data).toEqual([updated]);
    // taskStats was invalidated (cross-resource)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats'] });
    // But this resource's queries were NOT invalidated
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });

  it('delete: resource reference invalidates other resource + keeps response-driven local removal', async () => {
    const initial: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: false },
    ];

    const axios = makeMockAxios((c) => {
      if (c.method === 'get' && c.url === '/tasks') return initial;
      if (c.method === 'get' && c.url === '/tasks/stats') return { open: 3, closed: 1 };
      return undefined;
    });

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        delete: { invalidates: [taskStats] },  // cross-resource only
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();
    const both = renderHook(
      () => ({ list: tasks.useList(), del: tasks.useDelete() }),
      { wrapper },
    );
    await waitFor(() => expect(both.result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await both.result.current.del.mutateAsync({ id: 1 });
    });
    await waitFor(() => expect(both.result.current.del.isSuccess).toBe(true));

    // Local removal happened (response-driven)
    expect(both.result.current.list.data).toEqual([initial[1]]);
    // taskStats was invalidated (cross-resource)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats'] });
    // But this resource's queries were NOT invalidated
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });
});

// -- Paginated resources fall back to invalidation ----------------

describe('paginated resource falls back to invalidation', () => {
  it('create on a paginated resource still triggers invalidation', async () => {
    type DjangoPage<T> = { count: number; results: T[] };

    const initial: DjangoPage<Task> = {
      count: 1,
      results: [{ id: 1, title: 'A', done: false }],
    };
    const created: Task = { id: 2, title: 'B', done: false };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return created;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r: DjangoPage<Task>) => r.results,
            extractMeta: (r: DjangoPage<Task>) => ({ count: r.count }),
          },
        },
        create: true,
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'B', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    // Paginated: invalidation ran
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('update on a paginated resource still triggers invalidation', async () => {
    type DjangoPage<T> = { count: number; results: T[] };

    const initial: DjangoPage<Task> = {
      count: 1,
      results: [{ id: 1, title: 'A', done: false }],
    };
    const updated: Task = { id: 1, title: 'A-updated', done: true };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return updated;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r: DjangoPage<Task>) => r.results,
            extractMeta: (r: DjangoPage<Task>) => ({ count: r.count }),
          },
        },
        update: true,
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'A-updated', done: true });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    // Paginated: can't safely splice a fixed-offset page, so invalidation ran instead
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('delete on a paginated resource still triggers invalidation', async () => {
    type DjangoPage<T> = { count: number; results: T[] };

    const initial: DjangoPage<Task> = {
      count: 1,
      results: [{ id: 1, title: 'A', done: false }],
    };

    const axios = makeMockAxios((c) => {
      if (c.method === 'get') return initial;
      return undefined;
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          pagination: {
            defaultLimit: 20,
            extractItems: (r: DjangoPage<Task>) => r.results,
            extractMeta: (r: DjangoPage<Task>) => ({ count: r.count }),
          },
        },
        delete: true,
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const deleteHook = renderHook(() => tasks.useDelete(), { wrapper });
    await act(async () => {
      await deleteHook.result.current.mutateAsync({ id: 1 });
    });
    await waitFor(() => expect(deleteHook.result.current.isSuccess).toBe(true));

    // Paginated: can't safely splice a fixed-offset page, so invalidation ran instead
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });
});
