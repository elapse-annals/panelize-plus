// Meta AI Enter/Shift+Enter behavior swap
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const META_AI_SEND_BUTTON_SELECTORS = [
  {
    type: 'css',
    value: 'button[data-testid="composer-send-button"]'
  },
  {
    type: 'css',
    value: '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="Send"]'
  },
  {
    type: 'css',
    value: '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="发送"]'
  },
  {
    type: 'css',
    value: '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="發送"]'
  }
];

function isMetaAiInput(element) {
  return Boolean(
    element &&
    element.offsetParent !== null &&
    (
      element.getAttribute('data-testid') === 'composer-input' ||
      (
        element.tagName === 'INPUT' &&
        element.type === 'text' &&
        element.closest?.('[data-slot="logged-out-composer-input"]')
      )
    )
  );
}

function insertMetaAiNewline(input) {
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText('\n', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // The visible composer is a Lexical editor; let it handle native line breaks.
  input.focus();
  for (const command of ['insertLineBreak', 'insertParagraph']) {
    try {
      if (document.execCommand(command, false)) {
        return;
      }
    } catch (error) {
      // Try the other native editing command.
    }
  }
}

function handleEnterSwap(event) {
  if (!event.isTrusted || event.code !== 'Enter' || event.isComposing || !enterKeyConfig?.enabled) {
    return;
  }

  const input = document.activeElement;
  if (!isMetaAiInput(input)) {
    return;
  }

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertMetaAiNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  // While answering, Meta AI replaces this button with composer-stop-button.
  const sendButton = window.ButtonFinderUtils?.findButton(META_AI_SEND_BUTTON_SELECTORS);
  if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
    sendButton.click();
  }
}

applyEnterSwapSetting();
