export const DEEPSEEK_COOKIE_URL = 'https://chat.deepseek.com/';
export const DEEPSEEK_CONSENT_COOKIE_NAME = 'ds_cookie_preference';

function needsUpgrade(cookie, names) {
  return Boolean(
    cookie &&
    names.includes(cookie.name) &&
    !cookie.partitionKey &&
    (cookie.sameSite !== 'no_restriction' || !cookie.secure)
  );
}

/**
 * Rewrites existing consent cookies to SameSite=None; Secure so a provider can
 * read a choice the user already made top-level from inside its embedded
 * panel; Chromium hides SameSite=Lax cookies from document.cookie there.
 * Value, path, domain and expiry are kept. New choices made inside the panel
 * are handled by content-scripts/embedded-consent-cookies.js instead.
 * @param {chrome.cookies.Cookie[]} cookies
 * @param {{url: string, names: string[], label: string}} options
 * @returns {Promise<chrome.cookies.Cookie[]>} The cookies as they are now.
 */
export async function upgradeConsentCookies(cookies, { url, names, label }) {
  if (!Array.isArray(cookies) || typeof chrome === 'undefined' || !chrome.cookies?.set) {
    return cookies;
  }

  const updatedCookies = [];
  for (const cookie of cookies) {
    if (needsUpgrade(cookie, names)) {
      const details = {
        url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: true,
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: 'no_restriction'
      };
      if (!cookie.hostOnly && cookie.domain) {
        details.domain = cookie.domain;
      }
      if (typeof cookie.expirationDate === 'number') {
        details.expirationDate = cookie.expirationDate;
      }
      if (typeof cookie.storeId === 'string') {
        details.storeId = cookie.storeId;
      }

      try {
        await chrome.cookies.set(details);
        updatedCookies.push({
          ...cookie,
          secure: true,
          sameSite: 'no_restriction'
        });
        continue;
      } catch (error) {
        console.warn(`[${label}] Failed to update consent cookie ${cookie.name}:`, error);
      }
    }

    updatedCookies.push(cookie);
  }

  return updatedCookies;
}

export function isDeepSeekConsentCookieChange(changeInfo) {
  return Boolean(
    changeInfo &&
    !changeInfo.removed &&
    needsUpgrade(changeInfo.cookie, [DEEPSEEK_CONSENT_COOKIE_NAME])
  );
}

/**
 * Upgrades DeepSeek's cookie banner choice so the embedded DeepSeek panel sees
 * a choice made in a normal tab instead of showing the banner again.
 */
export async function upgradeDeepSeekConsentCookies() {
  if (typeof chrome === 'undefined' || !chrome.cookies?.getAll) {
    return;
  }

  const cookies = await chrome.cookies.getAll({
    url: DEEPSEEK_COOKIE_URL,
    name: DEEPSEEK_CONSENT_COOKIE_NAME
  });
  await upgradeConsentCookies(cookies, {
    url: DEEPSEEK_COOKIE_URL,
    names: [DEEPSEEK_CONSENT_COOKIE_NAME],
    label: 'DeepSeek'
  });
}
