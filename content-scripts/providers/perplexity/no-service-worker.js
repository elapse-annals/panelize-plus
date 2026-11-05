// Runs in the page's own world inside Panelize panels. A Perplexity service
// worker registered from a panel would answer the panel's next page load with
// framing headers that block it, so registration is refused there.
(() => {
  const container = window.top !== window.self ? navigator.serviceWorker : null;
  if (!container) return;

  Object.defineProperty(container, 'register', {
    configurable: true,
    value: () => Promise.reject(new DOMException('Service workers are disabled in Panelize panels.', 'SecurityError'))
  });
})();
