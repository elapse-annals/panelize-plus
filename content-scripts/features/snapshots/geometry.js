(function(runtime) {
  'use strict';

  /**
   * Owns snapshot geometry behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createSnapshotGeometryController({
    getConfigController,
    getSnapshotStylesController
  }) {
    // ===== Share snapshot: align and scroll the conversation for a capture =====
    // The multi-panel page captures the whole tab, so all it needs from a
    // provider frame is where the conversation scrolls and which part of it is
    // covered by the provider's own header and composer. Only geometry is sent
    // back; no page text leaves the frame.

    function normalizeSnapshotMatchText(text) {
      return String(text || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s​-‍⁠﻿*_`]+/g, '');
    }

    function getSnapshotMatchKey(prompt) {
      return Array.from(normalizeSnapshotMatchText(prompt)).slice(0, getConfigController().SNAPSHOT_MATCH_KEY_LENGTH).join('');
    }

    function getSnapshotViewport() {
      return {
        width: window.innerWidth || document.documentElement?.clientWidth || 0,
        height: window.innerHeight || document.documentElement?.clientHeight || 0
      };
    }

    function isSnapshotDocumentScroller(element) {
      return !element || element === document.scrollingElement
        || element === document.documentElement || element === document.body;
    }

    function isSnapshotScrollable(element) {
      if (isSnapshotDocumentScroller(element)) {
        const scroller = document.scrollingElement || document.documentElement;
        return Boolean(scroller) && scroller.scrollHeight > scroller.clientHeight + 1;
      }
      const overflowY = window.getComputedStyle(element).overflowY;
      return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 1;
    }

    function isSnapshotElementRendered(element) {
      if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility();
      }
      return true;
    }

    function getSnapshotContainerRect(container) {
      const viewport = getSnapshotViewport();
      if (isSnapshotDocumentScroller(container)) {
        return { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
      }
      // Client box: excludes borders and scrollbars.
      const rect = container.getBoundingClientRect();
      const left = rect.left + container.clientLeft;
      const top = rect.top + container.clientTop;
      const box = {
        left: Math.max(0, left),
        top: Math.max(0, top),
        right: Math.min(viewport.width, left + container.clientWidth),
        bottom: Math.min(viewport.height, top + container.clientHeight)
      };
      // Only what clipping ancestors show, e.g. not the part of a box scrolled
      // sideways that is hidden under the side rail beside it.
      for (let node = container.parentElement; node && !isSnapshotDocumentScroller(node); node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (!getConfigController().SNAPSHOT_CLIPPING_OVERFLOW.test(style.overflowX) && !getConfigController().SNAPSHOT_CLIPPING_OVERFLOW.test(style.overflowY)) {
          continue;
        }
        const nodeRect = node.getBoundingClientRect();
        const nodeLeft = nodeRect.left + node.clientLeft;
        const nodeTop = nodeRect.top + node.clientTop;
        box.left = Math.max(box.left, nodeLeft);
        box.top = Math.max(box.top, nodeTop);
        box.right = Math.min(box.right, nodeLeft + node.clientWidth);
        box.bottom = Math.min(box.bottom, nodeTop + node.clientHeight);
      }
      return box;
    }

    function isLargeSnapshotContainer(element) {
      const viewport = getSnapshotViewport();
      if (isSnapshotDocumentScroller(element)) {
        return true;
      }
      const rect = getSnapshotContainerRect(element);
      return rect.bottom - rect.top >= viewport.height * getConfigController().SNAPSHOT_MIN_CONTAINER_HEIGHT_RATIO;
    }

    /**
     * The scrolling ancestor that moves the element: the main conversation
     * when it holds the element, otherwise the large ancestor that scrolls the
     * furthest, so that a wrapper scrolling a few pixels is not taken for the
     * conversation.
     * @param {Element} element
     * @param {Element} main - findMainSnapshotScrollContainer().
     */
    function findSnapshotScrollContainer(element, main) {
      const ancestors = [];
      for (let node = element; node && !isSnapshotDocumentScroller(node); node = node.parentElement) {
        if (isSnapshotScrollable(node) && isLargeSnapshotContainer(node)) {
          ancestors.push(node);
        }
      }
      if (isSnapshotScrollable(null)) {
        ancestors.push(document.scrollingElement || document.documentElement);
      }
      if (ancestors.includes(main)) {
        return main;
      }
      return ancestors.reduce((best, node) => (
        !best || getSnapshotMaxScrollTop(node) > getSnapshotMaxScrollTop(best) ? node : best
      ), null);
    }

    /** Largest visible scrolling element; the document when nothing else scrolls. */
    function findMainSnapshotScrollContainer() {
      let best = null;
      let bestArea = 0;
      for (const element of document.body?.querySelectorAll('*') || []) {
        if (!isSnapshotScrollable(element) || !isLargeSnapshotContainer(element)) {
          continue;
        }
        const rect = getSnapshotContainerRect(element);
        const area = Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
        if (area > bestArea) {
          best = element;
          bestArea = area;
        }
      }
      return best || document.scrollingElement || document.documentElement;
    }

    /** Whether the element can be the start of a turn in the conversation. */
    function isSnapshotConversationElement(element) {
      if (!isSnapshotElementRendered(element) || element.closest(getConfigController().SNAPSHOT_NAVIGATION_PARENTS)) {
        return false;
      }
      // Fixed boxes (dialogs, toasts) do not scroll with the conversation.
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (window.getComputedStyle(node).position === 'fixed') {
          return false;
        }
      }
      return true;
    }

    function collectSnapshotTextIndex() {
      const segments = [];
      let text = '';
      if (!document.body) {
        return { segments, text };
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest(getConfigController().SNAPSHOT_SKIPPED_TEXT_PARENTS)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const normalized = normalizeSnapshotMatchText(node.nodeValue);
        if (normalized) {
          segments.push({ node, start: text.length });
          text += normalized;
        }
      }
      return { segments, text };
    }

    function findSnapshotSegment(segments, offset) {
      let low = 0;
      let high = segments.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (segments[middle].start <= offset) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      return segments[low];
    }

    /**
     * Rendered messages that start like the prompt, best first: a match in a
     * known user message beats any other, e.g. an answer heading repeating the
     * question; then a match at the start of a text node (a message bubble)
     * beats one in the middle of a paragraph, e.g. an answer quoting it; then
     * a match in the main conversation beats one elsewhere; then the latest wins.
     * @returns {{element: Element, container: Element}[]}
     */
    function findSnapshotPromptMatches(prompt, main) {
      const key = getSnapshotMatchKey(prompt);
      if (Array.from(key).length < getConfigController().SNAPSHOT_MIN_MATCH_KEY_LENGTH) {
        return [];
      }
      const { segments, text } = collectSnapshotTextIndex();
      const candidates = [];
      let offset = text.lastIndexOf(key);
      for (let checked = 0; offset !== -1 && checked < getConfigController().SNAPSHOT_MAX_MATCH_CANDIDATES; checked += 1) {
        const segment = findSnapshotSegment(segments, offset);
        const element = segment.node.parentElement;
        if (element && isSnapshotConversationElement(element)) {
          const container = findSnapshotScrollContainer(element, main);
          if (container) {
            const rank = (element.closest(getConfigController().SNAPSHOT_USER_TURN_SELECTORS) ? 0 : 4)
              + (segment.start === offset ? 0 : 2) + (container === main ? 0 : 1);
            candidates.push({ element, container, rank });
          }
        }
        offset = offset > 0 ? text.lastIndexOf(key, offset - 1) : -1;
      }
      // Array sort is stable, so the latest stays first within a rank.
      return candidates.sort((a, b) => a.rank - b.rank);
    }

    /** The latest user message found by role attributes or known bubbles. */
    function findSnapshotUserTurn(main) {
      const elements = Array.from(document.querySelectorAll(getConfigController().SNAPSHOT_USER_TURN_SELECTORS));
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = elements[index];
        if (!isSnapshotConversationElement(element)) {
          continue;
        }
        const container = findSnapshotScrollContainer(element, main);
        if (container) {
          return { element, container };
        }
      }
      return null;
    }

    function getSnapshotScrollTop(container) {
      return isSnapshotDocumentScroller(container) ? window.scrollY : container.scrollTop;
    }

    function getSnapshotMaxScrollTop(container) {
      const scroller = isSnapshotDocumentScroller(container)
        ? document.scrollingElement || document.documentElement
        : container;
      return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    }

    function clampSnapshotScrollTop(container, top) {
      return Math.max(0, Math.min(getSnapshotMaxScrollTop(container), Math.round(top)));
    }

    function scrollSnapshotContainer(container, top) {
      const target = clampSnapshotScrollTop(container, top);
      // "instant" overrides a smooth scroll-behavior set by the page.
      if (isSnapshotDocumentScroller(container)) {
        window.scrollTo({ top: target, behavior: 'instant' });
      } else if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: target, behavior: 'instant' });
      } else {
        container.scrollTop = target;
      }
    }

    function isSnapshotScrolledContent(element, container) {
      // Absolute elements scroll with the content when their containing block
      // is the scroll container or inside it.
      const containingBlock = element.offsetParent;
      if (!containingBlock) {
        return false;
      }
      if (isSnapshotDocumentScroller(container)) {
        return true;
      }
      return containingBlock === container || container.contains(containingBlock);
    }

    /**
     * Visible part of the container minus bars pinned over its top or bottom:
     * sticky or fixed headers, the composer and its fade. Narrow floating
     * buttons are ignored.
     */
    function getSnapshotClip(container, provider) {
      const rect = getSnapshotContainerRect(container);
      const clip = { ...rect };
      const height = rect.bottom - rect.top;
      const width = rect.right - rect.left;
      if (height <= 0 || width <= 0) {
        return clip;
      }
      const maxEdge = height * getConfigController().SNAPSHOT_MAX_EDGE_RATIO;
      const scope = isSnapshotDocumentScroller(container) ? document.body : container;
      const candidates = Array.from(scope?.querySelectorAll('*') || []);
      if (!isSnapshotDocumentScroller(container)) {
        // Fixed bars elsewhere in the page can still cover the container.
        candidates.push(...Array.from(document.body.querySelectorAll('*')).filter((element) => (
          !container.contains(element) && !element.contains(container)
        )));
      }

      const pinBar = (barRect) => {
        if (barRect.width < width * getConfigController().SNAPSHOT_OVERLAY_MIN_WIDTH_RATIO || barRect.height <= 0) {
          return;
        }
        if (barRect.bottom <= rect.top || barRect.top >= rect.bottom
          || barRect.right <= rect.left || barRect.left >= rect.right) {
          return;
        }
        if (barRect.top <= rect.top + getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX && barRect.bottom - rect.top <= maxEdge) {
          clip.top = Math.max(clip.top, barRect.bottom);
        } else if (barRect.bottom >= rect.bottom - getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX && rect.bottom - barRect.top <= maxEdge) {
          clip.bottom = Math.min(clip.bottom, barRect.top);
        }
      };

      // Absolute bars outside the container that sit over it, so that their
      // own layers count too, e.g. a header's fading backdrop.
      const overlayingBars = new Set();
      const isInOverlayingBar = (element) => {
        for (let node = element.parentElement; node; node = node.parentElement) {
          if (overlayingBars.has(node)) {
            return true;
          }
        }
        return false;
      };

      for (const element of candidates) {
        const style = window.getComputedStyle(element);
        const position = style.position;
        if (position !== 'sticky' && position !== 'fixed' && position !== 'absolute') {
          continue;
        }
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
          continue;
        }
        if (position === 'absolute' && container.contains(element) && isSnapshotScrolledContent(element, container)) {
          continue;
        }
        if (position === 'absolute' && !container.contains(element)) {
          // Absolute siblings only count when they sit over the container.
          // Layers without pointer events are not hit, so they count through
          // the bar they belong to.
          const sample = document.elementFromPoint?.(
            Math.round((rect.left + rect.right) / 2),
            Math.round(element.getBoundingClientRect().top + 1)
          );
          if (sample && element.contains(sample)) {
            overlayingBars.add(element);
          } else if (!isInOverlayingBar(element)) {
            continue;
          }
        }
        pinBar(element.getBoundingClientRect());
      }

      // The composer, also when it is a plain block laid over the conversation.
      const input = getSnapshotStylesController().findSnapshotComposerInput(provider);
      if (input) {
        let box = null;
        for (let node = input; node && node !== container && !node.contains(container); node = node.parentElement) {
          const nodeRect = node.getBoundingClientRect();
          if (nodeRect.height > maxEdge || nodeRect.width > width + 2) {
            break;
          }
          box = nodeRect;
        }
        if (box && box.top < clip.bottom && box.bottom > rect.top + height - maxEdge
          && box.right > rect.left && box.left < rect.right) {
          clip.bottom = Math.min(clip.bottom, box.top);
        }
      }

      if (clip.bottom - clip.top < height * (1 - getConfigController().SNAPSHOT_MAX_EDGE_RATIO * 2)) {
        // Something went wrong (e.g. a full-height overlay); keep the container.
        return { ...rect };
      }
      return {
        left: Math.round(clip.left),
        top: Math.round(clip.top),
        right: Math.round(clip.right),
        bottom: Math.round(clip.bottom)
      };
    }

    return {
      clampSnapshotScrollTop,
      findMainSnapshotScrollContainer,
      findSnapshotPromptMatches,
      findSnapshotUserTurn,
      getSnapshotClip,
      getSnapshotContainerRect,
      getSnapshotMaxScrollTop,
      getSnapshotScrollTop,
      getSnapshotViewport,
      isSnapshotDocumentScroller,
      isSnapshotScrolledContent,
      scrollSnapshotContainer,
    };
  }

  runtime.factories.createSnapshotGeometryController = createSnapshotGeometryController;
})(globalThis.PanelizeContent);
