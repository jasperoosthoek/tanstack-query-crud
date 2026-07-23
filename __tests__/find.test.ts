import React from 'react';
import type { AxiosInstance } from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createResource } from '../src';

// -- find: exposed on useList()'s own return value, bound via closure to
// that call's data. Not a hook itself (calling it doesn't call any hooks),
// so it needs a render to obtain, then behaves like a plain function.

type Task = { id: number; title: string; done: boolean };
type TaskUuid = { uuid: string; title: string };

function makeMockAxios(response: unknown = undefined): jest.Mock & AxiosInstance {
  return jest.fn().mockResolvedValue({ data: response }) as any;
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  );
  return { queryClient, wrapper };
}

describe('find (on useList() result)', () => {
  it('is present when getList is configured', async () => {
    const axios = makeMockAxios([]);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(typeof result.current.find).toBe('function');
  });

  it('is absent when getList is not configured', () => {
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios: makeMockAxios(),
      actions: { create: true },
    });
    expect((tasks as any).useList).toBeUndefined();
  });

  it('finds by the default id field', async () => {
    const list: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: true },
    ];
    const axios = makeMockAxios(list);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.find(2)).toEqual({ id: 2, title: 'B', done: true });
    expect(result.current.find(3)).toBeUndefined();
  });

  it('string-coerces the id, matching a numeric field against a string id (e.g. a route param)', async () => {
    const list: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = makeMockAxios(list);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Simulates useParams() always returning a string, even though Task.id is numeric
    expect(result.current.find('1')).toEqual(list[0]);
  });

  it('finds by a configured non-default id field', async () => {
    const list: TaskUuid[] = [
      { uuid: 'abc-123', title: 'A' },
      { uuid: 'def-456', title: 'B' },
    ];
    const axios = makeMockAxios(list);
    const tasks = createResource<TaskUuid>()({
      name: 'tasks', route: '/tasks', axios,
      id: 'uuid',
      actions: { getList: true },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.find('def-456')).toEqual({ uuid: 'def-456', title: 'B' });
  });

  it('returns undefined before data has loaded, without throwing', () => {
    const axios = makeMockAxios([]);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });

    // Before the query resolves, data is undefined
    expect(result.current.find(1)).toBeUndefined();
    expect(result.current.find((t: Task) => t.done)).toBeUndefined();
  });

  it('accepts a predicate function, matching Array.prototype.find semantics', async () => {
    const list: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: true },
    ];
    const axios = makeMockAxios(list);
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.find((t) => t.done)).toEqual({ id: 2, title: 'B', done: true });
    expect(result.current.find((t) => t.title === 'nope')).toBeUndefined();

    // index and the full list are passed through, like the native find
    const seen: number[] = [];
    result.current.find((_t, index, arr) => {
      seen.push(index);
      expect(arr).toEqual(list);
      return false;
    });
    expect(seen).toEqual([0, 1]);
  });

  it('searches only its own call\'s list, not a sibling filtered variant', async () => {
    const all: Task[] = [
      { id: 1, title: 'A', done: false },
      { id: 2, title: 'B', done: true },
    ];
    const open: Task[] = [{ id: 1, title: 'A', done: false }];
    const axios = jest.fn().mockImplementation(async (config) => ({
      data: config.params?.status === 'open' ? open : all,
    })) as any;
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: { prepareParams: (f: { status?: string }) => f } },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({ everything: tasks.useList(), openOnly: tasks.useList({ status: 'open' }) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.everything.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.openOnly.isSuccess).toBe(true));

    // id 2 exists in the unfiltered list but not in the filtered one
    expect(result.current.everything.find(2)).toEqual(all[1]);
    expect(result.current.openOnly.find(2)).toBeUndefined();
  });
});
