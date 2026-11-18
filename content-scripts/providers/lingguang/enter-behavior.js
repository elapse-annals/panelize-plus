// Lingguang Enter/Shift+Enter behavior swap.
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const LINGGUANG_SEND_BUTTON_SELECTORS = [
  {
    type: 'css',
    value: '[class*="input-footer-"] [class*="input-button-"] .anticon[role="img"]:not(.disabled)'
  },
  {
    type: 'css',
    value: '[class*="input-footer-"] [class*="input-button-"] .anticon:not(.disabled)'
  },
  {
    type: 'css',
    value: '[class*="button-container-"] .anticon[role="img"]:not(.disabled)'
  },
  {
    type: 'css',
    value: 'span[data-aspm$=".d568860"] .anticon:not(.disabled)'
  },
  {
    type: 'css',
    value: 'button[aria-label="发送"]'
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
    value: 'button[title="Send"]'
  }
];

// The site renders a visible antd textarea plus a hidden autosize textarea
// (name="hiddenTextarea", aria-hidden). Only the composer counts; a
// contenteditable editor stays supported in case the site swaps editors.
function isLingguangComposer(element) {
  if (!element || element.offsetParent === null || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  const container = element.closest?.(
    '[class*="input-textarea-container-"], [class*="input-container-"]'
  );

  if (element.tagName === 'TEXTAREA') {
    return element.name !== 'hiddenTextarea' &&
      (element.getAttribute('placeholder') === '问一问灵光' || Boolean(container));
  }

  return Boolean(
    element.isContentEditable &&
    (container || element.getAttribute('role') === 'textbox')
  );
}

function insertLingguangNewline(input) {
  if (input.tagName === 'TEXTAREA') {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText('\n', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Let the rich-text editor handle native line breaks.
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

function isLingguangSendControlEnabled(sendButton) {
  return Boolean(
    sendButton &&
    !sendButton.disabled &&
    sendButton.getAttribute('aria-disabled') !== 'true' &&
    !sendButton.classList?.contains('disabled')
  );
}

function handleEnterSwap(event) {
  if (!event.isTrusted || event.code !== 'Enter' || event.isComposing || !enterKeyConfig?.enabled) {
    return;
  }

  const input = document.activeElement;
  if (!isLingguangComposer(input)) {
    return;
  }

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertLingguangNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  const sendButton = window.ButtonFinderUtils?.findButton(LINGGUANG_SEND_BUTTON_SELECTORS);
  if (isLingguangSendControlEnabled(sendButton)) {
    sendButton.click();
  }
}

applyEnterSwapSetting();