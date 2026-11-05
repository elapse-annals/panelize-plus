(function(runtime) {
  'use strict';

  /**
   * Owns snapshot styles behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createSnapshotStylesController({
    getComposerController,
    getConfigController,
    getGoogleController,
    getProtocolController,
    getSnapshotGeometryController
  }) {
    // Constructed sheet with SNAPSHOT_STYLE_RULES, adopted while a snapshot runs.
    let snapshotStyleSheet = null;

    function findSnapshotComposerInput(provider) {
      if (provider === 'google') {
        return getGoogleController().findGoogleInput(getProtocolController().GOOGLE_PROVIDER_MODE_AI);
      }
      return provider ? getComposerController().findProviderInput(provider) : null;
    }

    /**
     * The outermost box that keeps the element put while the container
     * scrolls: an ancestor inside the container that is fixed, stuck to an
     * edge, or absolute against a box outside the scrolled content. For an
     * element outside the container, its outermost ancestor that does not
     * hold the container.
     * @returns {Element|null} Null when the element scrolls with the content.
     */
    function getSnapshotPinningNode(element, container) {
      const outside = !getSnapshotGeometryController().isSnapshotDocumentScroller(container) && !container.contains(element);
      const containerRect = getSnapshotGeometryController().getSnapshotContainerRect(container);
      let pinning = null;
      for (let node = element; node && node !== container && node !== document.body && !node.contains(container);
        node = node.parentElement) {
        if (outside) {
          pinning = node;
          continue;
        }
        const position = window.getComputedStyle(node).position;
        if (position === 'fixed') {
          pinning = node;
        } else if (position === 'sticky') {
          // Sticky boxes in the middle of the content (e.g. code block
          // headers) scroll like the rest until they reach an edge.
          const rect = node.getBoundingClientRect();
          if (Math.abs(rect.top - containerRect.top) <= getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX
            || Math.abs(rect.bottom - containerRect.bottom) <= getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX) {
            pinning = node;
          }
        } else if (position === 'absolute' && !getSnapshotGeometryController().isSnapshotDocumentScroller(container)
          && !getSnapshotGeometryController().isSnapshotScrolledContent(node, container)) {
          pinning = node;
        }
      }
      return pinning;
    }

    function isSnapshotPinned(element, container) {
      return Boolean(getSnapshotPinningNode(element, container));
    }

    function overlapsSnapshotClip(rect, clip) {
      return rect.width > 0 && rect.height > 0
        && rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right;
    }

    function hasSnapshotReadableText(element) {
      // Icon fonts use private-use characters, which are not letters.
      return /[\p{L}\p{N}]/u.test(element.textContent || '');
    }

    function saveSnapshotInlineStyle(element, property) {
      return {
        element,
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property)
      };
    }

    function restoreSnapshotInlineStyles(savedStyles) {
      // Newest first, so a property saved twice ends up as it started.
      for (const { element, property, value, priority } of [...savedStyles].reverse()) {
        if (value) {
          element.style.setProperty(property, value, priority);
        } else {
          element.style.removeProperty(property);
        }
      }
    }

    /**
     * Adds SNAPSHOT_STYLE_RULES to the page. A constructed sheet is not
     * subject to the page's style-src policy; a style element is the fallback.
     */
    function installSnapshotStyles() {
      try {
        if (typeof CSSStyleSheet === 'function' && Array.isArray(document.adoptedStyleSheets)) {
          if (!snapshotStyleSheet) {
            snapshotStyleSheet = new CSSStyleSheet();
            snapshotStyleSheet.replaceSync(getConfigController().SNAPSHOT_STYLE_RULES);
          }
          if (!document.adoptedStyleSheets.includes(snapshotStyleSheet)) {
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, snapshotStyleSheet];
          }
          return;
        }
      } catch (error) {
        console.warn('[Snapshot] Constructed stylesheet unavailable, using a style element:', error);
      }
      if (!document.getElementById(getConfigController().SNAPSHOT_STYLE_ELEMENT_ID)) {
        const style = document.createElement('style');
        style.id = getConfigController().SNAPSHOT_STYLE_ELEMENT_ID;
        style.textContent = getConfigController().SNAPSHOT_STYLE_RULES;
        (document.head || document.documentElement).appendChild(style);
      }
    }

    function removeSnapshotStyles() {
      if (snapshotStyleSheet && Array.isArray(document.adoptedStyleSheets)) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== snapshotStyleSheet);
      }
      document.getElementById(getConfigController().SNAPSHOT_STYLE_ELEMENT_ID)?.remove();
    }

    /**
     * Whether a pseudo-element is a fade or shadow laid over the page, e.g.
     * Gemini's gradient drawn by the composer's ::before over the bottom of
     * the conversation.
     */
    function isSnapshotFadePseudo(element, pseudo) {
      const style = window.getComputedStyle(element, `::${pseudo}`);
      if (!style?.content || style.content === 'none' || style.content === 'normal' || style.display === 'none') {
        return false;
      }
      if (!/^(absolute|fixed|sticky)$/.test(style.position)) {
        return false;
      }
      return (style.backgroundImage || '').includes('gradient')
        || (Boolean(style.boxShadow) && style.boxShadow !== 'none');
    }

    /** Hides the element's fading pseudo-elements. @returns {boolean} Whether anything new was hidden. */
    function hideSnapshotFadePseudos(session, element) {
      const marked = (element.getAttribute(getConfigController().SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE) || '').split(/\s+/).filter(Boolean);
      const missing = ['before', 'after'].filter((pseudo) => !marked.includes(pseudo) && isSnapshotFadePseudo(element, pseudo));
      if (missing.length === 0) {
        return false;
      }
      if (!session.hiddenPseudos.has(element)) {
        session.hiddenPseudos.set(element, element.getAttribute(getConfigController().SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE));
      }
      installSnapshotStyles();
      element.setAttribute(getConfigController().SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE, [...marked, ...missing].join(' '));
      return true;
    }

    /**
     * Takes sticky boxes in the middle of the conversation out of sticking,
     * e.g. section headings and table headers, which would otherwise be pinned
     * over every stitched screen. Boxes at the very start or end of the
     * conversation are page chrome (a header, the composer dock) that the clip
     * leaves out, so they keep sticking. An un-stuck box keeps its place in
     * the flow, so nothing else moves and the scroll height stays the same.
     * Runs after every scroll, because pages render parts as they show up.
     * @returns {boolean} Whether anything new was un-stuck.
     */
    function unstickSnapshotContent(session) {
      const { container } = session;
      const isDocument = getSnapshotGeometryController().isSnapshotDocumentScroller(container);
      const scope = isDocument ? document.body : container;
      const scroller = isDocument ? document.scrollingElement || document.documentElement : container;
      // Top of the scrolled content, in viewport pixels.
      const contentTop = getSnapshotGeometryController().getSnapshotContainerRect(container).top - getSnapshotGeometryController().getSnapshotScrollTop(container);
      const input = findSnapshotComposerInput(session.provider);
      let changed = false;
      for (const element of scope?.querySelectorAll('*') || []) {
        if (session.unstuckElements.has(element) || session.keptStickyElements.has(element) || !element.style) {
          continue;
        }
        const style = window.getComputedStyle(element);
        if (style.position !== 'sticky') {
          continue;
        }
        if (input && element.contains(input)) {
          session.keptStickyElements.add(element);
          continue;
        }
        const saved = getConfigController().SNAPSHOT_UNSTICK_PROPERTIES.map((property) => saveSnapshotInlineStyle(element, property));
        element.style.setProperty('position', 'relative', 'important');
        getConfigController().SNAPSHOT_UNSTICK_PROPERTIES.slice(1).forEach((property) => element.style.setProperty(property, 'auto', 'important'));
        // Where it sits in the flow, now that it no longer sticks.
        const rect = element.getBoundingClientRect();
        const top = rect.top - contentTop;
        if (top <= getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX || top + rect.height >= scroller.scrollHeight - getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX) {
          restoreSnapshotInlineStyles(saved);
          session.keptStickyElements.add(element);
          continue;
        }
        session.savedStyles.push(...saved);
        session.unstuckElements.add(element);
        // Shadows and fades only made sense while it was stuck over the text.
        if (style.boxShadow && style.boxShadow !== 'none') {
          session.savedStyles.push(saveSnapshotInlineStyle(element, 'box-shadow'));
          element.style.setProperty('box-shadow', 'none', 'important');
        }
        hideSnapshotFadePseudos(session, element);
        changed = true;
      }
      return changed;
    }

    /**
     * Hides what would repeat on every stitched screen or clutter a current
     * view: buttons and fades pinned over the visible conversation (e.g.
     * "Scroll to bottom"), shadows of bars around it, fades drawn by
     * pseudo-elements of the composer or of the conversation's boxes, notices
     * stacked on a composer laid over it (e.g. "You've used 90% of your
     * limit"), overlay scrollbars, and masks that fade the edges of the
     * conversation. While stitching, pinned text goes too (e.g. a heading
     * kept on screen); a current view keeps it. The composer itself stays and
     * layout is kept. Runs after every scroll, because some buttons only show
     * up once the conversation is no longer at the bottom.
     * @returns {boolean} Whether anything new was hidden.
     */
    function hideSnapshotFloatingElements(session) {
      const { container, clip } = session;
      const clipHeight = clip.bottom - clip.top;
      if (!container || clipHeight <= 0 || clip.right <= clip.left) {
        return false;
      }
      const hidden = session.hiddenElements;
      let changed = false;
      const hide = (element) => {
        hidden.add(element);
        session.savedStyles.push(saveSnapshotInlineStyle(element, 'visibility'));
        element.style.setProperty('visibility', 'hidden', 'important');
        changed = true;
      };

      // Overlay scrollbars show up after every scroll; they take no room, so
      // hiding them does not move the content.
      const scroller = getSnapshotGeometryController().isSnapshotDocumentScroller(container)
        ? document.scrollingElement || document.documentElement
        : container;
      if (!session.hidesScrollbar) {
        const style = window.getComputedStyle(scroller);
        const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
        if (scroller.offsetWidth > 0 && scroller.offsetWidth - scroller.clientWidth <= borders) {
          session.hidesScrollbar = true;
          session.savedStyles.push(saveSnapshotInlineStyle(scroller, 'scrollbar-width'));
          scroller.style.setProperty('scrollbar-width', 'none', 'important');
          changed = true;
        }
      }

      // Boxes whose pseudo-elements may be fades over the conversation: the
      // conversation and its ancestors, the composer and its ancestors, and
      // whatever is pinned or was un-stuck.
      const input = findSnapshotComposerInput(session.provider);
      const fadeHosts = new Set(session.unstuckElements);
      for (let node = container; node && node.style; node = node.parentElement) {
        fadeHosts.add(node);
        if (session.unmaskedElements.has(node)) {
          continue;
        }
        const style = window.getComputedStyle(node);
        const masked = getConfigController().SNAPSHOT_HIDDEN_MASK_PROPERTIES.some((property) => {
          const value = style.getPropertyValue(property);
          return value && value !== 'none';
        });
        if (masked) {
          session.unmaskedElements.add(node);
          getConfigController().SNAPSHOT_HIDDEN_MASK_PROPERTIES.forEach((property) => {
            session.savedStyles.push(saveSnapshotInlineStyle(node, property));
            node.style.setProperty(property, 'none', 'important');
          });
          changed = true;
        }
      }
      for (let node = input?.parentElement; node && node !== document.body; node = node.parentElement) {
        fadeHosts.add(node);
      }

      // Shadows cast by bars next to the clip, e.g. under a header, fall on
      // the edge of every screen.
      const containerRect = getSnapshotGeometryController().getSnapshotContainerRect(container);
      const nearClip = {
        left: containerRect.left,
        right: containerRect.right,
        top: clip.top - getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX,
        bottom: clip.bottom + getConfigController().SNAPSHOT_EDGE_TOLERANCE_PX
      };
      for (const element of document.body?.querySelectorAll('*') || []) {
        if (hidden.has(element) || element === container || element.contains(container)
          || (session.matchElement && element.contains(session.matchElement))) {
          continue;
        }
        const style = window.getComputedStyle(element);
        const position = style.position;
        if (position !== 'sticky' && position !== 'fixed' && position !== 'absolute') {
          continue;
        }
        if (style.display === 'none' || !isSnapshotPinned(element, container)) {
          continue;
        }
        fadeHosts.add(element);
        const rect = element.getBoundingClientRect();
        if (style.boxShadow && style.boxShadow !== 'none' && !session.quietedElements.has(element)
          && overlapsSnapshotClip(rect, nearClip)) {
          session.quietedElements.add(element);
          session.savedStyles.push(saveSnapshotInlineStyle(element, 'box-shadow'));
          element.style.setProperty('box-shadow', 'none', 'important');
          changed = true;
        }
        if (rect.height > clipHeight * getConfigController().SNAPSHOT_MAX_FLOATING_HEIGHT_RATIO || !overlapsSnapshotClip(rect, clip)) {
          continue;
        }
        if (input && element.contains(input)) {
          continue;
        }
        const isButton = element.matches('button, [role="button"]');
        if (!session.stitch && !isButton && hasSnapshotReadableText(element)) {
          continue;
        }
        hide(element);
      }

      for (const element of fadeHosts) {
        if (element.style && hideSnapshotFadePseudos(session, element)) {
          changed = true;
        }
      }

      // The clip ends at the input box, so whatever else the pinned composer
      // shows over the conversation sits next to the input's ancestors.
      const dock = input && getSnapshotPinningNode(input, container);
      if (dock) {
        for (let node = input; node !== dock; node = node.parentElement) {
          for (const sibling of node.parentElement.children) {
            if (sibling !== node && !hidden.has(sibling) && sibling.style
              && !(session.matchElement && sibling.contains(session.matchElement))
              && window.getComputedStyle(sibling).display !== 'none'
              && overlapsSnapshotClip(sibling.getBoundingClientRect(), clip)) {
              hide(sibling);
            }
          }
        }
      }
      return changed;
    }

    /** Puts back every style, mark and pointer a snapshot changed; scroll positions stay. */
    function restoreSnapshotPage(session) {
      if (!session) {
        return;
      }
      restoreSnapshotInlineStyles(session.savedStyles);
      session.savedStyles = [];
      session.hiddenPseudos.forEach((value, element) => {
        if (value === null) {
          element.removeAttribute(getConfigController().SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE);
        } else {
          element.setAttribute(getConfigController().SNAPSHOT_HIDE_PSEUDO_ATTRIBUTE, value);
        }
      });
      session.hiddenPseudos.clear();
      session.hidesScrollbar = false;
      session.hiddenElements.clear();
      session.unmaskedElements.clear();
      session.unstuckElements.clear();
      session.keptStickyElements.clear();
      session.quietedElements.clear();
      document.documentElement.removeAttribute(getConfigController().SNAPSHOT_HIDE_CURSOR_ATTRIBUTE);
      removeSnapshotStyles();
    }

    return {
      findSnapshotComposerInput,
      hideSnapshotFloatingElements,
      installSnapshotStyles,
      restoreSnapshotPage,
      unstickSnapshotContent,
    };
  }

  runtime.factories.createSnapshotStylesController = createSnapshotStylesController;
})(globalThis.PanelizeContent);
