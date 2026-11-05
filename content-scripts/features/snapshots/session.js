(function(runtime) {
  'use strict';

  /**
   * Owns snapshot session behavior and its page-local state.
   * Deferred controller getters keep composition in the entry point.
   */


  function createSnapshotSessionController({
    getConfigController,
    getProtocolController,
    getSnapshotGeometryController,
    getSnapshotStylesController
  }) {
    // Scroll container and positions of the snapshot being taken.
    let snapshotSession = null;

    /** Un-sticks and hides what should not be captured, then waits for the result to show. */
    async function settleSnapshotScreen(session) {
      await waitForSnapshotPaint();
      if (!session.hideFloating) {
        return;
      }
      // A second pass for what only appeared after the first one.
      for (let pass = 0; pass < 2; pass += 1) {
        const unstuck = session.stitch && getSnapshotStylesController().unstickSnapshotContent(session);
        const hidden = getSnapshotStylesController().hideSnapshotFloatingElements(session);
        if (!unstuck && !hidden) {
          break;
        }
        await waitForSnapshotPaint();
      }
    }

    function waitForSnapshotPaint() {
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        // Frames can be throttled when hidden; the timeout keeps replies coming.
        setTimeout(finish, getConfigController().SNAPSHOT_PAINT_TIMEOUT_MS);
        if (typeof requestAnimationFrame !== 'function') {
          setTimeout(finish, getConfigController().SNAPSHOT_PAINT_SETTLE_MS);
          return;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(finish, getConfigController().SNAPSHOT_PAINT_SETTLE_MS)));
      });
    }

    function postSnapshotState(requestId, session, extra = {}) {
      const container = session?.container || null;
      window.parent.postMessage({
        type: getProtocolController().PANELIZE_SNAPSHOT_STATE,
        context: getProtocolController().MULTI_PANEL_SNAPSHOT_CONTEXT,
        requestId,
        sessionId: session?.id || null,
        provider: getConfigController().detectProvider(),
        matched: Boolean(session?.matched),
        // 'prompt', 'user-turn' or 'top'; null when the panel was left as it was.
        alignedBy: session?.alignedBy || null,
        scrollTop: container ? getSnapshotGeometryController().getSnapshotScrollTop(container) : 0,
        maxScrollTop: container ? getSnapshotGeometryController().getSnapshotMaxScrollTop(container) : 0,
        originalScrollTop: container ? session.scrolled.get(container)?.top ?? null : null,
        clip: session?.clip || null,
        viewport: getSnapshotGeometryController().getSnapshotViewport(),
        ...extra
      }, '*');
    }

    /** Captures this container: remembers where it was, un-sticks its content and measures its clip. */
    function useSnapshotContainer(session, container) {
      if (session.container === container) {
        return;
      }
      session.container = container;
      if (!session.scrolled.has(container)) {
        const top = getSnapshotGeometryController().getSnapshotScrollTop(container);
        const maxScrollTop = getSnapshotGeometryController().getSnapshotMaxScrollTop(container);
        session.scrolled.set(container, {
          top,
          maxScrollTop,
          atEnd: top >= maxScrollTop - getConfigController().SNAPSHOT_ALIGN_TOLERANCE_PX
        });
      }
      session.keptStickyElements.clear();
      if (session.stitch) {
        // Before measuring, so a heading stuck at the top is not taken for a header.
        getSnapshotStylesController().unstickSnapshotContent(session);
      }
      session.clip = getSnapshotGeometryController().getSnapshotClip(container, session.provider);
    }

    /**
     * Scrolls the element just under the provider's header, not behind it,
     * and checks that it got there: the container scrolled as asked and the
     * element moved with it. Otherwise the container is put back.
     * @returns {boolean} Whether the element is aligned.
     */
    function alignSnapshotElement(session, { element, container }, alignedBy) {
      useSnapshotContainer(session, container);
      const before = getSnapshotGeometryController().getSnapshotScrollTop(container);
      const elementTop = element.getBoundingClientRect().top;
      const target = getSnapshotGeometryController().clampSnapshotScrollTop(container, before + elementTop - session.clip.top - getConfigController().SNAPSHOT_ALIGN_MARGIN_PX);
      getSnapshotGeometryController().scrollSnapshotContainer(container, target);
      const after = getSnapshotGeometryController().getSnapshotScrollTop(container);
      const moved = elementTop - element.getBoundingClientRect().top;
      if (Math.abs(after - target) > getConfigController().SNAPSHOT_ALIGN_TOLERANCE_PX
        || Math.abs(moved - (after - before)) > getConfigController().SNAPSHOT_ALIGN_TOLERANCE_PX) {
        getSnapshotGeometryController().scrollSnapshotContainer(container, before);
        return false;
      }
      session.alignedBy = alignedBy;
      session.alignTarget = target;
      session.matched = alignedBy === 'prompt';
      session.matchElement = element;
      return true;
    }

    async function handleSnapshotPrepare(data) {
      // A capture that never restored, e.g. when the page went away.
      getSnapshotStylesController().restoreSnapshotPage(snapshotSession);
      snapshotSession = null;
      const stitch = Boolean(data.stitch);
      const session = {
        id: data.sessionId,
        provider: getConfigController().detectProvider(),
        stitch,
        hideFloating: stitch || Boolean(data.hideFloating),
        container: null,
        clip: null,
        matched: false,
        alignedBy: null,
        alignTarget: null,
        matchElement: null,
        // Scroll position of every container touched, to put them back.
        scrolled: new Map(),
        hiddenElements: new Set(),
        unmaskedElements: new Set(),
        unstuckElements: new Set(),
        keptStickyElements: new Set(),
        quietedElements: new Set(),
        hiddenPseudos: new Map(),
        hidesScrollbar: false,
        savedStyles: []
      };
      snapshotSession = session;
      if (data.hideCursor) {
        // Tab sharing can draw the pointer into the frames.
        getSnapshotStylesController().installSnapshotStyles();
        document.documentElement.setAttribute(getConfigController().SNAPSHOT_HIDE_CURSOR_ATTRIBUTE, '');
      }

      const main = getSnapshotGeometryController().findMainSnapshotScrollContainer();
      useSnapshotContainer(session, main);
      if (data.align && typeof data.prompt === 'string') {
        for (const match of getSnapshotGeometryController().findSnapshotPromptMatches(data.prompt, main)) {
          if (alignSnapshotElement(session, match, 'prompt')) {
            break;
          }
        }
      }
      if (!session.alignedBy && stitch) {
        const turn = getSnapshotGeometryController().findSnapshotUserTurn(main);
        if (turn) {
          alignSnapshotElement(session, turn, 'user-turn');
        }
      }
      if (!session.alignedBy && stitch) {
        // Never stitch from wherever the panel happened to be scrolled.
        useSnapshotContainer(session, main);
        getSnapshotGeometryController().scrollSnapshotContainer(main, 0);
        session.alignedBy = 'top';
        session.alignTarget = 0;
      }

      if (session.alignedBy || session.hideFloating) {
        await settleSnapshotScreen(session);
      }
      const isOffTarget = () => session.alignTarget !== null
        && Math.abs(getSnapshotGeometryController().getSnapshotScrollTop(session.container) - session.alignTarget) > getConfigController().SNAPSHOT_ALIGN_TOLERANCE_PX;
      if (isOffTarget()) {
        // The page scrolled itself meanwhile (e.g. back to the bottom).
        getSnapshotGeometryController().scrollSnapshotContainer(session.container, session.alignTarget);
        await settleSnapshotScreen(session);
      }
      if (isOffTarget()) {
        // It keeps doing so: a stitch from here would miss the start, so the
        // panel is shown as it is; a current view just is not aligned.
        session.alignedBy = null;
        session.alignTarget = null;
        session.matched = false;
        postSnapshotState(data.requestId, session, stitch ? { error: 'unaligned' } : {});
        return;
      }
      postSnapshotState(data.requestId, session);
    }

    async function handleSnapshotScroll(data) {
      const session = snapshotSession;
      if (!session || session.id !== data.sessionId || typeof data.scrollTop !== 'number') {
        postSnapshotState(data.requestId, null, { error: 'no-session' });
        return;
      }
      getSnapshotGeometryController().scrollSnapshotContainer(session.container, data.scrollTop);
      await settleSnapshotScreen(session);
      postSnapshotState(data.requestId, session);
    }

    async function handleSnapshotRestore(data) {
      const session = snapshotSession;
      if (!session || session.id !== data.sessionId) {
        postSnapshotState(data.requestId, null, { error: 'no-session' });
        return;
      }
      snapshotSession = null;
      getSnapshotStylesController().restoreSnapshotPage(session);
      const positions = Array.from(session.scrolled).reverse();
      let { scrolled, heldBack } = restoreSnapshotScrollPositions(positions, false);
      // A virtual list (DeepSeek) renders the rows near its old position only
      // once scrolled there, so its range can be short at first and hold it
      // back: follow the range while it grows back.
      for (let attempt = 0; heldBack && !snapshotSession && attempt < getConfigController().SNAPSHOT_RESTORE_ATTEMPTS; attempt += 1) {
        await waitForSnapshotPaint();
        scrolled = false;
        ({ heldBack } = restoreSnapshotScrollPositions(positions, true));
      }
      if (scrolled) {
        await waitForSnapshotPaint();
      }
      postSnapshotState(data.requestId, session, { restored: true });
    }

    /**
     * Scrolls each container back; one that was at the end goes back to the
     * end. With `onlyHeldBack`, only containers left at the end of the short
     * range seen last time are touched; one that moved off it was scrolled by
     * the page meanwhile and is left alone.
     * @returns {{scrolled: boolean, heldBack: boolean}} heldBack: a range is
     *   still shorter than the position needs.
     */
    function restoreSnapshotScrollPositions(positions, onlyHeldBack) {
      let scrolled = false;
      let heldBack = false;
      for (const [container, position] of positions) {
        const current = getSnapshotGeometryController().getSnapshotScrollTop(container);
        if (onlyHeldBack && (position.heldAt === undefined || Math.abs(current - position.heldAt) > 1)) {
          continue;
        }
        const max = getSnapshotGeometryController().getSnapshotMaxScrollTop(container);
        const target = position.atEnd ? max : position.top;
        if (Math.abs(current - target) > 1) {
          getSnapshotGeometryController().scrollSnapshotContainer(container, target);
          scrolled = true;
        }
        const needed = position.atEnd ? position.maxScrollTop : position.top;
        const reached = getSnapshotGeometryController().getSnapshotMaxScrollTop(container);
        position.heldAt = reached < needed - 1 ? getSnapshotGeometryController().getSnapshotScrollTop(container) : undefined;
        heldBack = heldBack || position.heldAt !== undefined;
      }
      return { scrolled, heldBack };
    }

    /** Returns true when the message belonged to the snapshot protocol. */
    function handleSnapshotMessage(event) {
      const type = event.data.type;
      if (type !== getProtocolController().PANELIZE_SNAPSHOT_PREPARE && type !== getProtocolController().PANELIZE_SNAPSHOT_SCROLL && type !== getProtocolController().PANELIZE_SNAPSHOT_RESTORE) {
        return false;
      }
      // Only the page embedding this frame may scroll it.
      if (event.data.context !== 'multi-panel' || event.source !== window.parent) {
        return true;
      }
      const handler = type === getProtocolController().PANELIZE_SNAPSHOT_PREPARE
        ? handleSnapshotPrepare
        : type === getProtocolController().PANELIZE_SNAPSHOT_SCROLL ? handleSnapshotScroll : handleSnapshotRestore;
      handler(event.data).catch((error) => {
        console.warn('[Snapshot] Could not prepare the conversation:', error);
        postSnapshotState(event.data.requestId, null, { error: 'failed' });
      });
      return true;
    }

    return {
      handleSnapshotMessage,
      get snapshotSession() { return snapshotSession; },
    };
  }

  runtime.factories.createSnapshotSessionController = createSnapshotSessionController;
})(globalThis.PanelizeContent);
