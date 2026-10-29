// Copilot Enter/Shift+Enter behavior swap.
// Signed-in composer selectors verified in the browser.
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const COPILOT_SEND_BUTTON_SELECTORS = [
  '#m365-chat-input-shared-container button.fai-SendButton',
  '#m365-chat-input-shared-container button[aria-label="Send"]',
  '#m365-chat-input-shared-container button[aria-label="发送"]'
];

function isCopilotInput(element) {
  return Boolean(
    element &&
    element.offsetParent !== null &&
    element.tagName === 'SPAN' &&
    element.id === 'm365-chat-editor-target-element' &&
    element.isContentEditable &&
    element.getAttribute('role') === 'textbox' &&
    element.getAttribute('data-lexical-editor') === 'true'
  );
}

function insertCopilotNewline(input) {
  input.focus();
  for (const command of ['insertLineBreak', 'insertParagraph']) {
    try {
      if (document.execCommand(command, false)) return;
    } catch (error) {
      // Try the other native editing command.
    }
  }
}

function handleEnterSwap(event) {
  if (!event.isTrusted || event.code !== 'Enter' || event.isComposing || !enterKeyConfig?.enabled) return;

  const input = document.activeElement;
  if (!isCopilotInput(input)) return;

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertCopilotNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const sendButton = window.ButtonFinderUtils?.findButton(COPILOT_SEND_BUTTON_SELECTORS);
  if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
    sendButton.click();
  }
}

applyEnterSwapSetting();

// Microsoft sign-in refuses to run inside a frame, so sign-in controls in an
// embedded panel open a top-level tab instead. Reload the panel afterwards.
const COPILOT_TOP_LEVEL_SIGN_IN_URL = 'https://copilot.com/login?ru=%2F';

function getCopilotSignInUrl(target) {
  if (!(target instanceof Element)) return null;

  const link = target.closest('a[href]');
  if (link) {
    try {
      const url = new URL(link.href, location.href);
      if (url.hostname === location.hostname && url.pathname === '/login') return url.href;
    } catch (error) {
      return null;
    }
  }

  return target.closest('.uhf-mecontrol-signin-label') ? COPILOT_TOP_LEVEL_SIGN_IN_URL : null;
}

function handleEmbeddedSignInClick(event) {
  const signInUrl = getCopilotSignInUrl(event.target);
  if (!signInUrl) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  window.open(signInUrl, '_blank', 'noopener');
}

if (window.top !== window.self) {
  document.addEventListener('click', handleEmbeddedSignInClick, true);
}
