(function(runtime) {
  'use strict';

  /**
   * Owns config behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createConfigController() {
    const ANSWER_TEXT_BLOCK_BOUNDARY_TAGS = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
      'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
      'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
    ]);

    // Longest answer text sent to Multi-Panel for the AI summary.
    const ANSWER_TEXT_MAX_LENGTH = 20000;
    const FOCUS_GUARD_MAX_MS = 15000;
    const PAGE_WIDTH_REPORT_THROTTLE_MS = 500;
    const COMPOSER_READY_CHECK_THROTTLE_MS = 250;

    // Multi-Panel stops waiting long before this; a later report still clears
    // its "not ready" notice.
    const COMPOSER_READY_MAX_WAIT_MS = 60000;

    // The app shell is near the top of the tree; deeper nodes are content.
    const PAGE_WIDTH_MAX_DEPTH = 12;
    const PAGE_WIDTH_MAX_ELEMENTS = 1000;
    const PAGE_WIDTH_SCROLLING_OVERFLOW = /^(auto|scroll)$/;

    // Normalized prompt prefix that identifies the user's message.
    const SNAPSHOT_MATCH_KEY_LENGTH = 40;
    const SNAPSHOT_MIN_MATCH_KEY_LENGTH = 2;
    const SNAPSHOT_MAX_MATCH_CANDIDATES = 50;
    const SNAPSHOT_ALIGN_MARGIN_PX = 16;
    const SNAPSHOT_PAINT_SETTLE_MS = 100;
    const SNAPSHOT_PAINT_TIMEOUT_MS = 400;

    // A conversation list fills a good part of the frame; smaller scrolling
    // boxes are code blocks or collapsed messages.
    const SNAPSHOT_MIN_CONTAINER_HEIGHT_RATIO = 0.3;

    // Pinned bars cover at most this share of the container at each edge.
    const SNAPSHOT_MAX_EDGE_RATIO = 0.4;
    const SNAPSHOT_OVERLAY_MIN_WIDTH_RATIO = 0.5;
    const SNAPSHOT_EDGE_TOLERANCE_PX = 24;

    // Floating buttons and fades hidden while stitching are at most this share
    // of the visible conversation high; taller layers are backgrounds.
    const SNAPSHOT_MAX_FLOATING_HEIGHT_RATIO = 0.5;
    const SNAPSHOT_HIDDEN_MASK_PROPERTIES = ['mask-image', '-webkit-mask-image'];

    // Ancestors with these cut off what lies outside them.
    const SNAPSHOT_CLIPPING_OVERFLOW = /^(hidden|clip|auto|scroll|overlay)$/;
    const SNAPSHOT_SKIPPED_TEXT_PARENTS = [
      'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select',
      '[contenteditable=""]', '[contenteditable="true"]', '[aria-hidden="true"]'
    ].join(', ');

    // Chat history lists and links repeat prompts as titles; they are not the
    // conversation.
    const SNAPSHOT_NAVIGATION_PARENTS = 'nav, aside, [role="navigation"], [role="complementary"], a[href]';

    // User messages by role attribute or known bubble, for when the prompt is
    // not on the page (e.g. typed into the provider directly).
    const SNAPSHOT_USER_TURN_SELECTORS = [
      '[data-message-author-role="user"]', // ChatGPT
      '[data-testid="user-message"]', // Claude
      'user-query', // Gemini
      '[class*="items-end"] .message-bubble', // Grok
      '[data-role="user"]',
      '[data-author="user"]',
      '[data-message-role="user"]',
      '[data-sender="user"]',
      '[data-content="user-message"]', // Copilot
      '[data-testid="send_message"]', // Doubao
      '.chat-content-item-user', // Kimi
      '.chat-user-message' // Qwen
    ].join(', ');

    // How far an aligned message may be from where it was put.
    const SNAPSHOT_ALIGN_TOLERANCE_PX = 2;

    // Paints to wait for a virtual list to grow back to the position it had.
    const SNAPSHOT_RESTORE_ATTEMPTS = 10;

    // Inline properties set to take a sticky box out of sticking, keeping its
    // place in the flow.
    const SNAPSHOT_UNSTICK_PROPERTIES = ['position', 'top', 'right', 'bottom', 'left'];

    // Marks pseudo-elements to hide (e.g. "before after") and the document
    // whose pointer is hidden; styled by SNAPSHOT_STYLE_RULES.
    const SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE = 'data-panelize-snapshot-hide';
    const SNAPSHOT_HIDE_CURSOR_ATTRIBUTE = 'data-panelize-snapshot-cursor';
    const SNAPSHOT_STYLE_RULES = `
    [${SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE}~="before"]::before,
    [${SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE}~="after"]::after { visibility: hidden !important; }
    [${SNAPSHOT_HIDE_CURSOR_ATTRIBUTE}], [${SNAPSHOT_HIDE_CURSOR_ATTRIBUTE}] *,
    [${SNAPSHOT_HIDE_CURSOR_ATTRIBUTE}] *::before, [${SNAPSHOT_HIDE_CURSOR_ATTRIBUTE}] *::after { cursor: none !important; }
  `;

    const SNAPSHOT_STYLE_ELEMENT_ID = 'panelize-snapshot-style';
    const USER_FOCUS_RESTORE_WINDOW_MS = 2000;
    const CHATGPT_STOP_BUTTON_SELECTOR = 'button[data-testid="stop-button"]';
    const CHATGPT_SEND_TRACKING_IDLE_DELAY_MS = 800;
    const CHATGPT_SEND_TRACKING_NO_BUSY_TIMEOUT_MS = 2000;

    // Response timing for answer stats. An answer is the last assistant turn
    // added after the send; it is done once the provider's stop control is gone
    // and its text has not changed for the provider's settle time. Without a
    // known stop control, the settle time alone decides.
    const RESPONSE_TIMING_PROVIDERS = {
      chatgpt: {
        // Current layout: the answer's markdown inside the assistant turn, whose
        // own text starts with a hidden speaker label. The turn carries
        // data-message-streaming while it generates. The author-role turn is the
        // legacy layout. Signed in, the answer is the assistant markdown root and
        // its turn carries data-talvt-turn-state="in_progress" while it generates.
        answerSelector: '[data-message-role="assistant"] [data-assistant-markdown-root], [data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]',
        busySelector: `${CHATGPT_STOP_BUTTON_SELECTOR}, [data-message-role="assistant"][data-message-streaming], [data-talvt-turn-state="in_progress"]`,
        settleMs: 3000
      },
      gemini: {
        answerSelector: 'model-response',
        busySelector: 'button.send-button.stop, button[aria-label="Stop response"]',
        settleMs: 3000
      },
      deepseek: {
        answerSelector: '.ds-markdown',
        busySelector: null,
        // Reasoning can pause between the thinking and the answer.
        settleMs: 5000
      },
      kimi: {
        // Both the thinking and the answer render as .markdown.
        answerSelector: '.chat-content-item-assistant .markdown',
        busySelector: '.send-button-container.stop',
        settleMs: 3000
      },
      'qwen-cn': {
        answerSelector: '.answer-common-card .qk-markdown',
        busySelector: '.answer-receiving-card',
        settleMs: 3000
      },
      yuanbao: {
        answerSelector: '.agent-chat__bubble--ai .agent-chat__speech-text',
        busySelector: null,
        settleMs: 5000
      },
      chatglm: {
        // The thinking and the answer each render as .markdown-body inside the
        // answer row; the answer's is added after the thinking's.
        answerSelector: '.answer .markdown-body',
        // The send button carries .searching for the whole reply, including the
        // pauses between thinking, searching and the answer.
        busySelector: '#search-input-box .enter.is-main-chat.searching',
        settleMs: 5000
      },
      'zai-global': {
        answerSelector: '.chat-assistant #response-content-container',
        // While answering, the send button turns into a stop button whose
        // tooltip trigger carries the localized label.
        busySelector: '[data-tooltip-trigger][aria-label="停止"], [data-tooltip-trigger][aria-label="Stop"]',
        settleMs: 3000
      },
      mimo: {
        answerSelector: '.markdown-blocks',
        busySelector: '[data-is-typing="true"]',
        settleMs: 3000
      },
      'qwen-global': {
        // The answer content appears once thinking ends; the stop button shows
        // for the whole reply.
        answerSelector: '.qwen-chat-message-assistant .response-message-content',
        busySelector: 'button.stop-button',
        settleMs: 3000
      },
      grok: {
        answerSelector: '[data-testid="assistant-message"] .response-content-markdown',
        busySelector: 'button[aria-label="Stop model response"]',
        settleMs: 3000
      },
      'meta-ai': {
        // The thinking summary and the answer each render as .markdown-content.
        answerSelector: '[data-testid="assistant-message"] .markdown-content',
        busySelector: '[data-testid="composer-stop-button"], [data-testid="assistant-message"][data-streaming-complete="false"]',
        settleMs: 3000
      },
      doubao: {
        answerSelector: '[data-testid="receive_message"] [data-testid="message_text_content"]',
        busySelector: '[data-testid="message_text_content"][data-streaming="true"]',
        settleMs: 3000
      },
      google: {
        // AI Mode answers in place; each turn's main column holds the answer
        // without the hidden "AI Mode reply for" label.
        answerSelector: '[data-subtree="aimc"] [data-container-id="main-col"]',
        busySelector: null,
        settleMs: 5000
      },
      wenxin: {
        // Each reply's search steps, document card and closing note render in
        // one generate item; the send button shows a pause icon while it answers.
        answerSelector: '.answer-box .chat-search-answer-generate-item',
        busySelector: 'img.ci-submit-pause',
        settleMs: 3000
      },
      perplexity: {
        // Each answer's text renders in a prose block; the query bubble does not.
        answerSelector: 'div.prose[data-renderer="lm"]',
        busySelector: null,
        settleMs: 5000
      },
      copilot: {
        answerSelector: '[data-testid="markdown-reply"]',
        busySelector: null,
        settleMs: 5000
      }
    };

    const RESPONSE_TIMING_CHECK_INTERVAL_MS = 250;
    const RESPONSE_TIMING_NO_OUTPUT_TIMEOUT_MS = 5 * 60 * 1000;
    const RESPONSE_TIMING_MAX_DURATION_MS = 15 * 60 * 1000;

    // Clicks and scrolls on the last sent answer count towards its answer stats
    // score. Each kind is reported at most once per interval.
    const ANSWER_ENGAGEMENT_REPORT_INTERVAL_MS = 1000;
    const ANSWER_ENGAGEMENT_EVENT_KINDS = {
      pointerdown: 'click',
      wheel: 'scroll',
      touchmove: 'scroll'
    };

    const TEMP_CHAT_POLL_INTERVAL_MS = 200;
    const TEMP_CHAT_POLL_TIMEOUT_MS = 1200;
    const YUANBAO_TEMP_CHAT_CLICK_COOLDOWN_MS = 5000;
    const IMAGE_UPLOAD_PREVIEW_TIMEOUT_MS = 6000;
    const NEW_CHAT_PENDING_STORAGE_PREFIX = 'panelize.pending-new-chat.v1:';
    const NEW_CHAT_PENDING_MAX_AGE_MS = 2 * 60 * 1000;
    const NEW_CHAT_CONFIRMATION_TIMEOUT_MS = 12000;
    const NEW_CHAT_RECOVERY_STABLE_MS = 1800;
    const NEW_CHAT_CLICK_STABLE_MS = 750;
    const NEW_CHAT_CONFIRMATION_POLL_MS = 200;
    const NEW_CHAT_ASSISTANT_TURN_SELECTORS = [
      '[data-message-author-role="assistant"]',
      '[data-testid="assistant-message"]',
      'model-response',
      '[data-role="assistant"]',
      '[data-author="assistant"]',
      '[data-message-role="assistant"]'
    ].join(', ');

    const NEW_CHAT_ATTACHMENT_PREVIEW_SELECTORS = [
      '[role="list"][aria-label="Conversation attachments"] > *',
      '[aria-label="Conversation attachments"] > *',
      '[data-testid*="attachment-preview"]',
      '[data-testid*="file-preview"]',
      '[data-testid*="image-preview"]',
      '[data-slot*="attachment-preview"]',
      '[class*="attachment-preview"]',
      '[class*="file-preview"]',
      '[class*="image-preview"]',
      '[data-file-name]',
      '.image-thumbnail',
      '.file-list-box-content-list > *',
      'button[aria-label*="No text extracted"]',
      'button[aria-label*="Attached file"]',
      'img[src^="blob:"]'
    ].join(', ');

    // Only click a control inside an attachment preview when its own label says
    // it removes something; a preview itself usually opens a viewer.
    const COMPOSER_ATTACHMENT_REMOVE_LABEL = /remove|delete|dismiss|close|移除|删除|清除|取消/i;
    const SLOW_COMPOSER_PROVIDERS = new Set([
      'deepseek', 'kimi', 'doubao', 'chatglm', 'zai-global', 'yuanbao', 'mimo', 'meta-ai',
      'stepfun', 'agnes', 'hy-aistudio', 'perplexity', 'copilot', 'wenxin'
    ]);

    const IMAGE_INJECTION_REASONS = Object.freeze({
      CONTROL_NOT_FOUND: 'control-not-found',
      UNSUPPORTED: 'unsupported',
      PREVIEW_TIMEOUT: 'preview-timeout',
      INJECTION_ERROR: 'injection-error'
    });

    // Provider-specific selectors. ChatGPT's composer lookup lives in
    // chatgpt-composer.js, shared with the other ChatGPT content scripts.
    const PROVIDER_SELECTORS = {
      claude: [
        '.ProseMirror[role="textbox"]',
        '.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"].ProseMirror',
        'div[contenteditable="true"]'
      ],
      gemini: ['.ql-editor'],
      grok: ['.tiptap', '.ProseMirror', 'textarea'],
      deepseek: [
        'textarea[placeholder="How can I help you?"]',
        'textarea.ds-scroll-area',
        'textarea[class*="ds-"]',
        'textarea',
        'div[contenteditable="true"]'
      ],
      kimi: [
        '.chat-input-editor',
        'div[contenteditable="true"].chat-input-editor',
        'div.chat-input-editor[contenteditable]',
        'div[contenteditable="true"]'
      ],
      doubao: [
        '#input-engine-container .ProseMirror[contenteditable="true"]',
        '#input-engine-container .semi-input-textarea-wrapper textarea',
        '.semi-input-textarea-wrapper textarea',
        '#input-engine-container textarea',
        'textarea.semi-input-textarea',
        'textarea.semi-input-textarea[placeholder="发消息..."]',
        'textarea[placeholder="发消息..."]',
        '[data-slate-editor="true"][contenteditable="true"]',
        '.flow-chat-editor [data-slate-editor="true"][contenteditable="true"]',
        '.flow-chat-editor [contenteditable="true"][role="textbox"]',
        '.flow-chat-editor [contenteditable="true"]',
        '[contenteditable="true"][role="textbox"]'
      ],
      'qwen-cn': [
        '[data-chat-input-layout="true"] [data-chat-input-body="true"] [data-slate-editor="true"][contenteditable="true"][role="textbox"]'
      ],
      'qwen-global': [
        '#message-input-container textarea.message-input-textarea',
        '.message-input-container textarea.message-input-textarea'
      ],
      chatglm: [
        '#search-input-box textarea.scroll-display-none',
        'textarea.scroll-display-none'
      ],
      'zai-global': [
        'textarea[placeholder="How can I help you today?"]',
        'textarea.input-scroll'
      ],
      yuanbao: [
        '.chat-command-editor-specail .ql-editor[contenteditable="true"]',
        '.ql-editor[contenteditable="true"][data-placeholder]'
      ],
      // Injection uses ButtonFinderUtils.findMimoInput() (see findProviderInputs());
      // this entry lets selector-based tooling such as the live smoke test find it.
      mimo: ['textarea'],
      // Prefer Meta AI's visible Lexical editor; its textarea mirror can be hidden.
      'meta-ai': [
        '[data-testid="composer-input"][contenteditable="true"]',
        'textarea[data-testid="composer-input"]',
        'input[data-testid="composer-input"]',
        // Signed out, Meta AI shows a plain one-line input instead.
        '[data-slot="logged-out-composer-input"] input[type="text"]'
      ],
      stepfun: ['textarea[data-slot="textarea"]'],
      agnes: [
        // Signed in, Agnes uses a Lexical editor; the textareas are its signed-out page.
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'textarea[placeholder="分配一个任务或提问任何问题"]',
        'textarea[rows="1"]'
      ],
      // Perplexity's signed-in Lexical editor was verified in the browser.
      perplexity: [
        'div#ask-input[contenteditable="true"][role="textbox"][data-lexical-editor="true"]',
        '#ask-input[contenteditable="true"]',
        'textarea#ask-input',
        '[contenteditable="true"][data-lexical-editor="true"][role="textbox"]'
      ],
      copilot: [
        '#m365-chat-input-shared-container span#m365-chat-editor-target-element[role="textbox"][contenteditable="true"][data-lexical-editor="true"]'
      ],
      wenxin: ['textarea#chat-textarea.ci-textarea'],
      'hy-aistudio': ['.hy-chat-input__content textarea.t-textarea__inner', 'textarea[placeholder="有问题，尽管问"]'],
      google: [
        'textarea.ITIRGe',
        'textarea[aria-label="Ask anything"]',
        'textarea[maxlength="8192"]'
      ]
    };

    const GOOGLE_AI_INPUT_SELECTORS = [
      'textarea.ITIRGe',
      'textarea[aria-label="Ask anything"]',
      'textarea[maxlength="8192"]'
    ];

    const GOOGLE_SEARCH_INPUT_SELECTORS = [
      'input[name="q"]',
      'textarea[name="q"]',
      'input.gLFyf',
      'textarea.gLFyf'
    ];

    // Provider image support configuration
    const PROVIDER_IMAGE_SUPPORT = {
      chatgpt: true,
      claude: true,
      gemini: true,
      grok: true,
      deepseek: true,
      kimi: true,
      doubao: true,
      'qwen-cn': true,
      'qwen-global': true,
      chatglm: true,
      'zai-global': true,
      yuanbao: true,
      mimo: true,
      'meta-ai': true,
      stepfun: true,
      google: true  // Google AI Mode supports images
    };

    // Providers whose upload path also takes non-image files (PDFs, documents,
    // code). The others only verify image thumbnails, so they report such files
    // as unsupported instead of waiting for a preview that never appears.
    const PROVIDER_FILE_SUPPORT = new Set([
      'chatgpt',
      'claude',
      'gemini',
      'grok',
      'deepseek',
      'kimi'
    ]);

    // Provider-specific file input selectors for image upload
    const FILE_INPUT_SELECTORS = {
      chatgpt: ['input[type="file"][data-testid="file-upload-input"]', 'input[type="file"]'],
      claude: ['input[type="file"]'],
      gemini: ['input[type="file"]'],
      doubao: ['input[type="file"]'],
      'qwen-cn': ['input[type="file"][accept*="image"]'],
      'qwen-global': [
        '.message-input-container input#filesUpload',
        '#dropzone-container input#filesUpload'
      ],
      chatglm: ['input.el-upload__input[type="file"]'],
      'zai-global': ['input[type="file"][multiple][accept*=".png"]'],
      yuanbao: ['input[type="file"][multiple][accept*="image"]'],
      mimo: ['input[type="file"][multiple][accept*="image"]'],
      'meta-ai': ['input[type="file"]'],
      stepfun: ['input[type="file"][multiple][accept*="image"]'],
      google: ['input[type="file"]']
    };

    // Provider-specific upload button selectors (to click before file input)
    const UPLOAD_BUTTON_SELECTORS = {
      chatgpt: ['button[aria-label="Attach files"]', 'button[data-testid="composer-attach-button"]', 'button:has(svg path[d*="M9"])'],
      claude: ['button[aria-label="Attach file"]', 'button[aria-label="Upload file"]', 'fieldset button:has(svg)'],
      gemini: ['button[aria-label="Upload file"]', 'button[mattooltip="Upload file"]', '.add-button', 'button:has(mat-icon)'],
      doubao: [
        '#input-engine-container button[data-slot="dropdown-menu-trigger"][aria-haspopup="menu"]'
      ],
      yuanbao: [
        'button[data-new-input-control="add-tools-trigger"]',
        'button[aria-label="Add"]'
      ],
      google: [
        'button[aria-label="更多输入项"]',
        'button[aria-label="Upload image"]',
        'button[aria-label="上传图片"]',
        'button[aria-label="上传文件"]',
        'button[aria-label="Add image"]',
        'button[aria-label="Upload image"]',
        'button[aria-label="Add"]',
        'button[title="Add image"]',
        'button[title="Upload image"]',
        'button[data-xid*="image"]',
        'button[data-xid*="upload"]'
      ]
    };

    // Provider-specific send button selectors
    const SEND_BUTTON_SELECTORS = {
      chatgpt: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send"]',
        'form button[type="submit"]'
      ],
      claude: [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'fieldset button[type="button"]:has(svg)',
        'button.bg-accent-main-100'
      ],
      gemini: [
        'button[aria-label="Send message"]',
        'button[aria-label="发送"]',
        'button.send-button',
        'button[mattooltip="Send message"]',
        '.input-area-container button:has(mat-icon[fonticon="arrow_upward"])',
        'button[aria-label="Submit"]'
      ],
      grok: [
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]',
        'button[type="submit"]',
        'form button:has(svg)'
      ],
      deepseek: [
        // Current site: a design-system div button that is disabled by class.
        'div[role="button"].ds-button--primary.ds-button--filled:not(.ds-button--disabled)',
        'button[aria-label="Send"]',
        'button[type="submit"]'
      ],
      kimi: [
        // Priority: clickable send button containers that are not disabled
        '.send-button-container:not(.disabled)',
        'div[class*="send"]:not([class*="disabled"])',
        // Backup: look for send icon and click its parent
        'svg[name="Send"]',
        '.send-icon',
        // Try to find button by aria-label
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]'
      ],
      doubao: [
        '#flow-end-msg-send',
        'button#flow-end-msg-send',
        '#input-engine-container button#flow-end-msg-send',
        'button[data-testid="send-button"]',
        'button[data-test-id="send-button"]',
        'button[aria-label="Send"]',
        'button[aria-label="发送"]',
        'button[type="submit"]'
      ],
      'qwen-cn': [
        '[data-chat-input-layout="true"] button[aria-label="发送消息"]'
      ],
      'qwen-global': [
        '#message-input-container .chat-prompt-send-button button.send-button',
        '.message-input-container .chat-prompt-send-button button.send-button'
      ],
      chatglm: [
        '#search-input-box .enter.is-main-chat .enter-icon-container',
        '#search-input-box .enter.is-main-chat',
        '.enter.is-main-chat'
      ],
      'zai-global': [
        'button.sendMessageButton'
      ],
      yuanbao: [
        '#yuanbao-send-btn[aria-label="Send"]',
        '#yuanbao-send-btn'
      ],
      mimo: [
        'button[data-track-id="home_send_btn"]'
      ],
      // Meta AI swaps this button for composer-stop-button while answering.
      // Its logged-out composer uses a separate, localized control without a test id.
      'meta-ai': [
        'button[data-testid="composer-send-button"]',
        '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="Send"]',
        '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="发送"]',
        '[data-slot="logged-out-composer-controls"] button[data-slot="button"][aria-label="發送"]'
      ],
      stepfun: [
        'button[data-slot="button"][aria-label="发送"]',
        'button[data-slot="button"][aria-label="Send"]'
      ],
      // Perplexity's verified editor is in a .bg-composer div, not a form.
      perplexity: [
        '.bg-composer:has(#ask-input) button[aria-label="提交"]',
        '.bg-composer:has(#ask-input) button[aria-label="Submit"]',
        '.bg-composer:has(#ask-input) button[aria-label="Send"]',
        '.bg-composer:has(#ask-input) button[aria-label="发送"]',
        '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="提交"]',
        '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="Submit"]',
        '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="Send"]',
        '.bg-composer:has([contenteditable="true"][data-lexical-editor="true"][role="textbox"]) button[aria-label="发送"]'
      ],
      copilot: [
        '#m365-chat-input-shared-container button.fai-SendButton',
        '#m365-chat-input-shared-container button[aria-label="Send"]',
        '#m365-chat-input-shared-container button[aria-label="发送"]'
      ],
      wenxin: ['img#ci-submit-button-ai.ci-submit-button-ai-active'],
      agnes: [
        'button[title="Send"]',
        'button[title="发送"]',
        'button[aria-label="Send"]',
        'button[aria-label="发送"]'
      ],
      // A div that is disabled by class.
      'hy-aistudio': ['.hy-chat-input-send-btn:not(.hy-chat-input-send-btn--disabled)'],
      google: [
        'button[data-xid="input-plate-send-button"]',
        'button[aria-label="Send"]',
        'button.OEueve'
      ]
    };

    // Provider-specific new chat button selectors and URLs
    const NEW_CHAT_BUTTON_SELECTORS = {
      chatgpt: [
        'a[aria-label="New chat"]',
        'button[aria-label="New chat"]',
        'a[href="/"]',
        'nav a[href="/"]',
        'aside a[href="/"]',
        '[data-testid="new-chat-button"]'
      ],
      claude: [
        'button[aria-label="Start new chat"]',
        'button[aria-label*="new chat"]',
        'a[href="/new"]',
        'a[href="https://claude.ai/new"]',
        'div[role="button"][aria-label*="New"]'
      ],
      gemini: [
        'button[aria-label="New chat"]',
        'button[aria-label*="New"]',
        'a[aria-label="New chat"]'
      ],
      grok: [
        'a[href="/"]',
        'button[aria-label*="New"]',
        'a[href*="new"]'
      ],
      deepseek: [
        // Current site: the sidebar "New chat" item is a focusable div with an
        // icon and a label and no role; its only class is a build hash.
        'div[tabindex="0"]:not([role]):has(> .ds-icon):has(> span)',
        'button[aria-label*="New"]',
        'a[href="/"]',
        'div[class*="new-chat"]'
      ],
      kimi: [
        'a.new-chat-btn',
        'a[href="/"]',
        '.sidebar a[href="/"]'
      ],
      doubao: [
        '#flow_chat_sidebar [data-testid="create_conversation_button"]',
        '#flow_chat_sidebar > div.cursor-pointer',
        '#flow_chat_sidebar > div[class*="cursor-pointer"]',
        'button[data-testid="new-chat-button"]',
        'button[data-test-id="new-chat-button"]',
        'button[data-testid="new-conversation-button"]',
        'button[data-test-id="new-conversation-button"]',
        'a[href="/chat/"]',
        'a[href="/chat"]',
        // The header control shown while the sidebar is collapsed.
        '[data-testid*="create_conversation"]',
        'button[aria-label*="新对话"]',
        'button[aria-label*="新建对话"]',
        'button[aria-label*="New chat"]',
        'button[aria-label*="New Chat"]'
      ],
      'qwen-cn': [
        '#new-nav-tab-wrapper [data-session-switch-target="new-chat"]',
        '#new-nav-tab-wrapper button:has([data-icon-type="qwpcicon-newDialogue"])'
      ],
      'qwen-global': [
        'button.new-chat',
        '[role="button"].new-chat',
        '[data-testid="sidebar-new-chat-button"]'
      ],
      chatglm: ['.aside-subjects .new-session'],
      'zai-global': [
        'button[aria-label="New Chat"]',
        'button.navNewChat'
      ],
      yuanbao: [
        '[role="button"][aria-label="New Chat"]',
        '.yb-new-chat-entry__item[aria-label="New Chat"]',
        '.yb-projects-section__item-new-chat[aria-label="New Chat"]',
        '[role="button"][aria-label="新建对话"]',
        '[role="button"][aria-label="新建對話"]'
      ],
      mimo: [
        'button[data-track-id="navbar_new_chat_btn"]',
        'button[data-track-id="sidebar_ultra_new_chat_btn"]'
      ],
      'meta-ai': [
        '[data-testid="new-chat-button"]'
      ],
      google: [
        'button[aria-label="New search"]',
        'a[aria-label="Google"]',
        'a[href^="/search"][href*="udm="]'
      ]
    };

    // Fallback URLs for creating new chat when button not found
    const NEW_CHAT_URLS = {
      chatgpt: 'https://chatgpt.com/',
      claude: 'https://claude.ai/new',
      gemini: 'https://gemini.google.com/app',
      grok: 'https://grok.com/',
      deepseek: 'https://chat.deepseek.com/',
      kimi: 'https://www.kimi.com/',
      doubao: 'https://www.doubao.com/chat/',
      'qwen-cn': 'https://www.qianwen.com/',
      'qwen-global': 'https://chat.qwen.ai/c/new-chat',
      chatglm: 'https://chatglm.cn/',
      'zai-global': 'https://chat.z.ai/',
      // Keep this in sync with YUANBAO_DEFAULT_URL in modules/providers/providers.js.
      yuanbao: 'https://yuanbao.tencent.com/chat/naQivTmsDa',
      mimo: 'https://aistudio.xiaomimimo.com/#/c',
      'meta-ai': 'https://www.meta.ai/',
      // StepFun's New Chat control has no stable selector; the root opens a new chat.
      stepfun: 'https://studio.stepfun.com/',
      agnes: 'https://app.agnes-ai.com/',
      perplexity: 'https://www.perplexity.ai/',
      copilot: 'https://copilot.com/chat',
      wenxin: 'https://wenxin.baidu.com/',
      'hy-aistudio': 'https://aistudio.tencent.com/',
      google: 'https://www.google.com/search?udm=50'
    };

    const TEMP_CHAT_BUTTON_SELECTORS = {
      chatgpt: ['button[aria-label="Turn on temporary chat"]'],
      claude: ['button[aria-label="Use incognito"]'],
      gemini: [
        'button[data-test-id="temp-chat-button"]',
        'button[aria-label="Temporary chat"]'
      ],
      grok: ['a[href="/c#private"][aria-label="Switch to Private Chat"]'],
      yuanbao: [
        '[role="button"][aria-label="Enter Temporary Chat"]',
        '[role="button"][aria-label="Exit Temporary Chat"]',
        '[role="button"][aria-label="进入临时对话"]',
        '[role="button"][aria-label="退出临时对话"]',
        '[role="button"][aria-label="進入臨時對話"]',
        '[role="button"][aria-label="退出臨時對話"]'
      ]
    };

    // Detect which provider we're on based on hostname
    function detectProvider() {
      const hostname = window.location.hostname;
      const pathname = window.location.pathname;
      const search = window.location.search;

      if (hostname.includes('chatgpt.com') || hostname.includes('openai.com')) {
        return 'chatgpt';
      } else if (hostname.includes('claude.ai')) {
        return 'claude';
      } else if (hostname.includes('gemini.google.com')) {
        return 'gemini';
      } else if (hostname.includes('grok.com')) {
        return 'grok';
      } else if (hostname.includes('deepseek.com')) {
        return 'deepseek';
      } else if (hostname.includes('kimi.com')) {
        return 'kimi';
      } else if (hostname.includes('doubao.com')) {
        return 'doubao';
      } else if (hostname === 'www.qianwen.com') {
        return 'qwen-cn';
      } else if (hostname === 'chat.qwen.ai') {
        return 'qwen-global';
      } else if (hostname === 'chatglm.cn') {
        return 'chatglm';
      } else if (hostname === 'chat.z.ai') {
        return 'zai-global';
      } else if (hostname === 'yuanbao.tencent.com') {
        return 'yuanbao';
      } else if (hostname === 'aistudio.xiaomimimo.com') {
        return 'mimo';
      } else if (hostname === 'www.meta.ai') {
        return 'meta-ai';
      } else if (hostname === 'studio.stepfun.com') {
        return 'stepfun';
      } else if (hostname === 'app.agnes-ai.com') {
        return 'agnes';
      } else if (hostname === 'www.perplexity.ai' || hostname === 'perplexity.ai') {
        return 'perplexity';
      } else if (hostname === 'copilot.com' || hostname.endsWith('.copilot.com') || hostname === 'copilot.microsoft.com') {
        return 'copilot';
      } else if (hostname === 'wenxin.baidu.com') {
        return 'wenxin';
      } else if (hostname === 'aistudio.tencent.com') {
        return 'hy-aistudio';
      } else if (hostname.includes('google.com') || hostname.includes('google.') || hostname === 'www.google.com') {
        // Google Search / AI Mode
        // Always return 'google' for any google.com page
        // The handleGoogleNewSearch will navigate to homepage which works for all cases
        return 'google';
      }
      return null;
    }

    // Doubao is built on Semi Design: in a narrow panel the sidebar becomes a
    // drawer behind a mask, and login or rate-limit prompts are modals.
    const DOUBAO_OVERLAY_DIALOG_SELECTORS = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '.semi-modal',
      '.semi-sidesheet'
    ];

    const DOUBAO_OVERLAY_MASK_SELECTORS = [
      // Live 2026-10-26: the narrow-layout sidebar drawer's mask is
      // `div.fixed.inset-0.bg-[var(--s-color-bg-mask)].cursor-pointer`, hidden
      // with `.hidden` while the drawer is collapsed off-screen.
      '.fixed.inset-0[class*="s-color-bg-mask"]',
      '.semi-sidesheet-mask',
      '.semi-modal-mask',
      '[class*="drawer-mask"]',
      '[class*="sidebar-mask"]',
      '[data-testid*="mask"]'
    ];

    const DOUBAO_OVERLAY_CLOSE_SELECTORS = [
      '.semi-sidesheet-close',
      '.semi-modal-close',
      '[data-testid*="close"]',
      'button[aria-label*="关闭"]',
      'button[aria-label*="Close"]'
    ];

    const DOUBAO_SIDEBAR_COLLAPSE_SELECTORS = [
      '[data-testid*="sidebar_collapse"]',
      '#flow_chat_sidebar button[aria-label*="收起"]',
      '#flow_chat_sidebar button[aria-label*="Collapse"]'
    ];

    const DOUBAO_BLOCKING_DIALOG_SELECTORS = ['[data-testid*="login"]'];
    const DOUBAO_BLOCKING_DIALOG_KEYWORDS = [
      '登录', 'log in', 'login', 'sign in', '频繁', '上限', '稍后再试', '验证码',
      'too many', 'rate limit', 'try again later', 'captcha'
    ];

    const ROOT_NEW_CHAT_PATHS = new Set(['/', '/chat', '/chat/']);
    const DOUBAO_MAX_DISMISS_ATTEMPTS = 3;

    // Doubao's sidebar and composer also offer "新建项目" / "New project", which
    // opens the create-project dialog instead of a new chat.
    const DOUBAO_PROJECT_KEYWORDS = ['项目', 'project'];

    // Providers keep Send disabled while an attachment is still uploading, so
    // a send after an attachment fill keeps trying until the control enables.
    const SEND_READY_POLL_MS = 400;
    const SEND_READY_TIMEOUT_MS = 20000;

    return {
      get ANSWER_ENGAGEMENT_EVENT_KINDS() { return ANSWER_ENGAGEMENT_EVENT_KINDS; },
      get ANSWER_ENGAGEMENT_REPORT_INTERVAL_MS() { return ANSWER_ENGAGEMENT_REPORT_INTERVAL_MS; },
      get ANSWER_TEXT_BLOCK_BOUNDARY_TAGS() { return ANSWER_TEXT_BLOCK_BOUNDARY_TAGS; },
      get ANSWER_TEXT_MAX_LENGTH() { return ANSWER_TEXT_MAX_LENGTH; },
      get CHATGPT_SEND_TRACKING_IDLE_DELAY_MS() { return CHATGPT_SEND_TRACKING_IDLE_DELAY_MS; },
      get CHATGPT_SEND_TRACKING_NO_BUSY_TIMEOUT_MS() { return CHATGPT_SEND_TRACKING_NO_BUSY_TIMEOUT_MS; },
      get CHATGPT_STOP_BUTTON_SELECTOR() { return CHATGPT_STOP_BUTTON_SELECTOR; },
      get COMPOSER_ATTACHMENT_REMOVE_LABEL() { return COMPOSER_ATTACHMENT_REMOVE_LABEL; },
      get COMPOSER_READY_CHECK_THROTTLE_MS() { return COMPOSER_READY_CHECK_THROTTLE_MS; },
      get COMPOSER_READY_MAX_WAIT_MS() { return COMPOSER_READY_MAX_WAIT_MS; },
      get DOUBAO_BLOCKING_DIALOG_KEYWORDS() { return DOUBAO_BLOCKING_DIALOG_KEYWORDS; },
      get DOUBAO_BLOCKING_DIALOG_SELECTORS() { return DOUBAO_BLOCKING_DIALOG_SELECTORS; },
      get DOUBAO_MAX_DISMISS_ATTEMPTS() { return DOUBAO_MAX_DISMISS_ATTEMPTS; },
      get DOUBAO_OVERLAY_CLOSE_SELECTORS() { return DOUBAO_OVERLAY_CLOSE_SELECTORS; },
      get DOUBAO_OVERLAY_DIALOG_SELECTORS() { return DOUBAO_OVERLAY_DIALOG_SELECTORS; },
      get DOUBAO_OVERLAY_MASK_SELECTORS() { return DOUBAO_OVERLAY_MASK_SELECTORS; },
      get DOUBAO_PROJECT_KEYWORDS() { return DOUBAO_PROJECT_KEYWORDS; },
      get DOUBAO_SIDEBAR_COLLAPSE_SELECTORS() { return DOUBAO_SIDEBAR_COLLAPSE_SELECTORS; },
      get FILE_INPUT_SELECTORS() { return FILE_INPUT_SELECTORS; },
      get FOCUS_GUARD_MAX_MS() { return FOCUS_GUARD_MAX_MS; },
      get GOOGLE_AI_INPUT_SELECTORS() { return GOOGLE_AI_INPUT_SELECTORS; },
      get GOOGLE_SEARCH_INPUT_SELECTORS() { return GOOGLE_SEARCH_INPUT_SELECTORS; },
      get IMAGE_INJECTION_REASONS() { return IMAGE_INJECTION_REASONS; },
      get IMAGE_UPLOAD_PREVIEW_TIMEOUT_MS() { return IMAGE_UPLOAD_PREVIEW_TIMEOUT_MS; },
      get NEW_CHAT_ASSISTANT_TURN_SELECTORS() { return NEW_CHAT_ASSISTANT_TURN_SELECTORS; },
      get NEW_CHAT_ATTACHMENT_PREVIEW_SELECTORS() { return NEW_CHAT_ATTACHMENT_PREVIEW_SELECTORS; },
      get NEW_CHAT_BUTTON_SELECTORS() { return NEW_CHAT_BUTTON_SELECTORS; },
      get NEW_CHAT_CLICK_STABLE_MS() { return NEW_CHAT_CLICK_STABLE_MS; },
      get NEW_CHAT_CONFIRMATION_POLL_MS() { return NEW_CHAT_CONFIRMATION_POLL_MS; },
      get NEW_CHAT_CONFIRMATION_TIMEOUT_MS() { return NEW_CHAT_CONFIRMATION_TIMEOUT_MS; },
      get NEW_CHAT_PENDING_MAX_AGE_MS() { return NEW_CHAT_PENDING_MAX_AGE_MS; },
      get NEW_CHAT_PENDING_STORAGE_PREFIX() { return NEW_CHAT_PENDING_STORAGE_PREFIX; },
      get NEW_CHAT_RECOVERY_STABLE_MS() { return NEW_CHAT_RECOVERY_STABLE_MS; },
      get NEW_CHAT_URLS() { return NEW_CHAT_URLS; },
      get PAGE_WIDTH_MAX_DEPTH() { return PAGE_WIDTH_MAX_DEPTH; },
      get PAGE_WIDTH_MAX_ELEMENTS() { return PAGE_WIDTH_MAX_ELEMENTS; },
      get PAGE_WIDTH_REPORT_THROTTLE_MS() { return PAGE_WIDTH_REPORT_THROTTLE_MS; },
      get PAGE_WIDTH_SCROLLING_OVERFLOW() { return PAGE_WIDTH_SCROLLING_OVERFLOW; },
      get PROVIDER_FILE_SUPPORT() { return PROVIDER_FILE_SUPPORT; },
      get PROVIDER_IMAGE_SUPPORT() { return PROVIDER_IMAGE_SUPPORT; },
      get PROVIDER_SELECTORS() { return PROVIDER_SELECTORS; },
      get RESPONSE_TIMING_CHECK_INTERVAL_MS() { return RESPONSE_TIMING_CHECK_INTERVAL_MS; },
      get RESPONSE_TIMING_MAX_DURATION_MS() { return RESPONSE_TIMING_MAX_DURATION_MS; },
      get RESPONSE_TIMING_NO_OUTPUT_TIMEOUT_MS() { return RESPONSE_TIMING_NO_OUTPUT_TIMEOUT_MS; },
      get RESPONSE_TIMING_PROVIDERS() { return RESPONSE_TIMING_PROVIDERS; },
      get ROOT_NEW_CHAT_PATHS() { return ROOT_NEW_CHAT_PATHS; },
      get SEND_BUTTON_SELECTORS() { return SEND_BUTTON_SELECTORS; },
      get SEND_READY_POLL_MS() { return SEND_READY_POLL_MS; },
      get SEND_READY_TIMEOUT_MS() { return SEND_READY_TIMEOUT_MS; },
      get SLOW_COMPOSER_PROVIDERS() { return SLOW_COMPOSER_PROVIDERS; },
      get SNAPSHOT_ALIGN_MARGIN_PX() { return SNAPSHOT_ALIGN_MARGIN_PX; },
      get SNAPSHOT_ALIGN_TOLERANCE_PX() { return SNAPSHOT_ALIGN_TOLERANCE_PX; },
      get SNAPSHOT_CLIPPING_OVERFLOW() { return SNAPSHOT_CLIPPING_OVERFLOW; },
      get SNAPSHOT_EDGE_TOLERANCE_PX() { return SNAPSHOT_EDGE_TOLERANCE_PX; },
      get SNAPSHOT_HIDDEN_MASK_PROPERTIES() { return SNAPSHOT_HIDDEN_MASK_PROPERTIES; },
      get SNAPSHOT_HIDE_CURSOR_ATTRIBUTE() { return SNAPSHOT_HIDE_CURSOR_ATTRIBUTE; },
      get SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE() { return SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE; },
      get SNAPSHOT_MATCH_KEY_LENGTH() { return SNAPSHOT_MATCH_KEY_LENGTH; },
      get SNAPSHOT_MAX_EDGE_RATIO() { return SNAPSHOT_MAX_EDGE_RATIO; },
      get SNAPSHOT_MAX_FLOATING_HEIGHT_RATIO() { return SNAPSHOT_MAX_FLOATING_HEIGHT_RATIO; },
      get SNAPSHOT_MAX_MATCH_CANDIDATES() { return SNAPSHOT_MAX_MATCH_CANDIDATES; },
      get SNAPSHOT_MIN_CONTAINER_HEIGHT_RATIO() { return SNAPSHOT_MIN_CONTAINER_HEIGHT_RATIO; },
      get SNAPSHOT_MIN_MATCH_KEY_LENGTH() { return SNAPSHOT_MIN_MATCH_KEY_LENGTH; },
      get SNAPSHOT_NAVIGATION_PARENTS() { return SNAPSHOT_NAVIGATION_PARENTS; },
      get SNAPSHOT_OVERLAY_MIN_WIDTH_RATIO() { return SNAPSHOT_OVERLAY_MIN_WIDTH_RATIO; },
      get SNAPSHOT_PAINT_SETTLE_MS() { return SNAPSHOT_PAINT_SETTLE_MS; },
      get SNAPSHOT_PAINT_TIMEOUT_MS() { return SNAPSHOT_PAINT_TIMEOUT_MS; },
      get SNAPSHOT_RESTORE_ATTEMPTS() { return SNAPSHOT_RESTORE_ATTEMPTS; },
      get SNAPSHOT_SKIPPED_TEXT_PARENTS() { return SNAPSHOT_SKIPPED_TEXT_PARENTS; },
      get SNAPSHOT_STYLE_ELEMENT_ID() { return SNAPSHOT_STYLE_ELEMENT_ID; },
      get SNAPSHOT_STYLE_RULES() { return SNAPSHOT_STYLE_RULES; },
      get SNAPSHOT_UNSTICK_PROPERTIES() { return SNAPSHOT_UNSTICK_PROPERTIES; },
      get SNAPSHOT_USER_TURN_SELECTORS() { return SNAPSHOT_USER_TURN_SELECTORS; },
      get TEMP_CHAT_BUTTON_SELECTORS() { return TEMP_CHAT_BUTTON_SELECTORS; },
      get TEMP_CHAT_POLL_INTERVAL_MS() { return TEMP_CHAT_POLL_INTERVAL_MS; },
      get TEMP_CHAT_POLL_TIMEOUT_MS() { return TEMP_CHAT_POLL_TIMEOUT_MS; },
      get UPLOAD_BUTTON_SELECTORS() { return UPLOAD_BUTTON_SELECTORS; },
      get USER_FOCUS_RESTORE_WINDOW_MS() { return USER_FOCUS_RESTORE_WINDOW_MS; },
      get YUANBAO_TEMP_CHAT_CLICK_COOLDOWN_MS() { return YUANBAO_TEMP_CHAT_CLICK_COOLDOWN_MS; },
      detectProvider,
    };
  }

  runtime.factories.createConfigController = createConfigController;
})(globalThis.PanelizeContent);
