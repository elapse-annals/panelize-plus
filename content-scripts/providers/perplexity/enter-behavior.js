// Perplexity Enter/Shift+Enter behavior swap.
// The signed-in composer structure and localized send control were verified in the browser.
// Depends on enter-behavior-utils.js and button-finder-utils.js.

const PERPLEXITY_SEND_BUTTON_SELECTORS = [
  '.bg-composer:has(#ask-input) button[aria-label="提交"]',
  '.bg-composer:has(#ask-input) button[aria-label="Submit"]',
  '.bg-composer:has(#ask-input) button[aria-label="Send"]',
  '.bg-composer:has(#ask-input) button[aria-label="发送"]',
  '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="提交"]',
  '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="Submit"]',
  '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="Send"]',
  '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="发送"]'
];

function isPerplexityInput(element) {
  return Boolean(
    element &&
    element.offsetParent !== null &&
    (
      (element.tagName === 'TEXTAREA' && element.id === 'ask-input') ||
      (element.isContentEditable && (
        element.id === 'ask-input' ||
        (element.getAttribute('data-lexical-editor') === 'true' && element.getAttribute('role') === 'textbox')
      ))
    )
  );
}

function insertPerplexityNewline(input) {
  if (input.tagName === 'TEXTAREA') {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.setRangeText('\n', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

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
  if (!isPerplexityInput(input)) return;

  if (matchesModifiers(event, enterKeyConfig.newlineModifiers)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    insertPerplexityNewline(input);
    return;
  }

  if (!matchesModifiers(event, enterKeyConfig.sendModifiers)) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const sendButton = window.ButtonFinderUtils?.findButton(PERPLEXITY_SEND_BUTTON_SELECTORS);
  if (sendButton && !sendButton.disabled && sendButton.getAttribute('aria-disabled') !== 'true') {
    sendButton.click();
  }
}

applyEnterSwapSetting();
