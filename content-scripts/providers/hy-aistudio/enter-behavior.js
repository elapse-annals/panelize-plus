// Hy AI Studio Enter/Shift+Enter behavior swap
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const HY_AISTUDIO_SEND_BUTTON_SELECTORS = [
  {
    type: 'css',
    // A div that is disabled by class.
    value: '.hy-chat-input-send-btn:not(.hy-chat-input-send-btn--disabled)'
  }
];

function isHyAiStudioInput(element) {
  return Boolean(
    element &&
    element.tagName === 'TEXTAREA' &&
    element.offsetParent !== null &&
    element.classList.contains('t-textarea__inner') &&
    element.closest('.hy-chat-input__content')
  );
}

function insertHyAiStudioNewline(textarea) {
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
  if (!isHyAiStudioInput(input)) {
    return;
  }

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertHyAiStudioNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  const sendButton = window.ButtonFinderUtils?.findButton(HY_AISTUDIO_SEND_BUTTON_SELECTORS);
  if (sendButton) {
    sendButton.click();
  }
}

applyEnterSwapSetting();
