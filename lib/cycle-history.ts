import type { Cycle } from './queries';

/** Live cycles are the default; a cancelled cycle is only opened by explicit ID. */
export function selectHistoryCycle(
  requestedId: string | undefined,
  live: Cycle[],
  cancelled: Cycle[],
  active: Cycle | null,
): Cycle | null {
  return live.find((cycle) => cycle.id === requestedId)
    ?? cancelled.find((cycle) => cycle.id === requestedId)
    ?? active
    ?? live[0]
    ?? null;
}
