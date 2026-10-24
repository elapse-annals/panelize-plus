import { aggregateAnswerStats, getAllAnswerRounds } from './answer-stats.js';
import { normalizeProviderOrder } from './provider-order.js';

export const PROVIDER_SORT_MODE_MANUAL = 'manual';
export const PROVIDER_SORT_MODE_FREQUENT = 'frequent';

export function normalizeProviderSortMode(value) {
  return value === PROVIDER_SORT_MODE_FREQUENT
    ? PROVIDER_SORT_MODE_FREQUENT
    : PROVIDER_SORT_MODE_MANUAL;
}

/**
 * Sort provider IDs by their aggregate answer score, keeping manual order as
 * the stable tie breaker (and as the fallback for providers without data).
 */
export function rankProviderIds(providerIds, manualOrder, providerStats) {
  const stableOrder = normalizeProviderOrder(manualOrder, providerIds);
  const orderIndex = new Map(stableOrder.map((providerId, index) => [providerId, index]));
  const statsByProvider = new Map(
    (Array.isArray(providerStats) ? providerStats : [])
      .filter(entry => entry && typeof entry.providerId === 'string')
      .map(entry => [entry.providerId, entry])
  );

  const value = (providerId, key) => {
    const result = Number(statsByProvider.get(providerId)?.[key]);
    return Number.isFinite(result) ? result : 0;
  };

  return [...providerIds].sort((a, b) =>
    value(b, 'score') - value(a, 'score')
    || value(b, 'adoptedCount') - value(a, 'adoptedCount')
    || value(b, 'rounds') - value(a, 'rounds')
    || orderIndex.get(a) - orderIndex.get(b)
  );
}

/**
 * Rank providers using the locally stored answer history. If IndexedDB is
 * unavailable, retain the manual order without changing any stored data.
 */
export async function getFrequentProviderOrder(providerIds, manualOrder) {
  const stableOrder = normalizeProviderOrder(manualOrder, providerIds);
  try {
    const rounds = await getAllAnswerRounds();
    return rankProviderIds(providerIds, stableOrder, aggregateAnswerStats(rounds));
  } catch (error) {
    console.warn('Failed to load answer statistics for provider ranking; using manual order', error);
    return stableOrder;
  }
}
