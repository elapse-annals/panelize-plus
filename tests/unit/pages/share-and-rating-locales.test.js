import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPETE_PROMPT_TEXTS, DEEP_PROMPT_TEXTS } from '../../../modules/prompts/prompt-modes.js';

const LOCALES_DIR = resolve(process.cwd(), '_locales');

// Strings added for the store rating prompt, the share snapshot, panel focus,
// the panel resize handles, the answer stats, blind mode, wide content, the
// reasoning level mapping, answer complete notifications, prompt modes and
// the AI summary.
const FEATURE_KEYS = [
  'ratingPromptMessage',
  'ratingPromptRate',
  'ratingPromptLater',
  'ratingPromptNever',
  'shareButtonText',
  'shareButtonTitle',
  'shareDialogTitle',
  'shareDialogClose',
  'sharePrivacyWarning',
  'shareCopyButton',
  'shareDownloadButton',
  'shareCopied',
  'shareCopyFailed',
  'shareCaptureCancelled',
  'shareCaptureWrongSurface',
  'shareCaptureFailed',
  'shareCaptureLayoutChanged',
  'shareModeLabel',
  'shareModeCurrent',
  'shareModeFull',
  'shareTitleLabel',
  'shareTitlePlaceholder',
  'shareSnapshotTagline',
  'shareSnapshotPromptLabel',
  'shareSnapshotCaption',
  'shareSnapshotSubline',
  'shareTruncatedNote',
  'shareInterruptedNote',
  'shareCaptureTabHidden',
  'shareCurrentViewOnly',
  'shareOutOfViewNote',
  'shareShortcutHint',
  'shareToolbarHint',
  'shareProgressPreparing',
  'shareProgressStep',
  'shareProgressHoldPointer',
  'shareProgressCancel',
  'shareStreamStatus',
  'shareStreamStop',
  'labelShareWatermark',
  'descShareWatermark',
  'msgShareWatermarkEnabled',
  'msgShareWatermarkDisabled',
  'focusPanelTitle',
  'exitFocusPanelTitle',
  'panelResizeHandle',
  'adoptAnswerTitle',
  'adoptedAnswerTitle',
  'rejectAnswerTitle',
  'rejectedAnswerTitle',
  'answerStatsButtonTitle',
  'answerStatsTitle',
  'answerStatsEmpty',
  'answerStatsColumnProvider',
  'answerStatsColumnRounds',
  'answerStatsColumnFirstOutput',
  'answerStatsColumnComplete',
  'answerStatsColumnTimeouts',
  'answerStatsColumnAdopted',
  'answerStatsColumnAdoptionRate',
  'answerStatsNote',
  'answerStatsRecentTitle',
  'answerStatsClear',
  'answerStatsClearConfirm',
  'answerStatsExport',
  'answerStatsNotMeasured',
  'answerStatsNoPrompt',
  'answerStatsCategoryLabel',
  'answerStatsCategoryAll',
  'taskCategoryCoding',
  'taskCategoryWriting',
  'taskCategoryTranslation',
  'taskCategoryQa',
  'taskCategoryOther',
  'answerStatsBestByCategory',
  'answerStatsBestEmpty',
  'answerStatsBestCategorySummary',
  'answerStatsAdopted',
  'answerStatsRejected',
  'answerStatsStatus_pending',
  'answerStatsStatus_timeout',
  'answerStatsStatus_cancelled',
  'answerStatsColumnEngaged',
  'answerStatsColumnScore',
  'blindModeTitle',
  'blindModeOn',
  'blindModeOff',
  'blindModeStatsHidden',
  'blindPanelLabel',
  'wideContentTitle',
  'composerWideContent',
  'sectionTierRecipes',
  'labelTierRecipes',
  'descTierRecipes',
  'btnResetTierRecipes',
  'labelTierProvider',
  'labelTierModel',
  'labelTierThinking',
  'toastTierRecipesSaved',
  'toastTierRecipesReset',
  'answerStatsScoreNote',
  'answerLogButtonTitle',
  'answerLogTitle',
  'answerLogSearchPlaceholder',
  'answerLogAllProviders',
  'answerLogAllFeedback',
  'answerLogFeedbackAdopted',
  'answerLogFeedbackRejected',
  'answerLogFeedbackNone',
  'answerLogNoMatches',
  'answerStatsHowCalculated',
  'notificationAnswerCompleteTitle',
  'labelAnswerCompleteNotification',
  'descAnswerCompleteNotification',
  'msgAnswerCompleteNotificationEnabled',
  'msgAnswerCompleteNotificationDisabled',
  'composerPromptModeLabel',
  'promptModeDefault',
  'promptModeLearning',
  'promptModeConcise',
  'promptModeBrainstorm',
  'promptModeCompete',
  'promptModeDeep',
  'promptModeDefaultHint',
  'promptModeLearningHint',
  'promptModeConciseHint',
  'promptModeBrainstormHint',
  'promptModeCompeteHint',
  'promptModeDeepHint',
  'promptModeSuffix_learning',
  'promptModeSuffix_concise',
  'promptModeSuffix_brainstorm',
  'promptModeSuffix_compete',
  'promptModeSuffix_deep',
  'promptModeCategory',
  'promptModeBadge',
  'promptIsModeLabel',
  'composerPlaceholderAppend',
  'promptModeAuto',
  'promptModeAutoHint',
  'composerPlaceholderTriggers',
  'promptTriggersLabel',
  'promptTriggersPlaceholder',
  'promptTriggersHint',
  'aiSummaryButtonTitle',
  'aiSummaryTitle',
  'aiSummaryCopy',
  'aiSummaryRerun',
  'aiSummaryCached',
  'questionHistoryLabel',
  'aiSummaryOpenSettings',
  'aiSummaryDisagreements',
  'aiSummaryCollecting',
  'aiSummaryRunning',
  'aiSummaryIdle',
  'aiSummaryNoRound',
  'aiSummaryNoAnswers',
  'aiSummaryEmpty',
  'aiSummaryNotConfigured',
  'aiSummaryNoPermission',
  'aiSummaryFailed',
  'aiSummaryBusy',
  'aiSummaryMissing',
  'aiSummaryJumpToPanel',
  'aiSummaryCopied',
  'sectionAiSummary',
  'descAiSummary',
  'labelAiSummaryProfiles',
  'descAiSummaryProfiles',
  'labelAiSummaryProfileName',
  'labelAiSummaryProfileBaseUrl',
  'labelAiSummaryProfileApiKey',
  'labelAiSummaryProfileModel',
  'labelAiSummaryProfileActive',
  'labelAiSummaryProfileRemove',
  'btnAiSummaryAddProfile',
  'msgAiSummaryProfileIncomplete',
  'msgAiSummaryProfileLimit',
  'msgAiSummaryProfileTesting',
  'msgAiSummaryProfileApiKeyMissing',
  'aiSummaryProfileSelect',
  'aiSummaryProfileUnconfigured',
  'labelAiSummaryBaseUrl',
  'descAiSummaryBaseUrl',
  'labelAiSummaryApiKey',
  'descAiSummaryApiKey',
  'labelAiSummaryModel',
  'descAiSummaryModel',
  'labelAiSummaryAuto',
  'descAiSummaryAuto',
  'labelAiSummarySave',
  'descAiSummarySave',
  'btnAiSummarySave',
  'msgAiSummaryAutoEnabled',
  'msgAiSummaryAutoDisabled',
  'msgAiSummaryIncomplete',
  'msgAiSummaryPermissionDenied',
  'msgAiSummaryTesting',
  'msgAiSummaryTestOk',
  'msgAiSummaryTestFailed',
  'labelAboutAuthor',
  'labelAboutForkedFrom',
  'labelGitHubRepo',
  'panelPromptModeInherit',
  'panelCloneTitle',
  'addPanelNoProviders'
];

