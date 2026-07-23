import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { createResource } from '../src';

type Task = { id: number; title: string; done: boolean };
type Stats = { open: number; closed: number };

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
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper, invalidateSpy };
}

// -- Default behavior in v0.6: response-driven, no invalidation ---
// (See responseDriven.test.tsx for the response-driven behavior tests.)
// Explicit invalidates config opts back into invalidation-based updates.

// -- Explicit invalidates: 'list' | 'detail' | 'single' | 'all' ---

describe('explicit same-resource invalidation', () => {
  it('invalidates: ["list"] invalidates only list queries', async () => {
    const axios = makeMockAxios(() => ({ id: 2, title: 'B', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: { invalidates: ['list'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'B', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'detail'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('invalidates: ["detail"] invalidates only detail queries', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'Updated', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        update: { invalidates: ['detail'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'Updated' });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'detail'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });

  it('invalidates: ["list", "detail"] invalidates both', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'A', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        update: { invalidates: ['list', 'detail'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'X' });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'detail'] });
  });

  it('invalidates: [] does not invalidate anything', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: { invalidates: [] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'X', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates: "all" invalidates the whole resource', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: { invalidates: 'all' },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'X', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('invalidates: ["all"] (array form) invalidates the whole resource', async () => {
    // Distinct from the bare `invalidates: 'all'` case above - here 'all'
    // is a string *element inside the array*, exercising the same-resource
    // branch of invalidateTarget rather than the top-level shortcut.
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: false }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: { invalidates: ['all'] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'X', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });
});

// -- Cross-resource invalidation via resource references ----------

describe('cross-resource invalidation', () => {
  it('resource reference invalidates all queries of another resource', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: false }));

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: { invalidates: ['list', taskStats] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      await createHook.result.current.mutateAsync({ title: 'X', done: false });
    });
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats'] });
  });

  it('tuple [resource, "single"] invalidates specific key on other resource', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'A', done: false }));

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        update: { invalidates: [[taskStats, 'single']] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'X' });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    // Only stats.single should be invalidated
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats', 'single'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('tuple [resource, "all"] invalidates all queries of the other resource', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'A', done: false }));

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        update: { invalidates: [[taskStats, 'all']] },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const updateHook = renderHook(() => tasks.useUpdate(), { wrapper });
    await act(async () => {
      await updateHook.result.current.mutateAsync({ id: 1, title: 'X' });
    });
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true));

    // Tuple with 'all' kind invalidates the same key as a bare resource reference
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['taskStats', 'single'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
  });
});

// -- Custom action invalidation -----------------------------------

describe('custom action invalidation', () => {
  it('custom action with no invalidates uses default (all resource queries)', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: true }));

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
      customActions: {
        approve: {
          path: (t: Task) => `/tasks/${t.id}/approve`,
          method: 'post',
        },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const approveHook = renderHook(() => tasks.useApprove(), { wrapper });
    await act(async () => {
      await approveHook.result.current.mutateAsync({ id: 1, title: 'X', done: false });
    });
    await waitFor(() => expect(approveHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  });

  it('custom action with explicit cross-resource invalidates', async () => {
    const axios = makeMockAxios(() => ({ id: 1, title: 'X', done: true }));

    const taskStats = createResource<Stats>()({
      name: 'taskStats', route: '/tasks/stats', axios,
      actions: { getSingle: true },
    });

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: true },
      customActions: {
        approve: {
          path: (t: Task) => `/tasks/${t.id}/approve`,
          method: 'post',
          invalidates: ['list', taskStats],
        },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const approveHook = renderHook(() => tasks.useApprove(), { wrapper });
    await act(async () => {
      await approveHook.result.current.mutateAsync({ id: 1, title: 'X', done: false });
    });
    await waitFor(() => expect(approveHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tasks', 'list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['taskStats'] });
  });

  it('custom action with invalidates: [] skips invalidation', async () => {
    const axios = makeMockAxios(() => ({ readonly: true }));
    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      customActions: {
        report: {
          path: '/tasks/report',
          method: 'post',
          invalidates: [],
        },
      },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const reportHook = renderHook(() => tasks.useReport(), { wrapper });
    await act(async () => {
      await reportHook.result.current.mutateAsync({});
    });
    await waitFor(() => expect(reportHook.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// -- Failed mutations do not invalidate ---------------------------

describe('failed mutations do not invalidate', () => {
  it('failed create leaves queries alone', async () => {
    const axios = jest.fn().mockImplementation(async () => {
      throw new Error('create failed');
    }) as any;

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: true },
    });

    const { wrapper, invalidateSpy } = makeWrapper();

    const createHook = renderHook(() => tasks.useCreate(), { wrapper });
    await act(async () => {
      try { await createHook.result.current.mutateAsync({ title: 'X', done: false }); } catch (_) {}
    });

    await waitFor(() => expect(createHook.result.current.isError).toBe(true));

    // onSuccess never fired, so no invalidation
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
