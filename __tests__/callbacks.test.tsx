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

function makeFailingAxios(err: Error): jest.Mock & AxiosInstance {
  return jest.fn().mockRejectedValue(err) as any;
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

// -- Mutation callbacks (standard actions) -------------------------

describe('mutation callbacks - useCreate', () => {
  it('fires onMutate before the request and onSuccess after', async () => {
    const created: Task = { id: 1, title: 'New', done: false };
    const axios = makeMockAxios(() => created);
    const order: string[] = [];

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: {
          onMutate: () => { order.push('onMutate'); },
          onSuccess: () => { order.push('onSuccess'); },
          onSettled: () => { order.push('onSettled'); },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'New', done: false });
    });

    expect(order).toEqual(['onMutate', 'onSuccess', 'onSettled']);
  });

  it('passes variables to onMutate and (data, variables) to onSuccess', async () => {
    const created: Task = { id: 1, title: 'New', done: false };
    const axios = makeMockAxios(() => created);
    const onMutate = jest.fn();
    const onSuccess = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: { onMutate, onSuccess } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    const input: Partial<Task> = { title: 'New', done: false };
    await act(async () => {
      await result.current.mutateAsync(input);
    });

    // TQ v5.60+ passes MutationFunctionContext as the trailing arg
    expect(onMutate).toHaveBeenCalledWith(input, expect.any(Object));
    expect(onSuccess).toHaveBeenCalledWith(created, input, undefined, expect.any(Object));
  });

  it('onMutate return value flows to onSuccess/onSettled as onMutateResult', async () => {
    const created: Task = { id: 1, title: 'New', done: false };
    const axios = makeMockAxios(() => created);
    const onSuccess = jest.fn();
    const onSettled = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: {
          onMutate: () => ({ startedAt: 12345 }),
          onSuccess,
          onSettled,
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'New', done: false });
    });

    // 3rd arg is onMutateResult (the value onMutate returned)
    expect(onSuccess).toHaveBeenCalledWith(
      created, expect.anything(), { startedAt: 12345 }, expect.any(Object),
    );
    expect(onSettled).toHaveBeenCalledWith(
      created, null, expect.anything(), { startedAt: 12345 }, expect.any(Object),
    );
  });

  it('cache updates run BEFORE user onSuccess (user sees fresh cache)', async () => {
    const initial: Task[] = [{ id: 1, title: 'A', done: false }];
    const created: Task = { id: 2, title: 'B', done: false };
    const axios = makeMockAxios((c) => c.method === 'post' ? created : initial);

    let listSeenInsideCallback: Task[] | undefined;

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        getList: true,
        create: {
          onSuccess: () => {
            listSeenInsideCallback = queryClient.getQueryData<Task[]>(['tasks', 'list', {}]);
          },
        },
      },
    });

    const { queryClient, wrapper } = makeWrapper();

    const { result } = renderHook(
      () => ({ list: tasks.useList(), create: tasks.useCreate() }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await act(async () => {
      await result.current.create.mutateAsync({ title: 'B', done: false });
    });

    // Response-driven append means user's callback sees both items already
    expect(listSeenInsideCallback).toEqual([initial[0], created]);
  });

  it('fires onError with (error, variables, context) on failure', async () => {
    const err = new Error('boom');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: {
          onMutate: () => ({ tag: 'ctx' }),
          onError,
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    const input: Partial<Task> = { title: 'x', done: false };
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    expect(onError).toHaveBeenCalledWith(err, input, { tag: 'ctx' }, expect.any(Object));
  });

  it('awaits async onSuccess before onSettled', async () => {
    const created: Task = { id: 1, title: 'x', done: false };
    const axios = makeMockAxios(() => created);
    const order: string[] = [];

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        create: {
          onSuccess: async () => {
            await new Promise((r) => setTimeout(r, 10));
            order.push('onSuccess-done');
          },
          onSettled: () => { order.push('onSettled'); },
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'x', done: false });
    });

    expect(order).toEqual(['onSuccess-done', 'onSettled']);
  });
});

describe('mutation callbacks - useUpdate and useDelete', () => {
  it('useUpdate fires callbacks', async () => {
    const updated: Task = { id: 1, title: 'U', done: true };
    const axios = makeMockAxios(() => updated);
    const onSuccess = jest.fn();
    const onSettled = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { update: { onSuccess, onSettled } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useUpdate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1, title: 'U', done: true });
    });

    expect(onSuccess).toHaveBeenCalledWith(
      updated, expect.objectContaining({ id: 1 }), undefined, expect.any(Object),
    );
    expect(onSettled).toHaveBeenCalled();
  });

  it('useDelete fires callbacks with void data', async () => {
    const axios = makeMockAxios(() => undefined);
    const onSuccess = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { delete: { onSuccess } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useDelete(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1 });
    });

    expect(onSuccess).toHaveBeenCalledWith(undefined, { id: 1 }, undefined, expect.any(Object));
  });

  it('useDelete fires onError with (error, variables, context) on failure', async () => {
    const err = new Error('boom');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: {
        delete: {
          onMutate: () => ({ tag: 'ctx' }),
          onError,
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useDelete(), { wrapper });

    const input = { id: 1 };
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    expect(onError).toHaveBeenCalledWith(err, input, { tag: 'ctx' }, expect.any(Object));
  });
});

// -- Per-call callbacks (TQ-native) --------------------------------

describe('per-call callbacks fire alongside action-level', () => {
  it('both action-level and per-call onSuccess fire', async () => {
    const created: Task = { id: 1, title: 'x', done: false };
    const axios = makeMockAxios(() => created);
    const actionSuccess = jest.fn();
    const perCallSuccess = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { create: { onSuccess: actionSuccess } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'x', done: false }, {
        onSuccess: perCallSuccess,
      });
    });

    expect(actionSuccess).toHaveBeenCalled();
    expect(perCallSuccess).toHaveBeenCalled();
  });
});

