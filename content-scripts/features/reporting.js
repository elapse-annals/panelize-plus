(function(runtime) {
  'use strict';

  /**
   * Owns reporting behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createReportingController({
    getConfigController,
    getProtocolController,
    getSnapshotSessionController
  }) {
    function postMultiPanelProviderStatus(type, requestId, phase, provider = getConfigController().detectProvider()) {
      if (!requestId || window.parent === window) {
        return;
      }

      window.parent.postMessage({
        type,
        requestId,
        provider,
        phase,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, '*');
    }

    function postMultiPanelActionResult(requestId, provider, result) {
      if (!requestId || !provider || window.parent === window) {
        return;
      }

      const message = {
        type: getProtocolController().PANELIZE_ACTION_RESULT,
        context: getProtocolController().MULTI_PANEL_ACTION_RESULT_CONTEXT,
        requestId,
        provider,
        action: 'fill',
        status: result.ok ? 'succeeded' : 'failed'
      };

      if (Array.isArray(result?.succeededImageIds)) {
        message.succeededImageIds = result.succeededImageIds;
      }

      if (!result.ok) {
        message.reason = result.reason || getConfigController().IMAGE_INJECTION_REASONS.INJECTION_ERROR;
      }

      window.parent.postMessage(message, '*');
    }

    function postTemporaryChatEnabled(provider = getConfigController().detectProvider()) {
      if (!provider || window.parent === window) {
        return;
      }

      window.parent.postMessage({
        type: getProtocolController().PANELIZE_TEMP_CHAT_ENABLED,
        provider,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, '*');
    }

    function postProviderLocation(provider = getConfigController().detectProvider()) {
      if (!provider || window.parent === window) {
        return;
      }

      window.parent.postMessage({
        type: getProtocolController().PANELIZE_PROVIDER_LOCATION,
        provider,
        url: window.location.href,
        context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
      }, '*');
    }

    function setupProviderLocationReporting() {
      let lastReportedUrl = null;

      const reportIfChanged = () => {
        const currentUrl = window.location.href;
        if (currentUrl === lastReportedUrl) {
          return;
        }

        lastReportedUrl = currentUrl;
        postProviderLocation();
      };

      const wrapHistoryMethod = (methodName) => {
        const original = window.history?.[methodName];
        if (typeof original !== 'function') {
          return;
        }

        try {
          window.history[methodName] = function(...args) {
            const result = original.apply(this, args);
            setTimeout(reportIfChanged, 0);
            return result;
          };
        } catch (error) {
          console.warn('[Text Injection] Unable to wrap history method:', methodName, error);
        }
      };

      wrapHistoryMethod('pushState');
      wrapHistoryMethod('replaceState');
      window.addEventListener('popstate', reportIfChanged);
      window.addEventListener('hashchange', reportIfChanged);
      reportIfChanged();
    }

    function isMultiPanelFrame() {
      if (window.parent === window || window.parent !== window.top) {
        return false;
      }
      const embedder = window.location.ancestorOrigins?.[0];
      return embedder === undefined || /^(chrome|moz)-extension:/.test(embedder);
    }

    /**
     * Boxes filling the viewport hold the app itself, even when they scroll or
     * float; so do those filling most of it beside a side rail, e.g. Qwen's
     * content box next to its rail of icons.
     */
    function isPageShellBox(rect, viewportWidth, viewportHeight) {
      return rect.right >= viewportWidth - 1 && rect.width >= viewportWidth / 2
        && rect.height >= viewportHeight / 2;
    }

    /**
     * Width the page's layout needs, in CSS pixels: the furthest an element
     * held open by a pixel min-width reaches from where it starts. Only the app
     * shell is scanned: floating layers (menus, popovers) and content of
     * scrolling boxes (chat lists, code blocks, tables) are left out. It does
     * not depend on the viewport width, so a page laid out at the width it
     * needs keeps asking for it. The result also retains layout nodes so later
     * transcript mutations do not repeatedly measure excluded subtrees.
     */
    function measurePageNeededWidth() {
      const measurement = {
        neededWidth: 0,
        body: document.body,
        elements: new Set(),
        resizeTargets: new Set(),
        minWidthBoxes: new Map()
      };
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (!document.body || !(viewportWidth > 0)) {
        return measurement;
      }
      let needed = 0;
      let visited = 0;
      const queue = Array.from(document.body.children, (element) => ({ element, depth: 1 }));
      for (let index = 0; index < queue.length && visited < getConfigController().PAGE_WIDTH_MAX_ELEMENTS; index += 1) {
        const { element, depth } = queue[index];
        visited += 1;
        measurement.elements.add(element);
        const style = window.getComputedStyle(element);
        if (style.display === 'none') {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const shell = isPageShellBox(rect, viewportWidth, viewportHeight);
        if ((style.position === 'absolute' || style.position === 'fixed') && !shell) {
          continue;
        }
        const minWidth = style.minWidth.endsWith('px') ? parseFloat(style.minWidth) : 0;
        if (shell || minWidth > 0) {
          measurement.resizeTargets.add(element);
        }
        if (minWidth > 0) {
          measurement.minWidthBoxes.set(element, { left: rect.left, visible: rect.height > 0 });
        }
        const startsOnScreen = rect.left >= -1 && rect.left < viewportWidth - 1;
        if (minWidth > 0 && rect.height > 0 && startsOnScreen && style.visibility !== 'hidden') {
          needed = Math.max(needed, Math.ceil(rect.left + window.scrollX + minWidth));
        }
        const scrolls = getConfigController().PAGE_WIDTH_SCROLLING_OVERFLOW.test(style.overflowX)
          || getConfigController().PAGE_WIDTH_SCROLLING_OVERFLOW.test(style.overflowY);
        if (scrolls) measurement.resizeTargets.add(element);
        if (depth < getConfigController().PAGE_WIDTH_MAX_DEPTH && (shell || !scrolls)) {
          for (const child of element.children) {
            queue.push({ element: child, depth: depth + 1 });
          }
        }
      }
      measurement.neededWidth = needed;
      return measurement;
    }

    /**
     * Tells the multi-panel host how wide this page needs to be, so a panel
     * narrower than that can scale the page down to fit instead of cutting it.
     */
    function setupPageWidthReporting() {
      if (!isMultiPanelFrame()) {
        return;
      }
      let lastReported = null;
      let timer = null;
      let measurement = null;
      let fullMeasurementNeeded = true;
      let active = true;
      let observedElements = new Set();
      const answerSelector = getConfigController().RESPONSE_TIMING_PROVIDERS[getConfigController().detectProvider()]?.answerSelector;
      const observedSizes = new WeakMap();
      const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
        let changed = false;
        for (const { target, contentRect } of entries) {
          const previous = observedSizes.get(target);
          // Growing answers change height on every token. Only width changes,
          // or an empty min-width box acquiring height, need a new width scan.
          if (!previous || previous.width !== contentRect.width
            || (measurement?.minWidthBoxes.has(target) && previous.visible !== (contentRect.height > 0))) {
            changed = true;
          }
          observedSizes.set(target, { width: contentRect.width, visible: contentRect.height > 0 });
        }
        if (changed) schedule();
      }) : null;

      const affectsWidth = (record) => {
        const target = record.target;
        if (!measurement || measurement.body !== document.body
          || target === document.documentElement || target === document.body
          || document.head?.contains(target)) {
          return true;
        }
        // These subtrees were deliberately excluded from width measurement
        // (e.g. code blocks and scrollable transcripts). Their ancestors still
        // trigger measurement when their own layout or visibility changes.
        if (!measurement.elements.has(target)) {
          return false;
        }
        if (record.type === 'childList' && answerSelector && target.closest?.(answerSelector)
          && [...record.addedNodes, ...record.removedNodes].every(node => node.nodeType === Node.TEXT_NODE)) {
          // The pixel min-width is stable, but text can move a sibling box
          // without resizing it. Check known boxes before deciding to rescan.
          return 'text';
        }
        return true;
      };
      const mutationObserver = new MutationObserver((records) => {
        const textChanges = new Map();
        for (const record of records) {
          const relevance = affectsWidth(record);
          if (relevance === true) {
            schedule();
            return;
          }
          if (relevance === 'text') {
            const change = textChanges.get(record.target) || { added: false, removed: false };
            change.added ||= [...record.addedNodes].some(node => node.nodeValue?.length);
            change.removed ||= [...record.removedNodes].some(node => node.nodeValue?.length);
            textChanges.set(record.target, change);
          }
        }
        if (textChanges.size > 0) {
          // Some DOM implementations split text replacement into removal and
          // addition records. Combine the batch, but remeasure empty/nonempty
          // transitions because they can change :empty rules and min-width.
          schedule([...textChanges].some(([target, change]) => !change.added || !change.removed
            || !Array.prototype.some.call(target.childNodes, node => node.nodeType === Node.ELEMENT_NODE
              || (node.nodeType === Node.TEXT_NODE && node.nodeValue?.length))));
        }
      });

      const report = () => {
        timer = null;
        // Snapshots move content around; measure once they are done.
        if (getSnapshotSessionController().snapshotSession) {
          schedule();
          return;
        }
        const provider = getConfigController().detectProvider();
        if (!fullMeasurementNeeded && measurement) {
          for (const [element, previous] of measurement.minWidthBoxes) {
            const rect = element.getBoundingClientRect();
            if (rect.left !== previous.left || (rect.height > 0) !== previous.visible) {
              fullMeasurementNeeded = true;
              break;
            }
          }
        }
        const measured = fullMeasurementNeeded || !measurement;
        if (measured) measurement = measurePageNeededWidth();
        fullMeasurementNeeded = false;
        if (resizeObserver && measured) {
          const nextObserved = new Set([document.documentElement, ...measurement.resizeTargets]);
          for (const element of observedElements) {
            if (!nextObserved.has(element)) resizeObserver.unobserve(element);
          }
          for (const element of nextObserved) {
            if (!observedElements.has(element)) resizeObserver.observe(element);
          }
          observedElements = nextObserved;
        }
        const { neededWidth } = measurement;
        if (!provider || neededWidth === lastReported) {
          return;
        }
        lastReported = neededWidth;
        window.parent.postMessage({
          type: getProtocolController().PANELIZE_PAGE_WIDTH,
          provider,
          neededWidth,
          context: getProtocolController().MULTI_PANEL_PROVIDER_STATUS_CONTEXT
        }, '*');
      };

      function schedule(full = true) {
        if (full !== false) fullMeasurementNeeded = true;
        if (active && timer === null) {
          timer = setTimeout(report, getConfigController().PAGE_WIDTH_REPORT_THROTTLE_MS);
        }
      }

      function observe() {
        active = true;
        resizeObserver?.observe(document.documentElement);
        observedElements = new Set([document.documentElement]);
        mutationObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style']
        });
        schedule();
      }

      window.addEventListener('resize', schedule);
      window.addEventListener('pagehide', () => {
        active = false;
        clearTimeout(timer);
        timer = null;
        resizeObserver?.disconnect();
        mutationObserver.disconnect();
        observedElements.clear();
        measurement = null;
      });
      window.addEventListener('pageshow', () => {
        if (!active) observe();
      });
      observe();
    }

    return {
      isMultiPanelFrame,
      postMultiPanelActionResult,
      postMultiPanelProviderStatus,
      postTemporaryChatEnabled,
      setupPageWidthReporting,
      setupProviderLocationReporting,
    };
  }

  runtime.factories.createReportingController = createReportingController;
})(globalThis.PanelizeContent);
