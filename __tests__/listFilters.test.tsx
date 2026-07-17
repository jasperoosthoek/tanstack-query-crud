import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

// Typed filter params on useList via getList.prepareParams. The
// parameter type of `prepareParams` is the source of truth for
// `useList`'s first arg type. Filter transform composes with pagination
// prepareParams.

type Task = { id: number; title: string; done: boolean };
type TaskFilters = { status?: 'open' | 'closed'; assignee?: number };

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

describe('useList typed filter params via prepareParams', () => {
  it('applies filter prepareParams to the wire', async () => {
    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(() => items);

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          prepareParams: (filters: TaskFilters) => ({
            status_eq: filters.status,
            assignee_id: filters.assignee,
          }),
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => tasks.useList({ status: 'open', assignee: 42 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      params: { status_eq: 'open', assignee_id: 42 },
    }));
  });

  it('composes filter prepareParams with pagination prepareParams', async () => {
    const items: Task[] = [];
    const axios = makeMockAxios(() => ({ results: items, count: 0 }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: {
          prepareParams: (filters: TaskFilters) => ({ status_eq: filters.status }),
          pagination: {
            defaultLimit: 20,
            prepareParams: ({ offset, limit }) => ({
              page: Math.floor(offset / limit) + 1,
              per_page: limit,
            }),
            extractItems: (r: any) => r.results,
            extractMeta: (r: any) => ({ count: r.count }),
          },
        },
      },
    });

    const { wrapper } = makeWrapper();
    renderHook(
      () => tasks.useList({ status: 'open', offset: 40, limit: 20 }),
      { wrapper },
    );

    await waitFor(() => expect(axios).toHaveBeenCalled());

    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      params: { status_eq: 'open', page: 3, per_page: 20 },
    }));
  });
});