// -- Custom action callbacks ---------------------------------------

describe('custom action callbacks', () => {
  it('fires the full callback surface on custom actions', async () => {
    const axios = makeMockAxios(() => ({ ok: true }));
    const onMutate = jest.fn(() => ({ tag: 'x' }));
    const onSuccess = jest.fn();
    const onSettled = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      customActions: {
        approve: {
          path: (t: { id: number }) => `/tasks/${t.id}/approve`,
          method: 'post',
          onMutate,
          onSuccess,
          onSettled,
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => (tasks as any).useApprove(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 42 });
    });

    expect(onMutate).toHaveBeenCalledWith({ id: 42 }, expect.any(Object));
    expect(onSuccess).toHaveBeenCalledWith(
      { ok: true }, { id: 42 }, { tag: 'x' }, expect.any(Object),
    );
    expect(onSettled).toHaveBeenCalled();
  });

  it('fires onError for custom actions', async () => {
    const err = new Error('nope');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      customActions: {
        approve: {
          path: '/tasks/approve',
          method: 'post',
          onError,
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => (tasks as any).useApprove(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1 }).catch(() => {});
    });

    expect(onError).toHaveBeenCalledWith(err, { id: 1 }, undefined, expect.any(Object));
  });
});

// -- Resource-level onError ----------------------------------------

describe('resource-level onError', () => {
  it('fires for standard mutations', async () => {
    const err = new Error('server down');
    const axios = makeFailingAxios(err);
    const resourceOnError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      onError: resourceOnError,
      actions: { create: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useCreate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ title: 'x', done: false }).catch(() => {});
    });

    expect(resourceOnError).toHaveBeenCalledWith(err, {
      action: 'create',
      variables: { title: 'x', done: false },
    });
  });

  it('composes with action-level onError - both fire', async () => {
    const err = new Error('boom');
    const axios = makeFailingAxios(err);
    const resourceOnError = jest.fn();
    const actionOnError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      onError: resourceOnError,
      actions: { update: { onError: actionOnError } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useUpdate(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1 }).catch(() => {});
    });

    expect(resourceOnError).toHaveBeenCalledWith(err, {
      action: 'update',
      variables: { id: 1 },
    });
    expect(actionOnError).toHaveBeenCalledWith(err, { id: 1 }, undefined, expect.any(Object));
  });

  it('composes with action-level onError on useDelete - both fire', async () => {
    const err = new Error('boom');
    const axios = makeFailingAxios(err);
    const resourceOnError = jest.fn();
    const actionOnError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      onError: resourceOnError,
      actions: { delete: { onError: actionOnError } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useDelete(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1 }).catch(() => {});
    });

    expect(resourceOnError).toHaveBeenCalledWith(err, {
      action: 'delete',
      variables: { id: 1 },
    });
    expect(actionOnError).toHaveBeenCalledWith(err, { id: 1 }, undefined, expect.any(Object));
  });

  it('fires for custom actions (with the action name)', async () => {
    const err = new Error('x');
    const axios = makeFailingAxios(err);
    const resourceOnError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      onError: resourceOnError,
      customActions: {
        approve: {
          path: '/tasks/approve',
          method: 'post',
        },
      },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => (tasks as any).useApprove(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 1 }).catch(() => {});
    });

    expect(resourceOnError).toHaveBeenCalledWith(err, {
      action: 'approve',
      variables: { id: 1 },
    });
  });

  it('does NOT fire for query errors (queries are opt-in per action)', async () => {
    const err = new Error('nope');
    const axios = makeFailingAxios(err);
    const resourceOnError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      onError: resourceOnError,
      actions: { getList: true },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(resourceOnError).not.toHaveBeenCalled();
  });
});

// -- Query callbacks (opt-in) --------------------------------------

describe('query callbacks - action-level onError', () => {
  it('fires when useList query errors', async () => {
    const err = new Error('list-fail');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: { onError } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('fires when useGet query errors', async () => {
    const err = new Error('get-fail');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { get: { onError } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => tasks.useGet(42), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('fires when useSingle query errors', async () => {
    const err = new Error('single-fail');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const stats = createResource<{ n: number }>()({
      name: 'stats', route: '/stats', axios,
      actions: { getSingle: { onError } },
    });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => stats.useSingle(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('is deduped - fires once per distinct error on re-renders', async () => {
    const err = new Error('once');
    const axios = makeFailingAxios(err);
    const onError = jest.fn();

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: { onError } },
    });

    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => tasks.useList(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    rerender();
    rerender();

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('query throwOnError', () => {
  it('propagates to TQ - error boundary would catch it', async () => {
    const err = new Error('throw-me');
    const axios = makeFailingAxios(err);

    // TQ's throwOnError makes the render throw. Wrap in an error boundary
    // to capture instead of letting Jest treat it as unhandled.
    class Boundary extends React.Component<{ children: React.ReactNode }, { caught: Error | null }> {
      state = { caught: null as Error | null };
      static getDerivedStateFromError(e: Error) { return { caught: e }; }
      render() { return this.state.caught ? null : this.props.children; }
    }

    const tasks = createResource<Task>()({
      name: 'tasks', route: '/tasks', axios,
      actions: { getList: { throwOnError: true } },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Boundary>{children}</Boundary>
      </QueryClientProvider>
    );

    // Silence expected React error boundary logs
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => tasks.useList(), { wrapper });

    await waitFor(() => {
      const state = queryClient.getQueryState(['tasks', 'list', {}]);
      expect(state?.status).toBe('error');
    });

    consoleError.mockRestore();
  });
});
