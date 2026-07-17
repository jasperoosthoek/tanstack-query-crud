import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

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

// -- Presence -------------------------------------------------------

describe('custom action hook presence', () => {
  it('generates a use${Capitalize<Name>}() hook per custom action', () => {
    const axios = makeMockAxios();
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {},
      customActions: {
        approve: { path: (t: Task) => `/tasks/${t.id}/approve`, method: 'post' },
        reject: { path: (t: Task) => `/tasks/${t.id}/reject`, method: 'post' },
      },
    });

    expect(typeof tasks.useApprove).toBe('function');
    expect(typeof tasks.useReject).toBe('function');
    expect((tasks as any).useSomethingElse).toBeUndefined();
  });

  it('preserves multi-word action names (only first letter capitalized)', () => {
    const axios = makeMockAxios();
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {},
      customActions: {
        markComplete: { path: '/tasks/mark-complete', method: 'post' },
      },
    });

    expect(typeof tasks.useMarkComplete).toBe('function');
  });

  it('no custom actions → no custom hooks', () => {
    const axios = makeMockAxios();
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });

    expect((tasks as any).useApprove).toBeUndefined();
  });
});

// -- Runtime behavior -----------------------------------------------

describe('custom action runtime', () => {
  it('function path - resolves URL from variables', async () => {
    const axios = makeMockAxios(() => ({ id: 42, title: 'X', done: true }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {},
      customActions: {
        approve: {
          path: (t: Task) => `/tasks/${t.id}/approve`,
          method: 'post',
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useApprove(), { wrapper });

    let returnValue: Task | undefined;
    await act(async () => {
      returnValue = await result.current.mutateAsync({ id: 42, title: 'X', done: false });
    });

    expect(returnValue).toEqual({ id: 42, title: 'X', done: true });
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: '/tasks/42/approve',
        data: { id: 42, title: 'X', done: false },
      })
    );
  });

  it('string path - used as-is', async () => {
    const axios = makeMockAxios(() => ({ reset: true }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {},
      customActions: {
        reset: {
          path: '/tasks/reset-all',
          method: 'post',
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useReset(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({});
    });

    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'post',
        url: '/tasks/reset-all',
        data: {},
      })
    );
  });

  it('supports different HTTP methods', async () => {
    const axios = makeMockAxios(() => undefined);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {},
      customActions: {
        replace: { path: (t: Task) => `/tasks/${t.id}`, method: 'put' },
        patchOne: { path: (t: Task) => `/tasks/${t.id}`, method: 'patch' },
        removeOne: { path: (t: Task) => `/tasks/${t.id}`, method: 'delete' },
      },
    });

    const { wrapper } = makeWrapper();

    const putHook = renderHook(() => tasks.useReplace(), { wrapper });
    await act(async () => {
      await putHook.result.current.mutateAsync({ id: 1, title: 'X', done: false });
    });
    expect(axios).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'put', url: '/tasks/1' })
    );

    const patchHook = renderHook(() => tasks.usePatchOne(), { wrapper });
    await act(async () => {
      await patchHook.result.current.mutateAsync({ id: 2, title: 'X', done: false });
    });
    expect(axios).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'patch', url: '/tasks/2' })
    );

    const deleteHook = renderHook(() => tasks.useRemoveOne(), { wrapper });
    await act(async () => {
      await deleteHook.result.current.mutateAsync({ id: 3, title: 'X', done: false });
    });
    expect(axios).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'delete', url: '/tasks/3' })
    );
  });

  it('surfaces mutation errors', async () => {
    const axios = jest.fn().mockRejectedValue(new Error('approve-failed')) as any;
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {},
      customActions: {
        approve: { path: '/tasks/approve', method: 'post' },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useApprove(), { wrapper });

    await act(async () => {
      try { await result.current.mutateAsync({}); } catch (_) {}
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('approve-failed');
  });

  it('coexists with standard actions', async () => {
    const axios = makeMockAxios((config) =>
      config.url === '/tasks' ? [] : { approved: true }
    );
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true, create: true },
      customActions: {
        approve: { path: (t: Task) => `/tasks/${t.id}/approve`, method: 'post' },
      },
    });

    // All three exist
    expect(typeof tasks.useList).toBe('function');
    expect(typeof tasks.useCreate).toBe('function');
    expect(typeof tasks.useApprove).toBe('function');

    // useList works
    const { wrapper } = makeWrapper();
    const listHook = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));
    expect(listHook.result.current.data).toEqual([]);

    // useApprove works. Default invalidation may trigger a refetch after,
    // so check that the approve POST was one of the calls (not the last).
    const approveHook = renderHook(() => tasks.useApprove(), { wrapper });
    await act(async () => {
      await approveHook.result.current.mutateAsync({ id: 5, title: 'X', done: false });
    });
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'post', url: '/tasks/5/approve' })
    );
  });
});
