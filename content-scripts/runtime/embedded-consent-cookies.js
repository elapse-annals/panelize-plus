// Ensure cookie consent choices written via document.cookie inside an embedded
// provider iframe use SameSite=None; Secure so Chromium's cross-site script
// cookie check accepts and persists them. Without this the consent banner
// reappears on every load:
// - Grok: OneTrust (OptanonAlertBoxClosed, OptanonConsent)
// - DeepSeek: ds_cookie_preference
(() => {
  if (window.top === window.self) {
    return;
  }

  // Only rewrite inside extension pages such as the Multi-Panel page. Provider
  // frames embedded by ordinary websites (or by a website framing the
  // web-accessible Multi-Panel page) keep the browser's default behavior.
  const ancestorOrigins = location.ancestorOrigins;
  const topOrigin = ancestorOrigins?.length ? ancestorOrigins[ancestorOrigins.length - 1] : '';
  if (!topOrigin.startsWith('chrome-extension://')) {
    return;
  }

  const CONSENT_COOKIE_PATTERNS = {
    'grok.com': /^\s*Optanon(?:AlertBoxClosed|Consent)=/,
    'chat.deepseek.com': /^\s*ds_cookie_preference=/
  };
  const consentCookiePattern = CONSENT_COOKIE_PATTERNS[location.hostname];
  if (!consentCookiePattern) {
    return;
  }

  function rewriteConsentCookieString(cookieString) {
    if (typeof cookieString !== 'string' || !consentCookiePattern.test(cookieString)) {
      return cookieString;
    }

    if (typeof location !== 'undefined' && location.protocol !== 'https:') {
      return cookieString;
    }

    let rewritten = cookieString.replace(/;\s*SameSite=(?:Lax|Strict)/gi, '; SameSite=None');
    if (!/;\s*SameSite=None\b/i.test(rewritten)) {
      rewritten += '; SameSite=None';
    }
    if (!/;\s*Secure\b/i.test(rewritten)) {
      rewritten += '; Secure';
    }
    return rewritten;
  }

  // Patch the prototype that actually owns the accessor (Document.prototype in
  // Chromium) so no own property further down the chain shadows the override.
  let owner = Object.getPrototypeOf(document);
  while (owner && !Object.prototype.hasOwnProperty.call(owner, 'cookie')) {
    owner = Object.getPrototypeOf(owner);
  }
  const descriptor = owner && Object.getOwnPropertyDescriptor(owner, 'cookie');
  if (!descriptor || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') {
    return;
  }

  Object.defineProperty(owner, 'cookie', {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      return descriptor.set.call(this, rewriteConsentCookieString(value));
    }
  });
})();
