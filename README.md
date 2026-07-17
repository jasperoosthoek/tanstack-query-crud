# @jasperoosthoek/tanstack-crud

Declarative CRUD hooks built on top of [TanStack Query](https://tanstack.com/query). Configure your endpoints once, get typed hooks with automatic caching and invalidation.

## Setup

Requires a `QueryClient` and `<QueryClientProvider>` in your app (standard TanStack Query setup).

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <YourApp />
    </QueryClientProvider>
  );
}
```

## Usage

```ts
// resources/tasks.ts
import axios from 'axios';
import { createResource } from '@jasperoosthoek/tanstack-crud';

type Task = { id: number; title: string; done: boolean };

const api = axios.create({ baseURL: '/api' });

export const tasks = createResource<Task>()({
  name: 'tasks',
  route: '/tasks',
  axios: api,
  actions: { getList: true },
});
```

```tsx
// components/TaskList.tsx
import { tasks } from '../resources/tasks';

export function TaskList() {
  const { data, isLoading, error } = tasks.useList();

  if (isLoading) return <div>Loading…</div>;
  if (error) return <div>Error: {error.message}</div>;
  return (
    <ul>
      {data?.map(task => <li key={task.id}>{task.title}</li>)}
    </ul>
  );
}
```
