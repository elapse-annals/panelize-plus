// Agnes Enter/Shift+Enter behavior swap
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const AGNES_SEND_BUTTON_SELECTORS = [
  {
    type: 'css',
    value: 'button[title="Send"]'
  },
  {
    type: 'css',
    value: 'button[title="发送"]'
  },
  {
    type: 'css',
    value: 'button[aria-label="Send"]'
  },
  {
    type: 'css',
    value: 'button[aria-label="发送"]'
  }
];

function isAgnesLexicalInput(element) {
  return Boolean(
    element &&
    element.isContentEditable &&
    element.getAttribute('data-lexical-editor') === 'true'
  );
}

function isAgnesInput(element) {
  return Boolean(
    element &&
    // Signed in, Agnes uses a Lexical editor; signed out, a single textarea
    // with a localized placeholder.
    (element.tagName === 'TEXTAREA' || isAgnesLexicalInput(element)) &&
    element.offsetParent !== null
  );
}

function insertAgnesNewline(input) {
  if (input.tagName === 'TEXTAREA') {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText('\n', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Let the Lexical editor handle native line breaks.
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
  if (!isAgnesInput(input)) {
    return;
  }

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertAgnesNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  const sendButton = window.ButtonFinderUtils?.findButton(AGNES_SEND_BUTTON_SELECTORS);
  if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
    sendButton.click();
  }
}

applyEnterSwapSetting();
