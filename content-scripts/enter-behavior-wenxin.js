// Wenxin Enter/Shift+Enter behavior swap.
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const WENXIN_SEND_BUTTON_SELECTORS = [
  {
    type: 'css',
    value: 'img#ci-submit-button-ai.ci-submit-button-ai-active'
  }
];

function isWenxinInput(element) {
  return Boolean(
    element &&
    element.tagName === 'TEXTAREA' &&
    element.id === 'chat-textarea' &&
    element.classList.contains('ci-textarea') &&
    element.offsetParent !== null
  );
}

function insertWenxinNewline(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.setRangeText('\n', start, end, 'end');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleEnterSwap(event) {
  if (!event.isTrusted || event.code !== 'Enter' || event.isComposing || !enterKeyConfig?.enabled) {
    return;
  }

  const input = document.activeElement;
  if (!isWenxinInput(input)) {
    return;
  }

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertWenxinNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  const sendButton = window.ButtonFinderUtils?.findButton(WENXIN_SEND_BUTTON_SELECTORS);
  if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
    sendButton.click();
  }
}

applyEnterSwapSetting();
