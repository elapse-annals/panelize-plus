(function(runtime) {
  'use strict';

  /**
   * Owns answers behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createAnswersController({
    getConfigController,
    getProtocolController,
    getSecurityController
  }) {
    const quoteHighlightTimeouts = new WeakMap();
    let responseTiming = null;
    let answerEngagement = null;

    function getResponseAnswerState(config) {
      const answers = document.querySelectorAll(config.answerSelector);
      const answer = answers.length > 0 ? answers[answers.length - 1] : null;
      return {
        count: answers.length,
        answer,
        nodes: new Set(answers),
        text: answer ? (answer.textContent || '').trim() : ''
      };
    }

    function observeResponseAnswer(tracking) {
      if (typeof MutationObserver !== 'function') return;
      const { answerSelector } = tracking.config;
      const containsAnswer = (node) => node.nodeType === Node.ELEMENT_NODE && (
        tracking.state.nodes.has(node) || node.matches(answerSelector)
        || Boolean(node.querySelector(answerSelector))
      );
      tracking.observer = new MutationObserver((records) => {
        if (responseTiming !== tracking) return;
        for (const record of records) {
          const { answer } = tracking.state;
          if (answer?.contains(record.target)) tracking.textDirty = true;
          if (record.type === 'attributes') {
            if (tracking.state.nodes.has(record.target) || record.target.matches(answerSelector)) {
              tracking.answersDirty = true;
            }
          } else if (record.type === 'childList'
            && [...record.addedNodes, ...record.removedNodes].some(containsAnswer)) {
            tracking.answersDirty = true;
          }
        }
      });
      tracking.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'data-message-author-role']
      });
    }

    function readResponseAnswer(tracking) {
      if (!tracking.observer || tracking.answersDirty
        || (tracking.state.answer && !tracking.state.answer.isConnected)) {
        tracking.state = getResponseAnswerState(tracking.config);
      } else if (tracking.textDirty) {
        tracking.state = { ...tracking.state, text: (tracking.state.answer?.textContent || '').trim() };
      }
      tracking.answersDirty = false;
      tracking.textDirty = false;
      return tracking.state;
    }

    function readAnswerText(answer) {
      const text = String(answer?.innerText || answer?.textContent || '').trim();
      return text.length <= getConfigController().ANSWER_TEXT_MAX_LENGTH ? text : `${text.slice(0, getConfigController().ANSWER_TEXT_MAX_LENGTH - 1)}…`;
    }

    function postResponseTiming(tracking, phase, at) {
      if (window.parent === window) {
        return;
      }

      const message = {
        type: getProtocolController().PANELIZE_RESPONSE_TIMING,
        requestId: tracking.requestId,
        provider: tracking.provider,
        phase,
        at,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      };
      // A finished answer carries its text for the AI summary, sent only to the
      // extension page so no other embedder can read it.
      const hasAnswer = phase === 'complete' || (phase === 'timeout' && tracking.firstOutputAt);
      const text = hasAnswer && getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN ? readAnswerText(tracking.state.answer) : '';
      if (text) {
        window.parent.postMessage({ ...message, text }, getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN);
        return;
      }
      window.parent.postMessage(message, '*');
    }

    // Replies with the provider's last answer, for an AI summary asked for after
    // the timing finished or for a provider whose timing missed the answer.
    function handleAnswerTextRequest(event) {
      const { data } = event;
      if (!getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN || window.parent === window
        || event.source !== window.parent || event.origin !== getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN
        || typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 160) {
        return;
      }
      const provider = getConfigController().detectProvider();
      const answerSelector = getConfigController().RESPONSE_TIMING_PROVIDERS[provider]?.answerSelector;
      const answers = answerSelector ? document.querySelectorAll(answerSelector) : [];
      window.parent.postMessage({
        type: getProtocolController().PANELIZE_ANSWER_TEXT,
        requestId: data.requestId,
        provider,
        text: answers.length > 0 ? readAnswerText(answers[answers.length - 1]) : '',
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN);
    }

    function normalizeLocateText(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }

    // Build an innerText-like normalized view while retaining each source
    // character's text-node offset. Block and <br> boundaries become spaces;
    // inline boundaries do not add characters (important for CJK text).
    function getNormalizedAnswerText(answer) {
      const characters = [];
      let pendingSpace = null;
      let previousTextNode = null;
      const markBoundary = () => {
        if (characters.length && !pendingSpace) pendingSpace = { node: null, offset: 0 };
      };
      const crossedBlockBoundary = (previous, current) => {
        const previousAncestors = new Set();
        for (let element = previous.parentElement; element && element !== answer; element = element.parentElement) {
          previousAncestors.add(element);
        }
        let commonAncestor = current.parentElement;
        while (commonAncestor && commonAncestor !== answer && !previousAncestors.has(commonAncestor)) {
          commonAncestor = commonAncestor.parentElement;
        }
        for (let element = previous.parentElement; element && element !== commonAncestor; element = element.parentElement) {
          if (getConfigController().ANSWER_TEXT_BLOCK_BOUNDARY_TAGS.has(element.tagName)) return true;
        }
        return false;
      };
      const appendText = node => {
        if (previousTextNode && crossedBlockBoundary(previousTextNode, node)) markBoundary();
        for (let offset = 0; offset < node.nodeValue.length; offset++) {
          const character = node.nodeValue[offset];
          if (/\s/.test(character)) {
            if (characters.length && (!pendingSpace || pendingSpace.node === null)) pendingSpace = { node, offset };
            continue;
          }
          if (pendingSpace) {
            characters.push({ value: ' ', ...pendingSpace });
            pendingSpace = null;
          }
          characters.push({ value: character, node, offset });
        }
        previousTextNode = node;
      };
      const walker = document.createTreeWalker(
        answer,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE && node.matches(getConfigController().SNAPSHOT_SKIPPED_TEXT_PARENTS)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (node.nodeType === Node.TEXT_NODE
              && node.parentElement?.closest(getConfigController().SNAPSHOT_SKIPPED_TEXT_PARENTS)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );
      let node;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE) {
          appendText(node);
        } else if (node.tagName === 'BR' || getConfigController().ANSWER_TEXT_BLOCK_BOUNDARY_TAGS.has(node.tagName)) {
          // Block opening and <br> create line boundaries. The ancestor check in
          // appendText also catches leaving a nested block before inline text.
          markBoundary();
        }
      }
      return {
        text: characters.map(character => character.value).join(''),
        characters
      };
    }

    function ensureQuoteHighlightStyle() {
      if (document.getElementById(getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_STYLE_ID;
      style.textContent = `.${getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_CLASS}{animation:panelize-quote-highlight-fade ${getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_DURATION_MS}ms ease-out forwards}@keyframes panelize-quote-highlight-fade{0%,65%{background-color:rgba(255,220,80,.62);outline:2px solid rgba(235,170,0,.9);outline-offset:2px}100%{background-color:transparent;outline-color:transparent}}`;
      (document.head || document.documentElement).append(style);
    }

    // Locates only inside the most recent answer selected by the provider's
    // response selector. The extension page supplies the anchor quote.
    function handleLocateAnswerTextRequest(event) {
      const { data } = event;
      if (!getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN || window.parent === window
        || event.source !== window.parent || event.origin !== getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN
        || typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 160) {
        return;
      }

      const provider = getConfigController().detectProvider();
      const answerSelector = getConfigController().RESPONSE_TIMING_PROVIDERS[provider]?.answerSelector;
      const answers = answerSelector ? document.querySelectorAll(answerSelector) : [];
      const answer = answers.length ? answers[answers.length - 1] : null;
      const anchor = typeof data.anchor === 'string' && data.anchor.length <= getProtocolController().PANELIZE_LOCATE_ANCHOR_MAX_LENGTH
        ? normalizeLocateText(data.anchor)
        : '';
      let found = false;

      if (answer && anchor) {
        const { text, characters } = getNormalizedAnswerText(answer);
        const start = text.indexOf(anchor);
        if (start >= 0 && characters[start]) {
          const firstCharacter = characters[start];
          const textElement = firstCharacter.node.parentElement;
          const block = textElement?.closest('p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td');
          const target = block && answer.contains(block) ? block : answer;
          if (target) {
            found = true;
            ensureQuoteHighlightStyle();
            clearTimeout(quoteHighlightTimeouts.get(target));
            target.classList.remove(getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_CLASS);
            // Restart the one-shot animation when the same paragraph is found
            // again before its previous highlight has faded.
            void target.offsetWidth;
            target.classList.add(getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_CLASS);
            target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            const timeoutId = setTimeout(() => {
              target.classList.remove(getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_CLASS);
              quoteHighlightTimeouts.delete(target);
            }, getProtocolController().PANELIZE_QUOTE_HIGHLIGHT_DURATION_MS);
            quoteHighlightTimeouts.set(target, timeoutId);
          }
        }
      }

      window.parent.postMessage({
        type: getProtocolController().PANELIZE_LOCATE_ANSWER_RESULT,
        requestId: data.requestId,
        provider,
        found,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, getSecurityController().MULTI_PANEL_EXTENSION_ORIGIN);
    }

    function stopResponseTiming(phase = null) {
      const tracking = responseTiming;
      if (!tracking) {
        return;
      }

      clearInterval(tracking.intervalId);
      tracking.observer?.disconnect();
      responseTiming = null;
      if (phase) {
        postResponseTiming(tracking, phase, Date.now());
      }
    }

    function checkResponseTiming() {
      const tracking = responseTiming;
      if (!tracking) {
        return;
      }

      const now = Date.now();
      const { config, baseline } = tracking;
      const state = readResponseAnswer(tracking);
      // Re-rendering can replace the previous answer's node, so a new node only
      // counts as the answer once its text differs from the previous answer.
      const isNewAnswer = Boolean(state.text) && (
        state.count > baseline.count
        || (state.answer !== baseline.answer && state.text !== baseline.text)
      );

      if (isNewAnswer && state.text !== tracking.lastText) {
        tracking.lastText = state.text;
        tracking.lastChangeAt = now;
        if (!tracking.firstOutputAt) {
          tracking.firstOutputAt = now;
          postResponseTiming(tracking, 'first-output', now);
        }
      }

      if (!tracking.firstOutputAt) {
        if (now - tracking.startedAt >= getConfigController().RESPONSE_TIMING_NO_OUTPUT_TIMEOUT_MS) {
          stopResponseTiming('timeout');
        }
        return;
      }

      if (now - tracking.startedAt >= getConfigController().RESPONSE_TIMING_MAX_DURATION_MS) {
        stopResponseTiming('timeout');
        return;
      }

      if (config.busySelector && document.querySelector(config.busySelector)) {
        return;
      }

      if (now - tracking.lastChangeAt >= config.settleMs) {
        // The answer finished when its text last changed, not when the settle
        // time ran out.
        const completedAt = tracking.lastChangeAt;
        stopResponseTiming();
        postResponseTiming(tracking, 'complete', completedAt);
      }
    }

    function startResponseTiming(provider, requestId) {
      const config = getConfigController().RESPONSE_TIMING_PROVIDERS[provider];
      if (!config || !requestId) {
        return;
      }

      stopResponseTiming('cancelled');

      const baseline = getResponseAnswerState(config);
      const tracking = {
        requestId,
        provider,
        config,
        baseline,
        state: baseline,
        observer: null,
        answersDirty: false,
        textDirty: false,
        startedAt: Date.now(),
        firstOutputAt: null,
        lastChangeAt: null,
        lastText: '',
        intervalId: setInterval(checkResponseTiming, getConfigController().RESPONSE_TIMING_CHECK_INTERVAL_MS)
      };
      responseTiming = tracking;
      observeResponseAnswer(tracking);
    }

    function startAnswerEngagement(provider, requestId) {
      answerEngagement = provider && requestId
        ? { requestId, provider, lastReportedAt: {} }
        : null;
    }

    function handleAnswerEngagementEvent(event) {
      const tracking = answerEngagement;
      const kind = getConfigController().ANSWER_ENGAGEMENT_EVENT_KINDS[event.type];
      if (!tracking || !kind || !event.isTrusted || window.parent === window) {
        return;
      }

      const now = Date.now();
      if (now - (tracking.lastReportedAt[kind] ?? -Infinity) < getConfigController().ANSWER_ENGAGEMENT_REPORT_INTERVAL_MS) {
        return;
      }
      tracking.lastReportedAt[kind] = now;

      window.parent.postMessage({
        type: getProtocolController().PANELIZE_ANSWER_ENGAGEMENT,
        requestId: tracking.requestId,
        provider: tracking.provider,
        kind,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, '*');
    }

    function setupAnswerEngagementReporting() {
      Object.keys(getConfigController().ANSWER_ENGAGEMENT_EVENT_KINDS).forEach(type => {
        document.addEventListener(type, handleAnswerEngagementEvent, { capture: true, passive: true });
      });
    }

    return {
      handleAnswerTextRequest,
      handleLocateAnswerTextRequest,
      setupAnswerEngagementReporting,
      startAnswerEngagement,
      startResponseTiming,
      stopResponseTiming,
    };
  }

  runtime.factories.createAnswersController = createAnswersController;
})(globalThis.PanelizeContent);
