// Entry point: all runtime, provider and feature factories must load first.
(function(runtime) {
  'use strict';
  if (runtime.started) return;

  const {
    createConfigController,
    createSecurityController,
    createGoogleController,
    createReadinessController,
    createDomController,
    createReportingController,
    createFocusController,
    createChatgptController,
    createAnswersController,
    createComposerController,
    createUploadsController,
    createSendingController,
    createNewChatController,
    createDoubaoController,
    createYuanbaoController,
    createMimoController,
    createGrokController,
    createDeepseekController,
    createKimiController,
    createClaudeController,
    createGeminiController,
    createQwenController,
    createChatglmController,
    createZaiGlobalController,
    createMessagesController,
    createSnapshotGeometryController,
    createSnapshotStylesController,
    createSnapshotSessionController,
    createProtocolController
  } = runtime.factories;

  const config = createConfigController();

  const security = createSecurityController();

  const google = createGoogleController({
    getComposerController: () => composer,
    getConfigController: () => config,
    getDomController: () => dom,
    getProtocolController: () => protocol,
    getUploadsController: () => uploads
  });

  const readiness = createReadinessController({
    getComposerController: () => composer,
    getConfigController: () => config,
    getDomController: () => dom,
    getProtocolController: () => protocol,
    getReportingController: () => reporting
  });

  const dom = createDomController();

  const reporting = createReportingController({
    getConfigController: () => config,
    getProtocolController: () => protocol,
    getSnapshotSessionController: () => snapshotSession
  });

  const focus = createFocusController({
    getChatgptController: () => chatgpt,
    getConfigController: () => config,
    getProtocolController: () => protocol,
    getReportingController: () => reporting
  });

  const chatgpt = createChatgptController({
    getConfigController: () => config,
    getProtocolController: () => protocol,
    getReportingController: () => reporting,
    getUploadsController: () => uploads
  });

  const answers = createAnswersController({
    getConfigController: () => config,
    getProtocolController: () => protocol,
    getSecurityController: () => security
  });

  const composer = createComposerController({
    getChatgptController: () => chatgpt,
    getConfigController: () => config,
    getDomController: () => dom,
    getGoogleController: () => google,
    getNewChatController: () => newChat,
    getSendingController: () => sending
  });

  const uploads = createUploadsController({
    getAnswersController: () => answers,
    getChatglmController: () => chatglm,
    getChatgptController: () => chatgpt,
    getClaudeController: () => claude,
    getComposerController: () => composer,
    getConfigController: () => config,
    getDeepseekController: () => deepseek,
    getDomController: () => dom,
    getDoubaoController: () => doubao,
    getFocusController: () => focus,
    getGeminiController: () => gemini,
    getGoogleController: () => google,
    getGrokController: () => grok,
    getKimiController: () => kimi,
    getMimoController: () => mimo,
    getProtocolController: () => protocol,
    getQwenController: () => qwen,
    getSendingController: () => sending,
    getYuanbaoController: () => yuanbao,
    getZaiGlobalController: () => zaiGlobal
  });

  const sending = createSendingController({
    getChatgptController: () => chatgpt,
    getComposerController: () => composer,
    getConfigController: () => config,
    getDomController: () => dom,
    getGoogleController: () => google
  });

  const newChat = createNewChatController({
    getChatgptController: () => chatgpt,
    getComposerController: () => composer,
    getConfigController: () => config,
    getDeepseekController: () => deepseek,
    getDomController: () => dom,
    getDoubaoController: () => doubao,
    getGoogleController: () => google,
    getGrokController: () => grok,
    getKimiController: () => kimi,
    getMimoController: () => mimo,
    getProtocolController: () => protocol,
    getReportingController: () => reporting,
    getSecurityController: () => security,
    getYuanbaoController: () => yuanbao
  });

  const doubao = createDoubaoController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const yuanbao = createYuanbaoController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const mimo = createMimoController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const grok = createGrokController({
    getConfigController: () => config,
    getUploadsController: () => uploads
  });

  const deepseek = createDeepseekController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const kimi = createKimiController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const claude = createClaudeController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const gemini = createGeminiController({
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const qwen = createQwenController({
    getConfigController: () => config,
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const chatglm = createChatglmController({
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const zaiGlobal = createZaiGlobalController({
    getDomController: () => dom,
    getUploadsController: () => uploads
  });

  const messages = createMessagesController({
    getAnswersController: () => answers,
    getChatgptController: () => chatgpt,
    getComposerController: () => composer,
    getConfigController: () => config,
    getFocusController: () => focus,
    getGoogleController: () => google,
    getNewChatController: () => newChat,
    getProtocolController: () => protocol,
    getReportingController: () => reporting,
    getSecurityController: () => security,
    getSendingController: () => sending,
    getSnapshotSessionController: () => snapshotSession,
    getUploadsController: () => uploads
  });

  const snapshotGeometry = createSnapshotGeometryController({
    getConfigController: () => config,
    getSnapshotStylesController: () => snapshotStyles
  });

  const snapshotStyles = createSnapshotStylesController({
    getComposerController: () => composer,
    getConfigController: () => config,
    getGoogleController: () => google,
    getProtocolController: () => protocol,
    getSnapshotGeometryController: () => snapshotGeometry
  });

  const snapshotSession = createSnapshotSessionController({
    getConfigController: () => config,
    getProtocolController: () => protocol,
    getSnapshotGeometryController: () => snapshotGeometry,
    getSnapshotStylesController: () => snapshotStyles
  });

  const protocol = createProtocolController();

  // Listen for messages from the multi-panel host
  runtime.started = true;
  reporting.setupProviderLocationReporting();

  reporting.setupPageWidthReporting();

  readiness.setupComposerReadyReporting();

  answers.setupAnswerEngagementReporting();

  window.addEventListener('message', messages.handleTextInjection);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', newChat.recoverPendingNewChatRequests, { once: true });
  } else {
    newChat.recoverPendingNewChatRequests();
  }

})(globalThis.PanelizeContent);
