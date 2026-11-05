// Perplexity's service worker lives in the same storage as its embedded panels
// and answers their page loads itself, so its responses keep the framing
// headers the panel rule removes. Clearing it lets the next load reach the
// network; cookies and the user's sign-in are left alone.
export const PERPLEXITY_ORIGIN = 'https://www.perplexity.ai';

export async function clearPerplexityServiceWorker() {
  if (!chrome.browsingData?.remove) {
    return;
  }

  try {
    await chrome.browsingData.remove({ origins: [PERPLEXITY_ORIGIN] }, { serviceWorkers: true });
  } catch (error) {
    console.warn('[Multi-Panel] Failed to clear the Perplexity service worker:', error);
  }
}