const locales = readdirSync(LOCALES_DIR);

describe('share and rating strings', () => {
  it('ships only English and Simplified Chinese', () => {
    expect(locales.sort()).toEqual(['en', 'zh_CN']);
  });

  it.each(locales)('%s translates every new string', (locale) => {
    const messages = JSON.parse(readFileSync(resolve(LOCALES_DIR, locale, 'messages.json'), 'utf8'));
    FEATURE_KEYS.forEach((key) => {
      expect(messages[key]?.message?.trim(), `${locale}.${key}`).toBeTruthy();
    });
    expect(messages.descDefaultPromptLibrary.message, `${locale}.descDefaultPromptLibrary`)
      .toContain(messages.promptModeDeep.message);
  });

  it('ships the critical-analysis deep-thinking instruction in both locales', () => {
    const en = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'en', 'messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'zh_CN', 'messages.json'), 'utf8'));

    expect(en.promptModeSuffix_deep.message).toBe(DEEP_PROMPT_TEXTS.current.en);
    expect(zh.promptModeSuffix_deep.message).toBe(DEEP_PROMPT_TEXTS.current.zh);
  });

  it('ships the adversarial Challenge instruction in both locales', () => {
    const en = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'en', 'messages.json'), 'utf8'));
    const zh = JSON.parse(readFileSync(resolve(LOCALES_DIR, 'zh_CN', 'messages.json'), 'utf8'));

    expect(en.promptModeSuffix_compete.message).toBe(COMPETE_PROMPT_TEXTS.current.en);
    expect(zh.promptModeSuffix_compete.message).toBe(COMPETE_PROMPT_TEXTS.current.zh);
  });

  it('keeps the brand and repository in the watermark strings', () => {
    locales.forEach((locale) => {
      const messages = JSON.parse(readFileSync(resolve(LOCALES_DIR, locale, 'messages.json'), 'utf8'));
      expect(messages.descShareWatermark.message, locale).toContain('Panelize Plus');
      expect(messages.descShareWatermark.message, locale).toContain('github.com/elapse-annals/panelize-plus');
      expect(messages.shareToolbarHint.message, locale).toContain('Panelize');
    });
  });

  it('asks for a GitHub star in both locales', () => {
    locales.forEach((locale) => {
      const messages = JSON.parse(readFileSync(resolve(LOCALES_DIR, locale, 'messages.json'), 'utf8'));
      expect(messages.ratingPromptMessage.message, locale).toContain('GitHub');
      expect(messages.ratingPromptMessage.message, locale).toContain('Panelize Plus');
    });
  });

  it('keeps every substitution in the snapshot strings', () => {
    const substitutions = {
      shareSnapshotSubline: ['$1'],
      shareTruncatedNote: ['$1'],
      shareInterruptedNote: ['$1'],
      shareCurrentViewOnly: ['$1'],
      shareOutOfViewNote: ['$1'],
      shareShortcutHint: ['$1'],
      shareProgressStep: ['$1', '$2'],
      composerPlaceholderAppend: ['$1'],
      aiSummaryRunning: ['$1'],
      aiSummaryFailed: ['$1'],
      aiSummaryBusy: ['$1'],
      aiSummaryMissing: ['$1'],
      answerStatsBestCategorySummary: ['$1', '$2', '$3', '$4'],
      msgAiSummaryTestFailed: ['$1'],
      msgAiSummaryProfileIncomplete: ['$1'],
      msgAiSummaryProfileLimit: ['$1'],
      msgAiSummaryProfileTesting: ['$1'],
      msgAiSummaryProfileApiKeyMissing: ['$1']
    };
    locales.forEach((locale) => {
      const messages = JSON.parse(readFileSync(resolve(LOCALES_DIR, locale, 'messages.json'), 'utf8'));
      Object.entries(substitutions).forEach(([key, values]) => {
        values.forEach((value) => expect(messages[key].message, `${locale}.${key}`).toContain(value));
      });
    });
  });
});
