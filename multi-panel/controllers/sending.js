/**
 * Owns sending behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */
import {
  calculatePendingImageIds,
  cleanStalePanelRetryState,
  createBroadcastGate,
  createPanelActionResultWaiter,
  determinePanelMessageType,
  getFillTargetPanels,
  getPanelActionResultTimeoutMs,
  getPanelBroadcastActionParams,
  normalizePanelResults,
  shouldClearFillPayload,
  summarizeFillResults
} from '../../modules/panels/panel-action-results.js';
import { PANEL_READY_STATE, PANEL_READY_TIMEOUT_MS, isSendHeldByReadiness, summarizePanelReadiness } from '../../modules/panels/panel-readiness.js';
import { applyPromptMode, normalizePanelPromptMode } from '../../modules/prompts/prompt-modes.js';
import { getLocalizedText, showToast } from './ui.js';

export function createSendingController({
  getAnswersController,
  getAttachmentsController,
  getComposerController,
  getConversationsController,
  getFocusController,
  getPanelsController,
  getPresentationController,
  getPromptsController,
  getProviderControlsController,
  getQuestionHistoryController,
  getRatingController,
  getSharingController
}) {
  // Array of uploaded images { id, name, type, dataUrl }
  let failedFillPanelIds = new Set();

  let pendingFillImageIdsByPanel = new Map();

  // Each panel's text and prompt mode from the last file fill, reused when
  // retrying only its failed panels so the outgoing payload stays the one
  // originally planned.
  let pendingFillPayloadsByPanel = new Map();

  // Prompt modes captured when a Fill succeeded, reused when Send submits the
  // already-filled text so the answer round matches what was injected.
  let pendingFilledPanelPromptModes = new Map();

  const broadcastGate = createBroadcastGate();

  let fillActionRequestCounter = 0;

  let fillPayloadRevision = 0;

  // Text of the last Fill, used as the question when Send then submits it.
  let pendingFilledPromptText = '';

  const NEW_CHAT_STATUS_AUTO_HIDE_MS = 4000;

  let readyStatusHideTimerId = null;

  // Set while some panel is loading, so finishing shows "all ready" once.
  let wasPreparingPanels = false;

  let isReadyStatusDismissed = false;

  // Text sends skipped for AIs still loading, by panel id; each is sent once
  // that panel is ready, or dropped when it times out or a new send starts.
  const catchUpSends = new Map();

  // ===== Message Broadcasting =====
  function createFillActionRequestId() {
    fillActionRequestCounter += 1;
    return `fill-${Date.now()}-${fillActionRequestCounter}`;
  }

  function updateFillRetryButton() {
    const fillBtn = document.getElementById('fill-input-btn');
    if (!fillBtn) {
      return;
    }

    const text = fillBtn.querySelector('.btn-text');
    const hasFailures = failedFillPanelIds.size > 0;
    if (text) {
      text.textContent = hasFailures ? 'Retry Failed' : 'Fill';
    }
    fillBtn.title = hasFailures ? 'Retry Failed Panels' : 'Fill Input Boxes';
    fillBtn.dataset.retryFailed = hasFailures ? 'true' : 'false';
    getComposerController().composerControls?.refreshTooltips();
  }

  function resetFillRetryState() {
    fillPayloadRevision += 1;
    pendingFillImageIdsByPanel = new Map();
    pendingFillPayloadsByPanel = new Map();
    if (failedFillPanelIds.size === 0) {
      updateFillRetryButton();
      return;
    }

    failedFillPanelIds = new Set();
    updateFillRetryButton();
  }

  function setFillRetryState(panelIds) {
    failedFillPanelIds = new Set(panelIds);
    updateFillRetryButton();
  }

  async function broadcastMessage(typedText, autoSubmit = true, { promptMode: promptModeOverride } = {}) {
    if (getConversationsController().isNewChatBusy) {
      // The draft and textarea stay untouched so the user can keep typing.
      showToast(getLocalizedText('composerSendBlockedNewChat', 'New conversations are starting. Your draft is kept; send when they are ready.'));
      return { ok: false, reason: 'new-chat-busy', sent: 0, total: getPanelsController().panels.length };
    }
    if (isSendHeldByReadiness(summarizePanelReadiness(getPanelsController().panels))) {
      showToast(getLocalizedText('composerSendBlockedPreparing', 'The AIs are still loading. Your draft is kept; send when they are ready.'));
      return { ok: false, reason: 'preparing', sent: 0, total: getPanelsController().panels.length };
    }
    if (getComposerController().composerControls?.isTierBusy()) {
      showToast(getLocalizedText('composerActionBusy', 'Wait for the current operation to finish.'));
      return { ok: false, reason: 'busy', sent: 0, total: getPanelsController().panels.length };
    }
    if (!broadcastGate.tryAcquire()) {
      return { ok: false, reason: 'busy', sent: 0, total: getPanelsController().panels.length };
    }

    // The draft is about to be sent or replaced; do not leave a suggestion popup
    // over the composer once it clears.
    getQuestionHistoryController().dismissQuestionHistory({ suppress: true });

    const sendBtn = document.getElementById('send-all-btn');
    const fillBtn = document.getElementById('fill-input-btn');
    const statusEl = document.getElementById('send-status');

    const hasImages = getAttachmentsController().uploadedImages.length > 0;
    const hasFailedPanels = failedFillPanelIds.size > 0;
    const broadcastParams = getPanelBroadcastActionParams({
      hasImages,
      hasFailedPanels,
      autoSubmit
    });
    const { isFillAction, shouldAutoSubmit, waitForActionResult } = broadcastParams;
    // Auto mode removes the trigger words (say /study) it finds and uses their
    // modes for this send; the trimmed question is what stats and snapshots keep.
    const composerControls = getComposerController().composerControls;
    const resolvedMode = composerControls?.resolvePromptMode?.(typedText, { promptMode: promptModeOverride })
      ?? { text: typedText, instruction: composerControls?.getPromptMode() ?? null };
    const text = resolvedMode.text;

    // Each panel gets the question plus its own instruction; a retried file fill
    // reuses the payload captured when that panel was first filled.
    const panelPayloads = new Map();
    const panelPayloadFor = panel => {
      if (hasImages && hasFailedPanels && pendingFillPayloadsByPanel.has(panel.id)) {
        return pendingFillPayloadsByPanel.get(panel.id);
      }
      const panelMode = normalizePanelPromptMode(panel.promptMode);
      const instruction = composerControls?.resolvePanelPromptInstruction?.(panelMode, resolvedMode.instruction)
        ?? resolvedMode.instruction;
      return {
        promptMode: panelMode,
        text: text.trim() ? applyPromptMode(text, instruction) : instruction || text
      };
    };
    // The panels that took part, with the mode each actually received.
    const answerPanelsFor = panelIds => getPanelsController().panels
      .filter(panel => panelIds.has(panel.id))
      .map(panel => ({
        id: panel.id,
        providerId: panel.providerId,
        promptMode: panelPayloads.get(panel.id)?.promptMode
      }));

    try {
      if (typedText.trim() && !text.trim() && !hasImages) {
        showToast('Please enter a message or attach a file');
        return { ok: false, reason: 'empty', sent: 0, total: getPanelsController().panels.length };
      }
      if (!text.trim() && !hasImages) {
        // If input is empty and autoSubmit is true, just trigger send buttons
        if (autoSubmit) {
          return await triggerSendButtons();
        }
        showToast('Please enter a message or attach a file');
        return { ok: false, reason: 'empty', sent: 0, total: getPanelsController().panels.length };
      }

      // Only the message the AIs receive carries the prompt-mode instruction:
      // the question stays as typed for answer stats, snapshots and the draft.
      // Files sent without text get the instruction on its own.

      // Filling focuses each provider's composer too. Keep the unified input
      // focused, or the next Enter lands in one panel and sends only there.
      const fillActionRequestId = isFillAction ? createFillActionRequestId() : null;
      const requestId = getFocusController().restoreUnifiedInputFocusAfterSend(
        shouldAutoSubmit ? getFocusController().getChatgptPanelsWithFrames() : [],
        fillActionRequestId || getFocusController().createSendFocusRequestId()
      );
      const payloadRevisionAtStart = fillPayloadRevision;

      // Disable buttons during send
      sendBtn.disabled = true;
      fillBtn.disabled = true;
      statusEl.textContent = shouldAutoSubmit ? 'Sending...' : 'Filling...';
      statusEl.className = 'send-status';

      cleanStalePanelRetryState(getPanelsController().panels, pendingFillImageIdsByPanel, failedFillPanelIds);

      // Past the ready threshold, AIs still loading are skipped: with files they
      // join Retry Failed, and a text send reaches each once it is ready.
      catchUpSends.clear();
      const loadingPanels = summarizePanelReadiness(getPanelsController().panels).pending;
      const loadingPanelIds = new Set(loadingPanels.map(panel => panel.id));
      const targetPanels = (hasImages
        ? getFillTargetPanels(getPanelsController().panels, failedFillPanelIds)
        : getPanelsController().panels).filter(panel => !loadingPanelIds.has(panel.id));
      const previousFailedPanelIds = new Set(failedFillPanelIds);
      const attemptedImagesByPanel = new Map();
      if (hasImages && !hasFailedPanels && pendingFillPayloadsByPanel.size) {
        pendingFillPayloadsByPanel = new Map();
      }
      if (waitForActionResult) {
        targetPanels.forEach(panel => getFocusController().sendFocusFillingPanelIds.add(panel.id));
      }

      const sentAt = Date.now();
      // Send to all panels, or only the panels that failed the previous image fill.
      const panelResults = await Promise.allSettled(
        targetPanels.map(panel => {
          const isPanelRetry = previousFailedPanelIds.has(panel.id);
          const payload = panelPayloadFor(panel);
          panelPayloads.set(panel.id, payload);
          if (hasImages) pendingFillPayloadsByPanel.set(panel.id, payload);
          let panelImages = [];
          if (hasImages) {
            if (isPanelRetry && pendingFillImageIdsByPanel.has(panel.id)) {
              const pendingIds = new Set(pendingFillImageIdsByPanel.get(panel.id));
              panelImages = getAttachmentsController().uploadedImages.filter(img => pendingIds.has(img.id));
            } else {
              panelImages = getAttachmentsController().uploadedImages;
            }
          }
          attemptedImagesByPanel.set(panel.id, panelImages);

          const imageCount = panelImages.length;
          const panelTimeoutMs = isFillAction
            ? getPanelActionResultTimeoutMs(imageCount)
            : 8000;

          return sendToPanel(
            panel,
            payload.text,
            panelImages,
            shouldAutoSubmit,
            requestId,
            isPanelRetry,
            panelTimeoutMs,
            {
              isFillAction,
              waitForActionResult
            }
          ).finally(() => {
            // Uploads can outlast the restore timers; hold focus until each
            // panel has finished filling.
            if (getFocusController().activeSendFocusRequestId === requestId && getFocusController().sendFocusFillingPanelIds.delete(panel.id)) {
              getFocusController().maybeStopSendFocusRestore();
            }
          });
        })
      );
      const normalizedResults = [
        ...normalizePanelResults(panelResults, targetPanels),
        ...loadingPanels.map(panel => ({ panelId: panel.id, ok: false, reason: 'not-ready', succeededImageIds: [] }))
      ];
      if (loadingPanels.length && !hasImages) {
        loadingPanels.forEach(panel => catchUpSends.set(panel.id, {
          providerId: panel.providerId,
          text: panelPayloadFor(panel).text,
          autoSubmit: shouldAutoSubmit,
          isFillAction,
          waitForActionResult
        }));
      }
      if (loadingPanels.length) {
        showToast(getLocalizedText(
          hasImages ? 'composerSkippedPreparingFiles' : 'composerSkippedPreparing',
          hasImages
            ? '$1 AIs were still loading and were skipped; use Retry Failed once they are ready.'
            : '$1 AIs were still loading; they get this question once they are ready.',
          [String(loadingPanels.length)]
        ));
      }

      if (hasImages) {
        if (fillPayloadRevision !== payloadRevisionAtStart) {
          statusEl.textContent = 'Input changed; fill again';
          statusEl.className = 'send-status partial';
          setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'send-status';
          }, 3000);
          return;
        }

        normalizedResults.forEach(result => {
          if (!result?.panelId) return;
          const attempted = attemptedImagesByPanel.get(result.panelId) || getAttachmentsController().uploadedImages;
          const attemptedIds = attempted.map(img => img.id);

          if (result.ok) {
            failedFillPanelIds.delete(result.panelId);
            pendingFillImageIdsByPanel.delete(result.panelId);
            pendingFillPayloadsByPanel.delete(result.panelId);
          } else {
            failedFillPanelIds.add(result.panelId);
            const pendingIds = calculatePendingImageIds(attemptedIds, result.succeededImageIds);
            pendingFillImageIdsByPanel.set(result.panelId, pendingIds);
          }
        });

        const summary = summarizeFillResults(getPanelsController().panels, normalizedResults, previousFailedPanelIds);
        const totalCount = getPanelsController().panels.length;
        const { successfulCount, failedCount } = summary;

        const doneLabel = shouldAutoSubmit ? 'Sent to' : 'Filled';
        if (summary.allSucceeded) {
          statusEl.textContent = shouldAutoSubmit
            ? `Sent to ${successfulCount} AI${successfulCount > 1 ? 's' : ''}`
            : `Filled ${successfulCount} input${successfulCount > 1 ? 's' : ''}`;
          statusEl.className = 'send-status success';
          setFillRetryState([]);
          pendingFillImageIdsByPanel.clear();
        } else if (successfulCount > 0) {
          statusEl.textContent = `${doneLabel} ${successfulCount}/${totalCount}; ${failedCount} failed`;
          statusEl.className = 'send-status partial';
          setFillRetryState(summary.failedPanelIds);
        } else {
          statusEl.textContent = `Fill failed: ${failedCount}/${totalCount} panels failed`;
          statusEl.className = 'send-status error';
          setFillRetryState(summary.failedPanelIds);
        }

        if (failedCount > 0) {
          const resultsByPanelId = new Map(
            normalizedResults.map(result => [result.panelId, result])
          );
          const failedPanels = getPanelsController().panels
            .filter(panel => summary.failedPanelIds.has(panel.id))
            .map(panel => ({
              panelId: panel.id,
              provider: panel.providerId,
              reason: resultsByPanelId.get(panel.id)?.reason || 'injection-error'
            }));
          console.warn('[Multi-Panel] Image fill failed for panels:', failedPanels);
        }

        // Panels that filled in this round have sent too when Send All asked
        // for it; failed panels keep the payload for the next retry.
        const roundPanelIds = new Set(
          normalizedResults.filter(result => result?.ok).map(result => result.panelId)
        );
        if (shouldAutoSubmit && roundPanelIds.size > 0) {
          getRatingController().recordSendForRatingPrompt();
          getAnswersController().startAnswerRound(requestId, text, sentAt, answerPanelsFor(roundPanelIds));
          pendingFilledPromptText = '';
          pendingFilledPanelPromptModes = new Map();
        }

        if (successfulCount > 0) {
          getSharingController().rememberSnapshotPrompt(text);
          if (!shouldAutoSubmit) {
            pendingFilledPromptText = text;
            pendingFilledPanelPromptModes = new Map(
              [...roundPanelIds]
                .filter(panelId => panelPayloads.has(panelId))
                .map(panelId => [panelId, panelPayloads.get(panelId).promptMode])
            );
          }
        }

        if (shouldClearFillPayload(summary)) {
          document.getElementById('unified-input').value = '';
          getComposerController().resizeTextarea();
          getAttachmentsController().clearAllImages();
        }

        setTimeout(() => {
          statusEl.textContent = '';
          statusEl.className = 'send-status';
        }, 3000);
        return {
          ok: successfulCount > 0 && shouldAutoSubmit,
          sent: shouldAutoSubmit ? successfulCount : 0,
          total: totalCount,
          reason: successfulCount > 0 ? '' : 'fill-failed'
        };
      }

      // Count results (panels only)
      const panelSuccessful = normalizedResults.filter(result => result.ok).length;
      const totalSuccessful = panelSuccessful;
      const totalCount = getPanelsController().panels.length;
      const failed = totalCount - totalSuccessful;

      // Update status
      if (failed === 0) {
        statusEl.textContent = shouldAutoSubmit
          ? `Sent to ${totalSuccessful} AI${totalSuccessful > 1 ? 's' : ''}`
          : `Filled ${totalSuccessful} input${totalSuccessful > 1 ? 's' : ''}`;
        statusEl.className = 'send-status success';
      } else if (totalSuccessful > 0) {
        statusEl.textContent = shouldAutoSubmit
          ? `Sent to ${totalSuccessful}/${totalCount}`
          : `Filled ${totalSuccessful}/${totalCount}`;
        statusEl.className = 'send-status partial';
      } else {
        statusEl.textContent = shouldAutoSubmit ? 'Failed to send' : 'Failed to fill';
        statusEl.className = 'send-status error';
      }

      // Clear status after delay
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'send-status';
      }, 3000);

      if (shouldAutoSubmit && totalSuccessful > 0) {
        getRatingController().recordSendForRatingPrompt();
        const sentPanelIds = new Set(
          normalizedResults.filter(result => result.ok).map(result => result.panelId)
        );
        getAnswersController().startAnswerRound(requestId, text, sentAt, answerPanelsFor(sentPanelIds));
        pendingFilledPromptText = '';
        pendingFilledPanelPromptModes = new Map();
      } else if (!shouldAutoSubmit && totalSuccessful > 0) {
        pendingFilledPromptText = text;
        pendingFilledPanelPromptModes = new Map(
          normalizedResults
            .filter(result => result.ok && panelPayloads.has(result.panelId))
            .map(result => [result.panelId, panelPayloads.get(result.panelId).promptMode])
        );
      }

      if (totalSuccessful > 0) {
        getSharingController().rememberSnapshotPrompt(text);
      }

      // Clear input and save history
      if (totalSuccessful > 0) {
        document.getElementById('unified-input').value = '';
        getComposerController().resizeTextarea();

        // Clear images after successful fill/send
        if (getAttachmentsController().uploadedImages.length > 0) {
          getAttachmentsController().clearAllImages();
        }
      }
      return {
        ok: totalSuccessful > 0,
        sent: shouldAutoSubmit ? totalSuccessful : 0,
        total: totalCount,
        reason: totalSuccessful > 0 ? '' : 'send-failed'
      };
    } catch (error) {
      console.error('Error in broadcastMessage:', error);
      statusEl.textContent = 'Error occurred';
      statusEl.className = 'send-status error';
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'send-status';
      }, 3000);
      return { ok: false, reason: 'send-error', sent: 0, total: getPanelsController().panels.length };
    } finally {
      // Always re-enable buttons and release broadcast gate
      sendBtn.disabled = false;
      fillBtn.disabled = false;
      broadcastGate.release();
    }
  }

  async function sendToPanel(
    panel,
    text,
    images = [],
    autoSubmit = true,
    requestId = null,
    isRetry = false,
    timeoutMs = 8000,
    options = {}
  ) {
    if (!panel.iframe || !panel.iframe.contentWindow) {
      return {
        ok: false,
        panelId: panel.id,
        provider: panel.providerId,
        reason: 'control-not-found',
        succeededImageIds: []
      };
    }

    const isFillAction = options.isFillAction === true;
    const waitForActionResult = options.waitForActionResult === true;
    const expectedImageIds = images.map(img => img.id).filter(Boolean);

    const waiter = waitForActionResult
      ? createPanelActionResultWaiter({
        target: window,
        panel,
        requestId,
        expectedImageIds,
        action: 'fill',
        timeoutMs
      })
      : null;

    try {
      const messageType = determinePanelMessageType({ isFillAction });

      const imagesPayload = images.map(img => ({
        id: img.id,
        dataUrl: img.dataUrl,
        name: img.name,
        type: img.type
      }));

      panel.iframe.contentWindow.postMessage({
        type: messageType,
        text,
        images: imagesPayload,
        autoSubmit,
        requestId,
        action: waitForActionResult ? 'fill' : undefined,
        retry: waitForActionResult ? isRetry : undefined,
        providerMode: getProviderControlsController().getPanelProviderMode(panel),
        context: 'multi-panel'
      }, '*');

      if (waiter) {
        return await waiter.promise;
      }

      return {
        ok: true,
        panelId: panel.id,
        provider: panel.providerId,
        succeededImageIds: expectedImageIds
      };
    } catch (error) {
      console.error(`Error sending to ${panel.providerId}:`, error);
      waiter?.cancel('injection-error');
      return waiter
        ? await waiter.promise
        : {
          ok: false,
          panelId: panel.id,
          provider: panel.providerId,
          reason: 'injection-error',
          succeededImageIds: []
        };
    }
  }

  // Clear all input boxes (unified input + all panels)
  async function clearAllInputs() {
    // Clear unified input
    document.getElementById('unified-input').value = '';
    getComposerController().resizeTextarea();

    // Clear uploaded images
    getAttachmentsController().clearAllImages();

    // Send clear message to all panels
    getPanelsController().panels.forEach(panel => {
      if (panel.iframe && panel.iframe.contentWindow) {
        panel.iframe.contentWindow.postMessage({
          type: 'CLEAR_INPUT',
          clearImages: true,
          providerMode: getProviderControlsController().getPanelProviderMode(panel),
          context: 'multi-panel'
        }, '*');
      }
    });
    showToast('All inputs cleared');
  }

  // Send and Fill look unavailable while new chats start or AIs are still
  // loading, but stay enabled so a click or Enter reaches broadcastMessage and
  // explains why nothing was sent.
  function updateSendHold() {
    const isPreparing = isSendHeldByReadiness(summarizePanelReadiness(getPanelsController().panels));
    const inputBar = document.getElementById('input-bar');
    inputBar?.toggleAttribute('data-new-chat-busy', getConversationsController().isNewChatBusy);
    inputBar?.toggleAttribute('data-ai-preparing', isPreparing);
    ['send-all-btn', 'fill-input-btn'].forEach(id => {
      const button = document.getElementById(id);
      if (!button) return;
      if (getConversationsController().isNewChatBusy || isPreparing) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    });
  }

  // A panel holds Send until its page shows a question box, or until
  // PANEL_READY_TIMEOUT_MS passes (e.g. the provider is signed out).
  function startPanelReadiness(panel) {
    isReadyStatusDismissed = false;
    setPanelReadyState(panel, PANEL_READY_STATE.PENDING);
    panel.readyTimerId = setTimeout(() => {
      if (panel.readyState === PANEL_READY_STATE.PENDING) {
        setPanelReadyState(panel, PANEL_READY_STATE.TIMEOUT);
      }
    }, PANEL_READY_TIMEOUT_MS);
  }

  function setPanelReadyState(panel, state) {
    clearTimeout(panel.readyTimerId);
    panel.readyTimerId = null;
    panel.readyState = state;
    renderReadinessStatus();
    getPanelsController().renderPanelActivity();
    sendCatchUp(panel, state);
  }

  function sendCatchUp(panel, state) {
    const pending = catchUpSends.get(panel.id);
    if (!pending || state === PANEL_READY_STATE.PENDING) return;
    catchUpSends.delete(panel.id);
    if (state !== PANEL_READY_STATE.READY || pending.providerId !== panel.providerId) return;
    sendToPanel(panel, pending.text, [], pending.autoSubmit, null, false, 8000, {
      isFillAction: pending.isFillAction,
      waitForActionResult: pending.waitForActionResult
    }).catch(error => console.warn('[Multi-Panel] Catch-up send failed:', error));
  }

  function getReadinessNames(list) {
    // Blind mode never names the AIs.
    return getPresentationController().isBlindModeEnabled ? '' : list.map(panel => getPresentationController().getPanelDisplayName(panel)).join(', ');
  }

  function renderReadinessStatus() {
    updateSendHold();
    const row = document.getElementById('ai-ready-status-row');
    const status = document.getElementById('ai-ready-status');
    if (!row || !status) return;
    const summary = summarizePanelReadiness(getPanelsController().panels);
    const counts = [String(summary.ready.length), String(summary.total)];
    clearTimeout(readyStatusHideTimerId);
    if (summary.pending.length) {
      wasPreparingPanels = true;
      const names = getReadinessNames(summary.pending);
      status.textContent = [
        isSendHeldByReadiness(summary)
          ? getLocalizedText('composerPreparingHold', 'Preparing AIs: $1/$2 ready. Sending is paused; keep typing.', counts)
          : getLocalizedText('composerPreparingCanSend', '$1/$2 AIs ready. You can send; the rest get the question once they are ready.', counts),
        names && getLocalizedText('composerWaitingFor', 'Waiting for $1.', [names])
      ].filter(Boolean).join(' ');
      row.hidden = isReadyStatusDismissed;
      return;
    }
    if (summary.notReady.length) {
      wasPreparingPanels = false;
      const names = getReadinessNames(summary.notReady);
      status.textContent = [
        getLocalizedText('composerNotReady', '$1/$2 AIs ready. Sending is back on; check sign-in or reload the others.', counts),
        names && getLocalizedText('composerNotReadyNames', 'Not ready: $1.', [names])
      ].filter(Boolean).join(' ');
      row.hidden = isReadyStatusDismissed;
      return;
    }
    if (wasPreparingPanels && summary.total > 0) {
      wasPreparingPanels = false;
      status.textContent = getLocalizedText('composerAllReady', 'All $1 AIs are ready.', [String(summary.total)]);
      row.hidden = isReadyStatusDismissed;
      readyStatusHideTimerId = setTimeout(() => { row.hidden = true; }, NEW_CHAT_STATUS_AUTO_HIDE_MS);
      return;
    }
    row.hidden = true;
  }

  // Trigger send buttons only (no text injection) - used after Fill
  async function triggerSendButtons() {
    const sendBtn = document.getElementById('send-all-btn');
    const fillBtn = document.getElementById('fill-input-btn');
    const statusEl = document.getElementById('send-status');
    const sendFocusRequestId = getFocusController().restoreUnifiedInputFocusAfterSend(getFocusController().getChatgptPanelsWithFrames());

    try {
      sendBtn.disabled = true;
      fillBtn.disabled = true;
      statusEl.textContent = 'Sending...';
      statusEl.className = 'send-status';

      // Send TRIGGER_SEND message to all panels
      const sentAt = Date.now();
      const sentPanels = [];
      getPanelsController().panels.forEach(panel => {
        if (panel.iframe && panel.iframe.contentWindow) {
          panel.iframe.contentWindow.postMessage({
            type: 'TRIGGER_SEND',
            requestId: sendFocusRequestId,
            providerMode: getProviderControlsController().getPanelProviderMode(panel),
            context: 'multi-panel'
          }, '*');
          sentPanels.push(panel);
        }
      });
      getAnswersController().startAnswerRound(
        sendFocusRequestId,
        pendingFilledPromptText,
        sentAt,
        sentPanels.map(panel => ({
          id: panel.id,
          providerId: panel.providerId,
          promptMode: pendingFilledPanelPromptModes.get(panel.id) ?? normalizePanelPromptMode(panel.promptMode)
        }))
      );
      pendingFilledPromptText = '';
      pendingFilledPanelPromptModes = new Map();

      // Update status
      statusEl.textContent = `Sent to ${getPanelsController().panels.length} AIs`;
      statusEl.className = 'send-status success';

      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'send-status';
      }, 3000);
      return { ok: sentPanels.length > 0, sent: sentPanels.length, total: getPanelsController().panels.length };
    } catch (error) {
      console.error('Error in triggerSendButtons:', error);
      statusEl.textContent = 'Error occurred';
      statusEl.className = 'send-status error';
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'send-status';
      }, 3000);
      return { ok: false, reason: 'send-error', sent: 0, total: getPanelsController().panels.length };
    } finally {
      // Always re-enable buttons
      sendBtn.disabled = false;
      fillBtn.disabled = false;
    }
  }

  return {
    get NEW_CHAT_STATUS_AUTO_HIDE_MS() { return NEW_CHAT_STATUS_AUTO_HIDE_MS; },
    get broadcastGate() { return broadcastGate; },
    broadcastMessage,
    get catchUpSends() { return catchUpSends; },
    clearAllInputs,
    get isReadyStatusDismissed() { return isReadyStatusDismissed; },
    set isReadyStatusDismissed(value) { isReadyStatusDismissed = value; },
    get readyStatusHideTimerId() { return readyStatusHideTimerId; },
    renderReadinessStatus,
    resetFillRetryState,
    sendToPanel,
    setPanelReadyState,
    startPanelReadiness,
    updateSendHold,
  };
}
