/**
 * Prompt modes: a short instruction appended to the question the AIs receive.
 *
 * The user's own text stays untouched everywhere else (answer stats, shared
 * snapshots, the draft and the filled-prompt record), and the AI's memory of
 * the conversation is unchanged because only the outgoing message carries it.
 */

// Menu order, with each mode's locale keys and English fallbacks for the
// composer's option label and tooltip hint.
export const PROMPT_MODES = [
  { id: 'learning', labelKey: 'promptModeLearning', label: 'Learning',
    hintKey: 'promptModeLearningHint', hint: 'Append a teaching instruction: conclusion first, then the reasoning' },
  { id: 'concise', labelKey: 'promptModeConcise', label: 'Concise',
    hintKey: 'promptModeConciseHint', hint: 'Append a concise instruction: conclusion and key points only' },
  { id: 'brainstorm', labelKey: 'promptModeBrainstorm', label: 'Brainstorm',
    hintKey: 'promptModeBrainstormHint', hint: 'Append a brainstorm instruction: many varied angles, no early verdict' },
  { id: 'compete', labelKey: 'promptModeCompete', label: 'Competitive',
    hintKey: 'promptModeCompeteHint', hint: 'Append a competitive instruction: aim to win the side-by-side comparison' }
];

export const PROMPT_MODE_IDS = PROMPT_MODES.map(mode => mode.id);

// English fallbacks keep the composer working when a locale has not been
// updated yet or chrome.i18n is unavailable; the shipped copies live in
// _locales/*/messages.json as promptModeSuffix_<mode>.
const PROMPT_MODE_SUFFIX_FALLBACKS = {
  learning: 'Answer as a teacher: give the core conclusion first, then explain the reasoning step by step with examples, and finish with 1–2 questions that check my understanding.',
  concise: 'Be as concise as possible: give the conclusion and the key points only, and skip preamble, pleasantries and repetition.',
  brainstorm: 'Brainstorm: offer several different angles, as varied and even as bold as you can, briefly note the pros and cons of each, and do not rush to a verdict.',
  compete: 'You are answering this alongside several other AIs and the answers will be compared side by side. Give the most accurate, insightful and useful answer you can.'
};

/** @param {string} mode */
export function isPromptMode(mode) {
  return PROMPT_MODE_IDS.includes(mode);
}

/** @param {string} mode */
export function getPromptMode(mode) {
  return PROMPT_MODES.find(candidate => candidate.id === mode) || null;
}

/**
 * The instruction for `mode`, or '' for the default or an unknown mode.
 *
 * @param {string | null | undefined} mode
 * @param {(key: string, fallback?: string) => string} [tr] - Translation helper.
 * @returns {string}
 */
export function getPromptModeSuffix(mode, tr = null) {
  if (!isPromptMode(mode)) return '';
  const fallback = PROMPT_MODE_SUFFIX_FALLBACKS[mode];
  return tr?.(`promptModeSuffix_${mode}`, fallback) || fallback;
}

/**
 * Appends the instruction for `mode` after a blank line. The default mode
 * (`null`), an unknown mode, and empty or whitespace-only text return the
 * input unchanged, so a blank send never becomes the instruction alone; a send
 * of files without text uses getPromptModeSuffix instead.
 *
 * @param {string} text - The question as the user typed it.
 * @param {string | null | undefined} mode - One of PROMPT_MODE_IDS or null.
 * @param {(key: string, fallback?: string) => string} [tr] - Translation helper.
 * @returns {string}
 */
export function applyPromptMode(text, mode, tr = null) {
  if (typeof text !== 'string' || !text.trim() || !isPromptMode(mode)) return text;
  return `${text}\n\n${getPromptModeSuffix(mode, tr)}`;
}
