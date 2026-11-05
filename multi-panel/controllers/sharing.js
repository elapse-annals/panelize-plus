/**
 * Owns sharing behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import { getProviderById } from '../../modules/providers/providers.js';
import { getSetting } from '../../modules/platform/settings.js';
import { t, getTranslationLocale } from '../../modules/platform/i18n.js';
import {
  SNAPSHOT_MAX_PROMPT_LINES,
  SNAPSHOT_MAX_SUBLINE_LINES,
  composeSnapshot,
  formatProviderList,
  formatSnapshotSubline,
  getSnapshotFileName,
  getSnapshotFrameChromeHeight,
  normalizePromptText,
  toLanguageTag
} from '../../modules/snapshots/share-snapshot.js';
import { TAB_CAPTURE_ERRORS, TAB_CAPTURE_KINDS, TabCaptureError, openTabCaptureSource } from '../../modules/snapshots/tab-capture.js';
import {
  SNAPSHOT_MODES,
  SnapshotCancelledError,
  SnapshotLayoutChangedError,
  captureCurrentView,
  captureFullAnswers
} from '../../modules/snapshots/snapshot-capture.js';
import { getExecuteActionShortcut } from '../../modules/snapshots/share-trigger.js';
import { createPointerGuard, createPointerTracker } from '../../modules/shared/pointer-guard.js';
import { showToast } from './ui.js';

export function createSharingController({
  getPanelsController
}) {
  // ===== Share Snapshot =====

  // Prompt shown above the shared panels: the last one Panelize sent or filled.
  let lastSnapshotPrompt = '';

  let currentSnapshot = null;

  let isCapturingSnapshot = false;

  // Captures behind the open dialog, by mode; title edits re-compose these.
  const snapshotCaptures = new Map();

  let snapshotMode = SNAPSHOT_MODES.FULL;

  // Mode the dialog opens in: the last one picked, kept across sessions.
  let preferredSnapshotMode = SNAPSHOT_MODES.FULL;

  let preferredSnapshotModePromise = null;

  let isPreferredSnapshotModeChosen = false;

  const SNAPSHOT_MODE_STORAGE_KEY = 'shareSnapshotMode';

  // Captures started before giving up on a window that keeps changing size.
  const SNAPSHOT_LAYOUT_ATTEMPTS = 3;

  // Tab sharing from an earlier snapshot, kept so Chrome asks only once.
  let keptSnapshotSource = null;

  let snapshotAbortController = null;

  // Where the pointer was last seen, so a tab-sharing capture knows whether
  // Chrome may draw it into the frames.
  const pointerTracker = createPointerTracker();

  let lastSnapshotProgress = null;

  let snapshotRenderTimer = null;

  let snapshotRenderSequence = 0;

  // Latest render of the share image, which exports wait for.
  let snapshotRender = Promise.resolve();

  let snapshotIconPromise = null;

  let snapshotHint = '';

  let currentTabIdPromise = null;

  const SNAPSHOT_TITLE_RENDER_DELAY_MS = 250;

  // Set once captureVisibleTab worked in this tab. The activeTab grant then
  // lasts for the life of the page, so the shortcut tip is no longer needed.
  const SNAPSHOT_VISIBLE_TAB_FLAG = 'panelize.snapshotVisibleTabCaptured';

  function rememberSnapshotPrompt(text) {
    if (typeof text === 'string' && text.trim()) {
      lastSnapshotPrompt = text;
    }
  }

  function getSnapshotPrompt() {
    return lastSnapshotPrompt || document.getElementById('unified-input')?.value || '';
  }

  /** Resolves with the mode picked last, read from storage the first time. */
  function loadPreferredSnapshotMode() {
    if (!preferredSnapshotModePromise) {
      preferredSnapshotModePromise = chrome.storage.local.get(SNAPSHOT_MODE_STORAGE_KEY)
        .then(result => {
          const mode = result?.[SNAPSHOT_MODE_STORAGE_KEY];
          // A mode picked on this page meanwhile wins over the stored one.
          if (!isPreferredSnapshotModeChosen && Object.values(SNAPSHOT_MODES).includes(mode)) {
            preferredSnapshotMode = mode;
          }
        })
        .catch(error => {
          console.warn('[Multi-Panel] Failed to load the snapshot mode:', error);
        });
    }
    return preferredSnapshotModePromise.then(() => preferredSnapshotMode);
  }

  function savePreferredSnapshotMode(mode) {
    isPreferredSnapshotModeChosen = true;
    if (mode === preferredSnapshotMode) return;
    preferredSnapshotMode = mode;
    chrome.storage.local.set({ [SNAPSHOT_MODE_STORAGE_KEY]: mode }).catch(error => {
      console.warn('[Multi-Panel] Failed to save the snapshot mode:', error);
    });
  }

  function updateShareStreamStatus() {
    const status = document.getElementById('share-stream-status');
    if (status) status.hidden = !keptSnapshotSource?.isActive();
  }

  /** Sharing ended: from Stop, Chrome's own bar, or the shared tab going away. */
  function handleSnapshotSharingEnded() {
    if (keptSnapshotSource && !keptSnapshotSource.isActive()) {
      keptSnapshotSource = null;
    }
    updateShareStreamStatus();
  }

  function stopSnapshotSharing() {
    keptSnapshotSource?.close();
    keptSnapshotSource = null;
    updateShareStreamStatus();
  }

  /**
   * Silent capture when this tab has the activeTab grant; otherwise the kept
   * tab sharing, or a new one that is then kept.
   */
  async function openSnapshotSource() {
    const opened = await openTabCaptureSource({
      tabId: await getCurrentTabId(),
      keptSource: keptSnapshotSource,
      onEnded: handleSnapshotSharingEnded
    });
    if (opened.source.kind === TAB_CAPTURE_KINDS.DISPLAY_MEDIA) {
      keptSnapshotSource = opened.source;
    } else if (keptSnapshotSource) {
      // The grant lasts for the life of the page: sharing is no longer needed.
      stopSnapshotSharing();
    }
    updateShareStreamStatus();
    return opened;
  }

  function isStaleSnapshotSourceError(error) {
    return error instanceof TabCaptureError
      && (error.code === TAB_CAPTURE_ERRORS.ENDED || error.code === TAB_CAPTURE_ERRORS.WRONG_SURFACE);
  }

  /** Opens the capture source and gets it ready for a run. */
  async function startSnapshotSource() {
    let opened = await openSnapshotSource();
    if (!opened.reused) return opened;
    try {
      await opened.source.start();
    } catch (error) {
      if (!isStaleSnapshotSourceError(error)) throw error;
      // Sharing ended since the last snapshot: ask again.
      stopSnapshotSharing();
      opened = await openSnapshotSource();
    }
    return opened;
  }

  function getCurrentTabId() {
    if (!currentTabIdPromise) {
      currentTabIdPromise = typeof chrome.tabs?.getCurrent === 'function'
        ? Promise.resolve(chrome.tabs.getCurrent()).then(tab => tab?.id ?? null).catch(() => null)
        : Promise.resolve(null);
    }
    return currentTabIdPromise;
  }

  async function loadSnapshotIcon() {
    const icon = new Image();
    icon.src = chrome.runtime.getURL('icons/icon-128.png');
    try {
      await icon.decode();
      return icon;
    } catch (error) {
      console.warn('[Multi-Panel] Failed to load the snapshot icon:', error);
      return null;
    }
  }

  function getSnapshotIcon() {
    if (!snapshotIconPromise) {
      snapshotIconPromise = loadSnapshotIcon();
    }
    return snapshotIconPromise;
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not encode the snapshot as PNG'));
        }
      }, 'image/png');
    });
  }

  function getSnapshotTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function getSnapshotPanels() {
    return getPanelsController().panels.map(panel => ({
      id: panel.id,
      name: getProviderById(panel.providerId)?.name || panel.providerId,
      iframe: panel.iframe,
      element: document.getElementById(panel.id)
    })).filter(panel => panel.element && panel.iframe);
  }

  function isShareModalOpen() {
    const modal = document.getElementById('share-modal');
    return Boolean(modal) && modal.style.display !== 'none';
  }

  function releaseSnapshotCapture(capture) {
    if (!capture?.content) return;
    if (typeof capture.content.close === 'function') {
      capture.content.close();
    } else {
      // Free the stitched canvas right away; it can be large.
      capture.content.width = 0;
      capture.content.height = 0;
    }
  }

  function clearSnapshotCaptures() {
    snapshotCaptures.forEach(releaseSnapshotCapture);
    snapshotCaptures.clear();
  }

  function setSnapshotCapture(mode, capture, { replaceAll = false } = {}) {
    if (replaceAll) {
      clearSnapshotCaptures();
    } else {
      releaseSnapshotCapture(snapshotCaptures.get(mode));
    }
    snapshotCaptures.set(mode, capture);
  }

  function updateSnapshotProgress(progress) {
    const text = document.getElementById('snapshot-progress-text');
    const bar = document.getElementById('snapshot-progress-bar');
    if (!text || !bar) return;
    lastSnapshotProgress = progress;
    if (!progress) {
      text.textContent = t('shareProgressPreparing');
      bar.removeAttribute('value');
      return;
    }
    const total = Math.max(progress.step, progress.total);
    text.textContent = t('shareProgressStep', [String(progress.step), String(total)]);
    bar.max = total;
    bar.value = progress.step;
  }

  /** Asks the user to keep the pointer still while a frame waits for it. */
  function showSnapshotPointerWait(waiting) {
    const text = document.getElementById('snapshot-progress-text');
    if (!text) return;
    if (waiting) {
      text.textContent = t('shareProgressHoldPointer');
    } else {
      updateSnapshotProgress(lastSnapshotProgress);
    }
  }

  function setSnapshotBusy(busy) {
    document.body.classList.toggle('snapshot-capturing', busy);
    const shareBtn = document.getElementById('share-snapshot-btn');
    if (shareBtn) shareBtn.disabled = busy;
    document.querySelectorAll('.share-mode-btn, #share-download-btn, #share-copy-btn, #share-title-input')
      .forEach(element => {
        element.disabled = busy;
      });
    const progress = document.getElementById('snapshot-progress');
    if (progress) progress.hidden = !busy;
    if (busy) updateSnapshotProgress(null);
  }

  function updateShareModeButtons() {
    document.querySelectorAll('.share-mode-btn').forEach(button => {
      button.setAttribute('aria-checked', String(button.dataset.mode === snapshotMode));
    });
  }

  async function updateSnapshotHint({ source, fallbackReason }) {
    if (source.kind === TAB_CAPTURE_KINDS.VISIBLE_TAB) {
      sessionStorage.setItem(SNAPSHOT_VISIBLE_TAB_FLAG, '1');
      snapshotHint = '';
      return;
    }
    snapshotHint = '';
    if (fallbackReason !== TAB_CAPTURE_ERRORS.PERMISSION || sessionStorage.getItem(SNAPSHOT_VISIBLE_TAB_FLAG)) {
      return;
    }
    // The toolbar icon and its shortcut do nothing while the setting is off.
    if ((await getSetting('keyboardShortcutEnabled')) === false) {
      return;
    }
    let shortcut = '';
    try {
      shortcut = getExecuteActionShortcut(await chrome.commands.getAll());
    } catch (error) {
      // Without the commands API, point at the toolbar icon instead
    }
    snapshotHint = shortcut ? t('shareShortcutHint', [shortcut]) : t('shareToolbarHint');
  }

  // Names the panels whose answer is not shown whole, both in the dialog and in the image.
  function getSnapshotCutNotes(capture) {
    const locale = getSnapshotLocale();
    const notes = [];
    if (capture.truncated.length) {
      notes.push(t('shareTruncatedNote', [formatProviderList(capture.truncated, locale)]));
    }
    if (capture.interrupted.length) {
      notes.push(t('shareInterruptedNote', [formatProviderList(capture.interrupted, locale)]));
    }
    return notes;
  }

  function updateShareNotes() {
    const hint = document.getElementById('share-capture-hint');
    const hintText = document.getElementById('share-capture-hint-text');
    if (hint && hintText) {
      hintText.textContent = snapshotHint;
      hint.hidden = !snapshotHint;
    }

    const notes = document.getElementById('share-capture-notes');
    const capture = snapshotCaptures.get(snapshotMode);
    if (!notes) return;
    const lines = [];
    if (capture?.outOfView.length) {
      lines.push(t('shareOutOfViewNote', [formatProviderList(capture.outOfView, getSnapshotLocale())]));
    }
    if (capture?.currentViewOnly.length) {
      lines.push(t('shareCurrentViewOnly', [formatProviderList(capture.currentViewOnly, getSnapshotLocale())]));
    }
    if (capture) {
      lines.push(...getSnapshotCutNotes(capture));
    }
    notes.textContent = lines.join('\n');
    notes.hidden = lines.length === 0;
  }

  function getSnapshotLocale() {
    return toLanguageTag(getTranslationLocale());
  }

  function setCurrentSnapshot(blob) {
    const fileName = currentSnapshot?.fileName || getSnapshotFileName(new Date());
    releaseCurrentSnapshot();
    currentSnapshot = { blob, url: URL.createObjectURL(blob), fileName };
    document.getElementById('share-preview').src = currentSnapshot.url;
  }

  async function renderSnapshot() {
    const capture = snapshotCaptures.get(snapshotMode);
    if (!capture) return;
    const sequence = ++snapshotRenderSequence;
    const icon = await getSnapshotIcon();
    const locale = getSnapshotLocale();
    const names = capture.names;
    const canvas = document.createElement('canvas');
    composeSnapshot(canvas, {
      content: capture.content,
      scale: capture.scale,
      title: document.getElementById('share-title-input')?.value || '',
      theme: capture.theme,
      showWatermark: capture.showWatermark,
      icon,
      labelText: t('shareSnapshotPromptLabel'),
      taglineText: t('shareSnapshotTagline'),
      captionText: t('shareSnapshotCaption'),
      sublineText: formatSnapshotSubline({
        providersText: names.length ? t('shareSnapshotSubline', [formatProviderList(names, locale)]) : '',
        date: capture.date,
        locale
      }),
      // The image has room for one line.
      noteText: getSnapshotCutNotes(capture).join(' · ')
    });
    const blob = await canvasToPngBlob(canvas);
    canvas.width = 0;
    canvas.height = 0;
    // A newer render (e.g. the next keystroke) wins.
    if (sequence !== snapshotRenderSequence) return;
    setCurrentSnapshot(blob);
    updateShareNotes();
  }

  /** Renders the share image now, instead of any render still scheduled. */
  function startSnapshotRender() {
    clearTimeout(snapshotRenderTimer);
    snapshotRenderTimer = null;
    snapshotRender = renderSnapshot();
    return snapshotRender;
  }

  function scheduleSnapshotRender() {
    clearTimeout(snapshotRenderTimer);
    snapshotRenderTimer = setTimeout(() => {
      startSnapshotRender().catch(error => {
        console.warn('[Multi-Panel] Failed to update the snapshot:', error);
        showToast(t('shareCaptureFailed'));
      });
    }, SNAPSHOT_TITLE_RENDER_DELAY_MS);
  }

  /**
   * The share image as the dialog stands, e.g. with a title edit still waiting
   * for its render; null when the dialog was closed meanwhile. Rejects when
   * the latest render failed, rather than giving an older image.
   */
  async function getUpToDateSnapshot() {
    if (snapshotRenderTimer !== null) {
      startSnapshotRender();
    }
    for (;;) {
      const render = snapshotRender;
      try {
        await render;
      } catch (error) {
        if (render === snapshotRender) throw error;
      }
      if (render === snapshotRender) return currentSnapshot;
    }
  }

  function releaseCurrentSnapshot() {
    if (currentSnapshot) {
      URL.revokeObjectURL(currentSnapshot.url);
      currentSnapshot = null;
    }
  }

  function openShareModal() {
    document.getElementById('share-modal').style.display = 'flex';
    updateShareModeButtons();
    updateShareStreamStatus();
  }

  /** Focus for the dialog once its buttons are enabled again. */
  function focusShareModal({ wasOpen }) {
    if (!isShareModalOpen()) return;
    const modal = document.getElementById('share-modal');
    if (!wasOpen) {
      document.getElementById('share-copy-btn')?.focus();
    } else if (!modal.contains(document.activeElement)) {
      // The mode button that started the capture was disabled meanwhile.
      modal.querySelector('.share-mode-btn[aria-checked="true"]')?.focus();
    }
  }

  function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (!modal || modal.style.display === 'none') return;
    if (isCapturingSnapshot) return;
    modal.style.display = 'none';
    clearTimeout(snapshotRenderTimer);
    snapshotRenderTimer = null;
    snapshotRenderSequence += 1;
    document.getElementById('share-preview').removeAttribute('src');
    releaseCurrentSnapshot();
    clearSnapshotCaptures();
    snapshotHint = '';
    snapshotMode = preferredSnapshotMode;
  }

  function getCaptureErrorMessage(error) {
    if (error instanceof SnapshotCancelledError) return t('shareCaptureCancelled');
    if (error instanceof SnapshotLayoutChangedError) return t('shareCaptureLayoutChanged');
    if (error instanceof TabCaptureError) {
      if (error.code === TAB_CAPTURE_ERRORS.CANCELLED) return t('shareCaptureCancelled');
      if (error.code === TAB_CAPTURE_ERRORS.WRONG_SURFACE) return t('shareCaptureWrongSurface');
      if (error.code === TAB_CAPTURE_ERRORS.TAB_HIDDEN) return t('shareCaptureTabHidden');
    }
    return t('shareCaptureFailed');
  }

  function isSnapshotCancellation(error) {
    return error instanceof SnapshotCancelledError || error?.code === TAB_CAPTURE_ERRORS.CANCELLED;
  }

  /**
   * Captures the comparison in `mode` and shows it in the share dialog.
   * Must run straight from a user gesture: without the activeTab grant the
   * capture falls back to the Screen Capture API, which needs that gesture.
   * @param {string} mode - A SNAPSHOT_MODES value.
   * @param {object} [options]
   * @param {boolean} [options.refresh] - Drop the captures of other modes.
   */
  async function captureSnapshot(mode, { refresh = false } = {}) {
    if (isCapturingSnapshot) return;
    isCapturingSnapshot = true;
    const controller = new AbortController();
    snapshotAbortController = controller;
    const wasOpen = isShareModalOpen();
    setSnapshotBusy(true);
    let source = null;
    let pointerGuard = null;
    try {
      const opened = await startSnapshotSource();
      source = opened.source;
      await updateSnapshotHint(opened);
      const hideCursor = source.kind === TAB_CAPTURE_KINDS.DISPLAY_MEDIA;
      document.documentElement.classList.toggle('snapshot-hide-cursor', hideCursor);
      const grid = document.getElementById('panel-grid');
      // CSS cannot hide the pointer from tab sharing: shield the panels and
      // take each frame once Chrome has stopped drawing it.
      pointerGuard = hideCursor
        ? createPointerGuard({ area: grid, tracker: pointerTracker, onWaitChange: showSnapshotPointerWait })
        : null;

      const theme = getSnapshotTheme();
      const showWatermark = (await getSetting('shareWatermarkEnabled')) !== false;
      const options = {
        source,
        grid,
        panels: getSnapshotPanels(),
        prompt: getSnapshotPrompt(),
        hideCursor,
        beforeGrab: (signal) => pointerGuard?.waitUntilStill(signal),
        signal: controller.signal,
        onProgress: updateSnapshotProgress
      };
      const capture = () => (mode === SNAPSHOT_MODES.FULL
        ? captureFullAnswers({
          ...options,
          // Room for the frame, with the longest headline the title can take.
          getChromeHeight: (scale) => getSnapshotFrameChromeHeight({
            contentWidth: Math.round(grid.getBoundingClientRect().width * scale),
            scale,
            theme,
            showWatermark,
            titleLineCount: SNAPSHOT_MAX_PROMPT_LINES,
            hasSubline: true,
            sublineLineCount: SNAPSHOT_MAX_SUBLINE_LINES,
            hasNote: true
          })
        })
        : captureCurrentView(options));
      let result = null;
      for (let attempt = 1; !result; attempt += 1) {
        try {
          result = await capture();
        } catch (error) {
          if (!(error instanceof SnapshotLayoutChangedError) || attempt >= SNAPSHOT_LAYOUT_ATTEMPTS) {
            throw error;
          }
          // The panels moved or changed size under the capture: measure them again.
          console.info('[Multi-Panel] Layout changed during the snapshot, starting over');
        }
      }
      console.info('[Multi-Panel] Snapshot alignment:', JSON.stringify(result.alignment));

      setSnapshotCapture(mode, { ...result, theme, showWatermark, date: new Date() }, { replaceAll: refresh || !wasOpen });
      snapshotMode = mode;
      savePreferredSnapshotMode(mode);
      if (!wasOpen) {
        document.getElementById('share-title-input').value = normalizePromptText(getSnapshotPrompt());
      }
      await startSnapshotRender();
      openShareModal();
    } catch (error) {
      if (isSnapshotCancellation(error)) {
        console.info('[Multi-Panel] Snapshot cancelled');
      } else {
        console.warn('[Multi-Panel] Failed to create snapshot:', error);
      }
      showToast(getCaptureErrorMessage(error));
    } finally {
      document.documentElement.classList.remove('snapshot-hide-cursor');
      pointerGuard?.dispose();
      if (source && source === keptSnapshotSource) {
        // Paused until the next snapshot.
        source.stop().catch(error => console.warn('[Multi-Panel] Failed to pause tab sharing:', error));
      } else {
        source?.close();
      }
      updateShareStreamStatus();
      snapshotAbortController = null;
      isCapturingSnapshot = false;
      setSnapshotBusy(false);
      updateShareModeButtons();
      focusShareModal({ wasOpen });
    }
  }

  function cancelSnapshotCapture() {
    snapshotAbortController?.abort();
  }

  async function shareComparisonSnapshot() {
    getPanelsController().setFocusedPanel(null);
    return captureSnapshot(await loadPreferredSnapshotMode(), { refresh: true });
  }

  function selectSnapshotMode(mode) {
    if (isCapturingSnapshot || !Object.values(SNAPSHOT_MODES).includes(mode)) return;
    if (snapshotCaptures.has(mode)) {
      if (mode !== snapshotMode) {
        snapshotMode = mode;
        savePreferredSnapshotMode(mode);
        updateShareModeButtons();
        startSnapshotRender().catch(error => console.warn('[Multi-Panel] Failed to show the snapshot:', error));
      }
      return;
    }
    captureSnapshot(mode);
  }

  /** The toolbar icon, its shortcut or the context menu was used on this page. */
  async function handleShareSnapshotRequest(payload = {}) {
    if (payload.tabId !== await getCurrentTabId() || isCapturingSnapshot) {
      return;
    }
    getPanelsController().setFocusedPanel(null);
    captureSnapshot(isShareModalOpen() ? snapshotMode : await loadPreferredSnapshotMode(), { refresh: true });
  }

  async function downloadCurrentSnapshot() {
    if (!currentSnapshot) return;
    let snapshot;
    try {
      snapshot = await getUpToDateSnapshot();
    } catch (error) {
      console.warn('[Multi-Panel] Failed to update the snapshot:', error);
      showToast(t('shareCaptureFailed'));
      return;
    }
    if (!snapshot) return;
    const link = document.createElement('a');
    link.href = snapshot.url;
    link.download = snapshot.fileName;
    link.click();
  }

  async function copyCurrentSnapshot() {
    if (!currentSnapshot) return;
    try {
      // Written right away, while the click still allows it; the image follows
      // once a pending title edit is drawn.
      const blob = getUpToDateSnapshot().then((snapshot) => {
        if (!snapshot) throw new Error('The share dialog was closed');
        return snapshot.blob;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast(t('shareCopied'));
    } catch (error) {
      console.warn('[Multi-Panel] Failed to copy snapshot:', error);
      showToast(t('shareCopyFailed'));
    }
  }

  function setupShareSnapshot() {
    const modal = document.getElementById('share-modal');
    document.getElementById('share-snapshot-btn')?.addEventListener('click', shareComparisonSnapshot);
    document.getElementById('close-share-modal')?.addEventListener('click', closeShareModal);
    document.getElementById('share-download-btn')?.addEventListener('click', downloadCurrentSnapshot);
    document.getElementById('share-copy-btn')?.addEventListener('click', copyCurrentSnapshot);
    document.getElementById('snapshot-cancel-btn')?.addEventListener('click', cancelSnapshotCapture);
    document.getElementById('share-stream-stop')?.addEventListener('click', () => {
      stopSnapshotSharing();
      document.getElementById('share-copy-btn')?.focus();
    });
    // Tab sharing ends with the page.
    window.addEventListener('pagehide', stopSnapshotSharing);
    document.getElementById('share-title-input')?.addEventListener('input', scheduleSnapshotRender);
    document.querySelectorAll('.share-mode-btn').forEach(button => {
      button.addEventListener('click', () => selectSnapshotMode(button.dataset.mode));
    });
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeShareModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (isCapturingSnapshot) {
        cancelSnapshotCapture();
      } else {
        closeShareModal();
      }
    });
    // Resolve early so the first shortcut press is matched without delay.
    getCurrentTabId();
    loadPreferredSnapshotMode().then(mode => {
      if (!isShareModalOpen()) snapshotMode = mode;
    });
  }

  return {
    getCurrentTabId,
    getSnapshotLocale,
    handleShareSnapshotRequest,
    isShareModalOpen,
    rememberSnapshotPrompt,
    setupShareSnapshot,
  };
}
