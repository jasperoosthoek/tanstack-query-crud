import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

// -- Verify id extraction handles common id types cleanly ---------
// This tests the ZCR-borrowed pattern: (item as Record<string, unknown>)['id']
// with String() coercion for non-primitive values.

function makeAxios(handler: (config: any) => any): jest.Mock & AxiosInstance {
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
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('id extraction', () => {
  it('handles integer ids', async () => {
    type Task = { id: number; title: string };
    const created: Task = { id: 42, title: 'X' };
    const axios = makeAxios(() => created);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ title: 'X' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Detail cache keyed by the integer id
    expect(queryClient.getQueryData(['tasks', 'detail', 42])).toEqual(created);
  });

  it('handles string ids (UUIDs, slugs)', async () => {
    type Task = { id: string; title: string };
    const created: Task = { id: 'abc-123', title: 'X' };
    const axios = makeAxios(() => created);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ title: 'X' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['tasks', 'detail', 'abc-123'])).toEqual(created);
  });

  it('response with no id field skips detail cache write', async () => {
    // Server returns success with no id field (unusual but possible)
    type Task = { title: string };
    const created = { title: 'X' } as Task;
    const axios = makeAxios(() => created);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => { await result.current.mutateAsync({}); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // No detail cache entry - id was undefined
    const allDetailKeys = queryClient.getQueriesData({ queryKey: ['tasks', 'detail'] });
    expect(allDetailKeys).toEqual([]);
  });

  it('coerces a non-primitive id (bigint) to a string for the cache key', async () => {
    // extractId's fast path only returns the value as-is for typeof
    // 'string' | 'number'; anything else (bigint, boolean, object) falls
    // through to String(v). bigint is a clean, unambiguous case of that.
    type BigTask = { id: bigint; title: string };
    const created: BigTask = { id: 10n, title: 'X' };
    const axios = makeAxios(() => created);

    const items = createResource<BigTask>()({
      name: 'items', route: '/items', axios,
      actions: { create: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => items.useCreate(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ title: 'X' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['items', 'detail', '10'])).toEqual(created);
  });

  it('update matches items in list by id even with different reference identity', async () => {
    // Verify extractId is used for the comparison, not reference equality
    type Task = { id: number; title: string; done: boolean };
    const initial: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: false },
    ];
    const updated: Task = { id: 1, title: 'A-updated', done: true };

    const axios = makeAxios((c) => c.method === 'get' ? initial : updated);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, update: true },
    });

    const { wrapper } = makeWrapper();
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
  });

  it('delete matches items in list by id', async () => {
    type Task = { id: number; title: string };
    const initial: Task[] = [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ];

    const axios = makeAxios((c) => c.method === 'get' ? initial : undefined);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, delete: true },
    });

    const { wrapper } = makeWrapper();
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
  });

  it('constructs update URL from the id field', async () => {
    type Task = { id: string; title: string };
    const axios = makeAxios(() => ({ id: 'my-slug', title: 'X' }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { update: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'my-slug', title: 'X' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'patch', url: '/tasks/my-slug' })
    );
  });

  it('constructs delete URL from the id field', async () => {
    type Task = { id: string; title: string };
    const axios = makeAxios(() => undefined);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { delete: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useDelete(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: 'my-slug' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'delete', url: '/tasks/my-slug' })
    );
  });
});

// -- Configurable id field name ------------------------------------
// The default is 'id'; users can point at any other field via
// `id: 'fieldName'`. All id-based cache and URL work follows.

type TaskUuid = { uuid: string; title: string; done: boolean };

describe('id field configurable via `id: fieldName`', () => {
  it('uses the configured field for detail cache keys', async () => {
    const item: TaskUuid = { uuid: 'abc-123', title: 'X', done: false };
    const axios = makeAxios(() => item);

    const tasks = createResource<TaskUuid>()({
      name: 'tasks', route: '/tasks', axios,
      id: 'uuid',
      actions: { get: true, create: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'X', done: false });
    });

    expect(queryClient.getQueryData(['tasks', 'detail', 'abc-123'])).toEqual(item);
  });

  it('response-driven list updates match on the custom id field', async () => {
    const initial: TaskUuid[] = [{ uuid: 'a', title: 'A', done: false }];
    const updated: TaskUuid = { uuid: 'a', title: 'A2', done: true };
    const axios = makeAxios((c) => (c.method === 'patch' ? updated : initial));

    const tasks = createResource<TaskUuid>()({
      name: 'tasks', route: '/tasks', axios,
      id: 'uuid',
      actions: { getList: true, update: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({ list: tasks.useList(), update: tasks.useUpdate() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await result.current.update.mutateAsync({ uuid: 'a', title: 'A2', done: true });
    });

    expect(queryClient.getQueryData<TaskUuid[]>(['tasks', 'list', {}])).toEqual([updated]);
  });

  it('defaults to `id` when not configured', async () => {
    type Task = { id: number; title: string; done: boolean };
    const created: Task = { id: 42, title: 'X', done: false };
    const axios = makeAxios(() => created);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'X', done: false });
    });

    expect(queryClient.getQueryData(['tasks', 'detail', 42])).toEqual(created);
  });
});
