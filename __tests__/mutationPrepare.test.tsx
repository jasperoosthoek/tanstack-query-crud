import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

// Mutation body/params transforms. `prepare` shapes the request body;
// `prepareParams` shapes the query string. Both run inside the
// generated mutationFn between the user's mutate() call and the caller.

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

describe('mutation prepare', () => {
  it('transforms request body on create', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'x', done: false }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: {
          prepare: (variables) => ({ payload: variables, meta: { ts: 1 } }),
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'x', done: false });
    });

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      data: { payload: { title: 'x', done: false }, meta: { ts: 1 } },
    }));
  });

  it('custom actions support prepare', async () => {
    const axios = makeMockAxios(() => ({ ok: true }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      customActions: {
        upload: {
          path: (v: { id: number; file: string }) => `/tasks/${v.id}/upload`,
          method: 'post',
          prepare: (v) => ({ filename: v.file, uploadedAt: 42 }),
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => (tasks as any).useUpload(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 7, file: 'a.txt' });
    });

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      url: '/tasks/7/upload',
      data: { filename: 'a.txt', uploadedAt: 42 },
    }));
  });
});

describe('mutation prepareParams', () => {
  it('adds query string to mutation request', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'x', done: false }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: {
          prepareParams: (variables) => ({ tenant: 'abc', title: variables.title }),
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'x', done: false });
    });

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      params: { tenant: 'abc', title: 'x' },
    }));
  });
});
