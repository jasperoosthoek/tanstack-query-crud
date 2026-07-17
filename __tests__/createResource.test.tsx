import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

type Task = { id: number; title: string; done: boolean };

// -- Test helpers ---------------------------------------------------

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

// -- Conditional hook presence --------------------------------------

describe('createResource - conditional hook presence', () => {
  it('only exposes hooks for configured actions', () => {
    const axios = makeMockAxios();
    const readonly = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, get: true },
    });

    expect(typeof readonly.useList).toBe('function');
    expect(typeof readonly.useGet).toBe('function');
    expect((readonly as any).useCreate).toBeUndefined();
    expect((readonly as any).useUpdate).toBeUndefined();
    expect((readonly as any).useDelete).toBeUndefined();
    expect((readonly as any).useSingle).toBeUndefined();
  });

  it('exposes all six when all configured', () => {
    const axios = makeMockAxios();
    const full = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true, get: true, getSingle: true,
        create: true, update: true, delete: true,
      },
    });

    expect(typeof full.useList).toBe('function');
    expect(typeof full.useGet).toBe('function');
    expect(typeof full.useSingle).toBe('function');
    expect(typeof full.useCreate).toBe('function');
    expect(typeof full.useUpdate).toBe('function');
    expect(typeof full.useDelete).toBe('function');
  });
});

// -- useList --------------------------------------------------------

describe('useList', () => {
  it('GETs the route and returns the list', async () => {
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
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'get', url: '/tasks' })
    );
  });

  it('uses query key [name, "list"]', async () => {
    const axios = makeMockAxios(() => []);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // v0.5: params (even empty) always in the key
    expect(queryClient.getQueryData(['tasks', 'list', {}])).toEqual([]);
  });
});

// -- useGet ---------------------------------------------------------

describe('useGet', () => {
  it('GETs /route/{id} and returns the item', async () => {
    const item: Task = { id: 42, title: 'X', done: true };
    const axios = makeMockAxios(() => item);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useGet(42), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(item);
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'get', url: '/tasks/42' })
    );
  });

  it('supports string ids', async () => {
    const axios = makeMockAxios(() => ({ id: 'abc', title: 'X', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useGet('abc'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/tasks/abc' })
    );
  });

  it('uses query key [name, "detail", id]', async () => {
    const axios = makeMockAxios(() => ({ id: 42, title: 'X', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useGet(42), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['tasks', 'detail', 42])).toBeDefined();
  });
});

// -- useSingle ------------------------------------------------------

describe('useSingle', () => {
  it('GETs the route and returns a single item', async () => {
    const item = { open: 10, closed: 5 };
    const axios = makeMockAxios(() => item);
    const stats = createResource<typeof item>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => stats.useSingle(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(item);
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'get', url: '/tasks/stats' })
    );
  });

  it('uses query key [name, "single"]', async () => {
    const axios = makeMockAxios(() => ({ open: 10 }));
    const stats = createResource<{ open: number }>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => stats.useSingle(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(['taskStats', 'single'])).toEqual({ open: 10 });
  });
});

// -- useCreate ------------------------------------------------------

describe('useCreate', () => {
  it('POSTs to route with the payload', async () => {
    const created: Task = { id: 99, title: 'New', done: false };
    const axios = makeMockAxios(() => created);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    let returnValue: Task | undefined;
    await act(async () => {
      returnValue = await result.current.mutateAsync({ title: 'New', done: false });
    });

    expect(returnValue).toEqual(created);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(created);
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: '/tasks',
        data: { title: 'New', done: false },
      })
    );
  });
});

// -- useUpdate ------------------------------------------------------

describe('useUpdate', () => {
  it('PATCHes /route/{id} with the payload', async () => {
    const updated: Task = { id: 42, title: 'Updated', done: true };
    const axios = makeMockAxios(() => updated);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { update: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useUpdate(), { wrapper });

    let returnValue: Task | undefined;
    await act(async () => {
      returnValue = await result.current.mutateAsync({ id: 42, title: 'Updated' });
    });

    expect(returnValue).toEqual(updated);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(updated);
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'patch',
        url: '/tasks/42',
        data: { id: 42, title: 'Updated' },
      })
    );
  });
});

// -- useDelete ------------------------------------------------------

describe('useDelete', () => {
  it('DELETEs /route/{id}', async () => {
    const axios = makeMockAxios(() => undefined);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { delete: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useDelete(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 42 });
    });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'delete',
        url: '/tasks/42',
      })
    );
  });
});

// -- caller vs axios ------------------------------------------------

describe('caller alternative', () => {
  it('accepts a generic caller instead of axios', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const caller = jest.fn().mockResolvedValue({ data: items });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', caller,
      actions: { getList: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(items);
    expect(caller).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'get', url: '/tasks' })
    );
  });
});

// -- Error handling -------------------------------------------------

describe('error propagation', () => {
  it('surfaces query errors', async () => {
    const axios = jest.fn().mockRejectedValue(new Error('nope')) as any;
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('nope');
  });

  it('surfaces mutation errors', async () => {
    const axios = jest.fn().mockRejectedValue(new Error('mutation-fail')) as any;
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      try { await result.current.mutateAsync({ title: 'X' }); } catch (_) {}
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('mutation-fail');
  });
});
