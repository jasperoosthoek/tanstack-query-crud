import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource, useResourceUtils } from '../src';

type Task = { id: number; title: string; done: boolean };

function makeMockAxios(): jest.Mock & AxiosInstance {
  return jest.fn().mockResolvedValue({ data: undefined }) as any;
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

describe('useResourceUtils', () => {
  const tasks = createResource<Task>()({
    name: 'tasks', route: '/tasks', axios: makeMockAxios(),
    actions: { getList: true, get: true },
  });

  it('provides all cache manipulation methods', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    expect(typeof result.current.getListCache).toBe('function');
    expect(typeof result.current.setListCache).toBe('function');
    expect(typeof result.current.updateAllLists).toBe('function');
    expect(typeof result.current.getDetailCache).toBe('function');
    expect(typeof result.current.setDetailCache).toBe('function');
    expect(typeof result.current.removeDetailCache).toBe('function');
    expect(typeof result.current.updateAllDetails).toBe('function');
    expect(typeof result.current.invalidate).toBe('function');
    expect(typeof result.current.invalidateList).toBe('function');
    expect(typeof result.current.invalidateDetail).toBe('function');
  });

  it('setListCache writes to the default list cache', () => {
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    act(() => {
      result.current.setListCache(items);
    });

    expect(queryClient.getQueryData(['tasks', 'list', {}])).toEqual(items);
  });

  it('setListCache with params targets a specific variant', () => {
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    act(() => {
      result.current.setListCache(items, { status: 'open' });
    });

    expect(queryClient.getQueryData(['tasks', 'list', { status: 'open' }])).toEqual(items);
    expect(queryClient.getQueryData(['tasks', 'list', {}])).toBeUndefined();
  });

  it('setListCache / getListCache round-trip', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    act(() => {
      result.current.setListCache(items);
    });

    expect(result.current.getListCache()).toEqual(items);
  });

  it('getListCache with params reads back a specific variant, not the default', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const items: Task[] = [{ id: 1, title: 'A', done: false }];
    act(() => {
      result.current.setListCache(items, { status: 'open' });
    });

    expect(result.current.getListCache({ status: 'open' })).toEqual(items);
    expect(result.current.getListCache()).toBeUndefined();
  });

  it('getListCache returns undefined when nothing has been cached', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    expect(result.current.getListCache()).toBeUndefined();
  });

  it('setDetailCache / getDetailCache round-trip', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const item: Task = { id: 42, title: 'X', done: true };
    act(() => result.current.setDetailCache(42, item));

    expect(result.current.getDetailCache(42)).toEqual(item);
  });

  it('removeDetailCache removes the entry', () => {
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const item: Task = { id: 42, title: 'X', done: true };
    act(() => {
      result.current.setDetailCache(42, item);
      result.current.removeDetailCache(42);
    });

    expect(queryClient.getQueryData(['tasks', 'detail', 42])).toBeUndefined();
  });

  it('updateAllLists applies functional update across all list variants', () => {
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    // Seed multiple list caches
    const listA: Task[] = [{ id: 1, title: 'A', done: false }];
    const listB: Task[] = [{ id: 2, title: 'B', done: true }];
    act(() => {
      result.current.setListCache(listA, { status: 'open' });
      result.current.setListCache(listB, { status: 'closed' });
    });

    // Apply update to both
    act(() => {
      result.current.updateAllLists((list) =>
        list.map((t) => ({ ...t, done: true }))
      );
    });

    expect(queryClient.getQueryData(['tasks', 'list', { status: 'open' }]))
      .toEqual([{ id: 1, title: 'A', done: true }]);
    expect(queryClient.getQueryData(['tasks', 'list', { status: 'closed' }]))
      .toEqual([{ id: 2, title: 'B', done: true }]);
  });

  it('updateAllDetails applies functional update across all detail cache entries', () => {
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    // Seed multiple detail cache entries
    act(() => {
      result.current.setDetailCache(1, { id: 1, title: 'A', done: false });
      result.current.setDetailCache(2, { id: 2, title: 'B', done: false });
    });

    act(() => {
      result.current.updateAllDetails((item) => ({ ...item, done: true }));
    });

    expect(queryClient.getQueryData(['tasks', 'detail', 1]))
      .toEqual({ id: 1, title: 'A', done: true });
    expect(queryClient.getQueryData(['tasks', 'detail', 2]))
      .toEqual({ id: 2, title: 'B', done: true });
  });

  it('updateAllDetails leaves other resources\' detail caches untouched', () => {
    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    // A detail cache entry under a different resource name
    queryClient.setQueryData(['otherResource', 'detail', 1], { id: 1, name: 'untouched' });
    act(() => {
      result.current.setDetailCache(1, { id: 1, title: 'A', done: false });
    });

    act(() => {
      result.current.updateAllDetails((item) => ({ ...item, done: true }));
    });

    expect(queryClient.getQueryData(['otherResource', 'detail', 1])).toEqual({ id: 1, name: 'untouched' });
  });

  it('invalidateList marks list queries stale', () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    act(() => result.current.invalidateList());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });

  it('invalidateDetail(id) targets a specific detail entry', () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    act(() => result.current.invalidateDetail(42));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'detail', 42] });
  });

  it('invalidateDetail() with no id targets all detail entries', () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    act(() => result.current.invalidateDetail());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'detail'] });
  });

  it('invalidate targets the whole resource', () => {
    const { queryClient, wrapper } = makeWrapper();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    act(() => result.current.invalidate());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('returns a stable object across re-renders', () => {
    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useResourceUtils<Task>(tasks), { wrapper });

    const first = result.current;
    rerender();
    const second = result.current;

    // Memoized - same reference
    expect(first).toBe(second);
  });
});
