/**
 * Owns provider sessions behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { reconcileOptionalProviderAccess } from '../../modules/providers/optional-provider-access.js';
import { reconcileMimoSessionCookies } from '../../modules/providers/mimo-session-cookies.js';
import { upgradeDeepSeekConsentCookies } from '../../modules/providers/consent-cookies.js';
import { createGrokWebSocketCookieReconcileScheduler, reconcileGrokWebSocketCookies } from '../../modules/providers/grok-websocket-cookies.js';

export function createProviderSessionsController() {
  let optionalProviderReconcileQueue = Promise.resolve();

  // The Grok scheduler is provider-agnostic: it serializes runs and coalesces
  // bursts of cookie events into one queued reconcile.
  const scheduleMimoSessionReconcile = createGrokWebSocketCookieReconcileScheduler(
    async () => {
      const result = await reconcileMimoSessionCookies();
      if (!result?.success) throw new Error('MiMo session synchronization failed');
    },
    () => {
      console.warn('[Background] Failed to synchronize MiMo panel session');
    }
  );

  function scheduleOptionalProviderReconcile() {
    optionalProviderReconcileQueue = optionalProviderReconcileQueue
      .then(() => reconcileOptionalProviderAccess())
      .catch((error) => {
        console.error('[Background] Optional provider reconciliation queue failed:', error);
      });

    return optionalProviderReconcileQueue;
  }

  const scheduleGrokWebSocketCookieReconcile = createGrokWebSocketCookieReconcileScheduler(
    reconcileGrokWebSocketCookies,
    (error) => {
      console.error('[Background] Failed to synchronize Grok WebSocket cookies:', error);
    }
  );

  // Failures only mean the DeepSeek panel shows its cookie banner again.
  async function upgradeDeepSeekConsentCookiesSafely() {
    try {
      await upgradeDeepSeekConsentCookies();
    } catch (error) {
      console.warn('[Background] Failed to update DeepSeek consent cookie:', error);
    }
  }

  return {
    get scheduleGrokWebSocketCookieReconcile() { return scheduleGrokWebSocketCookieReconcile; },
    get scheduleMimoSessionReconcile() { return scheduleMimoSessionReconcile; },
    scheduleOptionalProviderReconcile,
    upgradeDeepSeekConsentCookiesSafely,
  };
}
