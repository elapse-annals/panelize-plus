/** Composition root. Feature state and behavior live in controllers. */

import { createLayoutController } from './controllers/layout.js';
import { createApplicationController } from './controllers/application.js';
import { createFocusController } from './controllers/focus.js';
import { createPanelsController } from './controllers/panels.js';
import { createConversationsController } from './controllers/conversations.js';
import { createProviderControlsController } from './controllers/provider-controls.js';
import { createMessagingController } from './controllers/messaging.js';
import { createWindowModeController } from './controllers/window-mode.js';
import { createPresentationController } from './controllers/presentation.js';
import { createComposerController } from './controllers/composer.js';
import { createSendingController } from './controllers/sending.js';
import { createRatingController } from './controllers/rating.js';
import { createSharingController } from './controllers/sharing.js';
import { createAttachmentsController } from './controllers/attachments.js';
import { createAnswersController } from './controllers/answers.js';
import { createSummaryController } from './controllers/summary.js';
import { createPromptsController } from './controllers/prompts.js';
import { createQuestionHistoryController } from './controllers/question-history.js';
import { createProviderMenusController } from './controllers/provider-menus.js';

const layout = createLayoutController({
  getPanelsController: () => panels,
  getPresentationController: () => presentation
});

const application = createApplicationController({
  getAnswersController: () => answers,
  getComposerController: () => composer,
  getConversationsController: () => conversations,
  getFocusController: () => focus,
  getLayoutController: () => layout,
  getMessagingController: () => messaging,
  getPanelsController: () => panels,
  getPresentationController: () => presentation,
  getPromptsController: () => prompts,
  getProviderControlsController: () => providerControls,
  getQuestionHistoryController: () => questionHistory,
  getRatingController: () => rating,
  getSendingController: () => sending,
  getSharingController: () => sharing,
  getSummaryController: () => summary,
  getWindowModeController: () => windowMode
});

const focus = createFocusController({
  getPanelsController: () => panels
});

const panels = createPanelsController({
  getAnswersController: () => answers,
  getComposerController: () => composer,
  getConversationsController: () => conversations,
  getFocusController: () => focus,
  getLayoutController: () => layout,
  getPresentationController: () => presentation,
  getProviderControlsController: () => providerControls,
  getSendingController: () => sending
});

const conversations = createConversationsController({
  getAnswersController: () => answers,
  getComposerController: () => composer,
  getFocusController: () => focus,
  getPanelsController: () => panels,
  getProviderControlsController: () => providerControls,
  getSendingController: () => sending
});

const providerControls = createProviderControlsController({
  getAnswersController: () => answers,
  getConversationsController: () => conversations,
  getPanelsController: () => panels,
  getProviderMenusController: () => providerMenus,
  getSendingController: () => sending
});

const messaging = createMessagingController({
  getAnswersController: () => answers,
  getConversationsController: () => conversations,
  getFocusController: () => focus,
  getLayoutController: () => layout,
  getPanelsController: () => panels,
  getPresentationController: () => presentation,
  getPromptsController: () => prompts,
  getSendingController: () => sending,
  getSharingController: () => sharing,
  getSummaryController: () => summary
});

const windowMode = createWindowModeController({
  getAttachmentsController: () => attachments,
  getComposerController: () => composer,
  getLayoutController: () => layout,
  getPanelsController: () => panels,
  getProviderControlsController: () => providerControls
});

const presentation = createPresentationController({
  getAnswersController: () => answers,
  getComposerController: () => composer,
  getLayoutController: () => layout,
  getPanelsController: () => panels,
  getSendingController: () => sending,
  getSharingController: () => sharing,
  getSummaryController: () => summary
});

const composer = createComposerController({
  getAttachmentsController: () => attachments,
  getConversationsController: () => conversations,
  getFocusController: () => focus,
  getLayoutController: () => layout,
  getPanelsController: () => panels,
  getPresentationController: () => presentation,
  getPromptsController: () => prompts,
  getProviderMenusController: () => providerMenus,
  getQuestionHistoryController: () => questionHistory,
  getSendingController: () => sending,
  getSharingController: () => sharing,
  getWindowModeController: () => windowMode
});

const sending = createSendingController({
  getAnswersController: () => answers,
  getAttachmentsController: () => attachments,
  getComposerController: () => composer,
  getConversationsController: () => conversations,
  getFocusController: () => focus,
  getPanelsController: () => panels,
  getPresentationController: () => presentation,
  getPromptsController: () => prompts,
  getProviderControlsController: () => providerControls,
  getQuestionHistoryController: () => questionHistory,
  getRatingController: () => rating,
  getSharingController: () => sharing
});

const rating = createRatingController();

const sharing = createSharingController({
  getPanelsController: () => panels
});

const attachments = createAttachmentsController({
  getSendingController: () => sending
});

const answers = createAnswersController({
  getPanelsController: () => panels,
  getPresentationController: () => presentation,
  getQuestionHistoryController: () => questionHistory,
  getSharingController: () => sharing,
  getSummaryController: () => summary
});

const summary = createSummaryController({
  getAnswersController: () => answers,
  getLayoutController: () => layout,
  getPanelsController: () => panels,
  getPresentationController: () => presentation,
  getSharingController: () => sharing
});

const prompts = createPromptsController({
  getComposerController: () => composer,
  getSendingController: () => sending
});

const questionHistory = createQuestionHistoryController({
  getAttachmentsController: () => attachments,
  getPromptsController: () => prompts
});

const providerMenus = createProviderMenusController({
  getPanelsController: () => panels
});

// Keep the original async functions, signatures and defaults as public exports.
export const broadcastMessage = sending.broadcastMessage;
export const sendToPanel = sending.sendToPanel;

// Expose removeImage to window for onclick handler
window.removeImageById = (imageId) => {
  attachments.removeImage(imageId);
};

// Initialize on load
// Location and width reports can arrive before async UI/settings setup.
window.addEventListener('message', messaging.handleProviderStatusMessage);

panels.createPanelsFromStartupSnapshot();

application.init();
