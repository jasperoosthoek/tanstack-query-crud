import type { QueryClient } from '@tanstack/react-query';
import type { InvalidatesConfig, InvalidationTarget } from './types';

/**
 * Runs the declarative invalidation for a mutation.
 *
 * Behavior:
 * - `undefined` or `'all'` -> invalidate everything for this resource
 *   (default: fires when the user doesn't declare `invalidates` in config)
 * - `[]` -> no invalidation (read-only mutation, rare but supported)
 * - Array of targets -> invalidate each specified key
 *
 * Targets:
 * - 'list' | 'detail' | 'single'  -> same-resource specific key
 * - 'all'                          -> same-resource everything
 * - { name: X }                    -> cross-resource, invalidate [X]
 * - [{ name: X }, 'list'|...]      -> cross-resource, specific key
 */
export function runInvalidation(
  queryClient: QueryClient,
  resourceName: string,
  invalidates: InvalidatesConfig | undefined,
): void {
  // Default: invalidate everything for this resource.
  if (invalidates === undefined || invalidates === 'all') {
    queryClient.invalidateQueries({ queryKey: [resourceName] });
    return;
  }

  // Empty array: caller opted out of invalidation entirely.
  if (invalidates.length === 0) {
    return;
  }

  for (const target of invalidates) {
    invalidateTarget(queryClient, resourceName, target);
  }
}

function invalidateTarget(
  queryClient: QueryClient,
  resourceName: string,
  target: InvalidationTarget,
): void {
  if (typeof target === 'string') {
    // Same-resource string target
    if (target === 'all') {
      queryClient.invalidateQueries({ queryKey: [resourceName] });
    } else {
      queryClient.invalidateQueries({ queryKey: [resourceName, target] });
    }
    return;
  }

  if (Array.isArray(target)) {
    // Cross-resource with specific key: [ResourceRef, StringTarget]
    const [ref, kind] = target;
    if (kind === 'all') {
      queryClient.invalidateQueries({ queryKey: [ref.name] });
    } else {
      queryClient.invalidateQueries({ queryKey: [ref.name, kind] });
    }
    return;
  }

  // Bare resource reference: invalidate all its queries
  queryClient.invalidateQueries({ queryKey: [target.name] });
}
