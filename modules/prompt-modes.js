/**
 * Prompt modes: a short instruction appended to the question the AIs receive.
 *
 * Modes are Prompt Library prompts marked `isMode`; the composer menu lists
 * only those, keyed by their `modeKey`. The built-in modes below are added to
 * the library once and are then ordinary prompts the user can edit or delete.
 *
 * The user's own text stays untouched everywhere else (answer stats, shared
 * snapshots, the draft and the filled-prompt record), and the AI's memory of
 * the conversation is unchanged because only the outgoing message carries it.
 */

// Seed order, with each built-in mode's locale keys and English fallbacks.
// `id` becomes the seeded prompt's modeKey, which also matches the
// selectedPromptMode values saved before modes moved into the library.
export const PROMPT_MODES = [
  { id: 'learning', labelKey: 'promptModeLearning', label: 'Learning',
    hintKey: 'promptModeLearningHint', hint: 'Append a teaching instruction: conclusion first, then the reasoning',
    triggers: ['/study', '/learn'] },
  { id: 'concise', labelKey: 'promptModeConcise', label: 'Concise',
    hintKey: 'promptModeConciseHint', hint: 'Append a concise instruction: conclusion and key points only',
    triggers: ['/brief', '/concise'] },
  { id: 'brainstorm', labelKey: 'promptModeBrainstorm', label: 'Brainstorm',
    hintKey: 'promptModeBrainstormHint', hint: 'Append a brainstorm instruction: many varied angles, no early verdict',
    triggers: ['/brainstorm', '/idea'] },
  { id: 'compete', labelKey: 'promptModeCompete', label: 'Challenge',
    hintKey: 'promptModeCompeteHint', hint: 'Append a challenge instruction: aim to win the side-by-side comparison',
    triggers: ['/challenge', '/compete'] }
];

// The composer's Auto choice: no mode by default, but a mode prompt's trigger
// word typed in the question (say /study) applies that mode to this send only.
export const AUTO_PROMPT_MODE = 'auto';

export const PROMPT_MODE_IDS = PROMPT_MODES.map(mode => mode.id);

// chrome.storage.local, not sync: the library lives in this device's IndexedDB.
export const PROMPT_MODES_SEEDED_KEY = 'promptModesSeeded';
// Built-in modes seeded before trigger words existed get their defaults once.
export const PROMPT_MODE_TRIGGERS_SEEDED_KEY = 'promptModeTriggersSeeded';

export const MAX_PROMPT_TRIGGERS = 10;
export const MAX_PROMPT_TRIGGER_LENGTH = 32;

// English fallbacks keep seeding working when a locale has not been updated
// yet or chrome.i18n is unavailable; the shipped copies live in
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
 * The built-in instruction for `mode`, or '' for the default or an unknown mode.
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
 * Appends `instruction` after a blank line. A missing instruction (Default)
 * and empty or whitespace-only text return the input unchanged, so a blank
 * send never becomes the instruction alone; a send of files without text uses
 * the instruction on its own instead.
 *
 * @param {string} text - The question as the user typed it.
 * @param {string | null | undefined} instruction - The mode prompt's content.
 * @returns {string}
 */
export function applyPromptMode(text, instruction) {
  if (typeof text !== 'string' || !text.trim()) return text;
  if (typeof instruction !== 'string' || !instruction.trim()) return text;
  return `${text}\n\n${instruction}`;
}

/**
 * Trigger words as stored: lowercase, each starting with "/" so ordinary
 * words never trigger a mode, without duplicates. Accepts an array or the
 * editor's text, separated by commas or spaces.
 *
 * @param {string | string[] | null | undefined} value
 * @returns {string[]}
 */
export function normalizePromptTriggers(value) {
  const parts = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[\s,，、;；]+/) : []);
  const triggers = [];
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    const word = part.trim().toLowerCase().replace(/^\/+/, '');
    if (!word || /\s/.test(word)) continue;
    const trigger = `/${word}`.slice(0, MAX_PROMPT_TRIGGER_LENGTH);
    if (!triggers.includes(trigger)) triggers.push(trigger);
    if (triggers.length >= MAX_PROMPT_TRIGGERS) break;
  }
  return triggers;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the mode prompts whose trigger words appear in `text` as whole words
 * and removes those words from it. Matching ignores case. Each matched mode
 * counts once, in menu order.
 *
 * @param {string} text - The question as the user typed it.
 * @param {Array<object>} modePrompts - Prompts from selectModePrompts.
 * @returns {{ text: string, prompts: Array<object> }}
 */
export function detectPromptModeTriggers(text, modePrompts) {
  if (typeof text !== 'string' || !text) return { text, prompts: [] };
  let remaining = text;
  const prompts = [];
  for (const prompt of Array.isArray(modePrompts) ? modePrompts : []) {
    let matched = false;
    for (const trigger of normalizePromptTriggers(prompt?.triggers)) {
      const pattern = new RegExp(`(^|\\s)${escapeRegExp(trigger)}(?=\\s|$)`, 'giu');
      const next = remaining.replace(pattern, '$1');
      if (next !== remaining) {
        matched = true;
        remaining = next;
      }
    }
    if (matched) prompts.push(prompt);
  }
  if (!prompts.length) return { text, prompts };
  // Only the edges are trimmed; the rest of the question keeps its spacing.
  return { text: remaining.trim(), prompts };
}

/**
 * The text and instruction one send uses. Auto mode looks for trigger words
 * and appends the matched modes' instructions; any other mode passes `text`
 * through with `instruction`.
 *
 * @param {string} text
 * @param {{ auto?: boolean, instruction?: string | null, modePrompts?: Array<object> }} options
 * @returns {{ text: string, instruction: string | null, prompts: Array<object> }}
 */
export function resolvePromptModeForText(text, { auto = false, instruction = null, modePrompts = [] } = {}) {
  if (!auto) return { text, instruction: instruction || null, prompts: [] };
  const detected = detectPromptModeTriggers(text, modePrompts);
  const combined = detected.prompts.map(prompt => prompt.content.trim()).filter(Boolean).join('\n\n');
  return { text: detected.text, instruction: combined || null, prompts: detected.prompts };
}

/** A modeKey for a prompt the user marks as a mode. */
export function createModeKey() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Library prompts marked as modes, in menu order (oldest first).
 *
 * @param {Array<object>} prompts
 * @returns {Array<object>}
 */
export function selectModePrompts(prompts) {
  return (Array.isArray(prompts) ? prompts : [])
    .filter(prompt => prompt?.isMode === true && prompt.modeKey && typeof prompt.content === 'string' && prompt.content.trim())
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id || 0) - (b.id || 0));
}

/**
 * The built-in modes as Prompt Library records.
 *
 * @param {(key: string, fallback?: string) => string} [tr]
 */
export function getDefaultModePrompts(tr = null) {
  const text = (key, fallback) => tr?.(key, fallback) || fallback;
  const category = text('promptModeCategory', 'Modes');
  const now = Date.now();
  return PROMPT_MODES.map((mode, index) => ({
    title: text(mode.labelKey, mode.label),
    content: getPromptModeSuffix(mode.id, tr),
    category,
    tags: [],
    isMode: true,
    modeKey: mode.id,
    triggers: [...mode.triggers],
    createdAt: now + index
  }));
}

/**
 * Adds the built-in modes to the library once per device. Modes the user
 * deleted stay deleted, and a library that already holds a built-in (from an
 * import, say) does not get a second copy.
 *
 * @param {{ getAllPrompts: () => Promise<object[]>, savePrompt: (data: object) => Promise<unknown>,
 *   storage?: { get: Function, set: Function }, tr?: Function }} options
 * @returns {Promise<boolean>} Whether this call seeded the library.
 */
export async function ensureDefaultModePrompts({ getAllPrompts, savePrompt, storage, tr = null }) {
  if (!storage?.get || !storage?.set) return false;
  const stored = await storage.get(PROMPT_MODES_SEEDED_KEY);
  if (stored?.[PROMPT_MODES_SEEDED_KEY]) return false;
  const existing = new Set((await getAllPrompts()).map(prompt => prompt.modeKey).filter(Boolean));
  for (const prompt of getDefaultModePrompts(tr)) {
    if (!existing.has(prompt.modeKey)) await savePrompt(prompt);
  }
  await storage.set({ [PROMPT_MODES_SEEDED_KEY]: true });
  return true;
}

/**
 * Gives built-in modes seeded before trigger words existed their default
 * triggers, once per device. Prompts whose triggers the user already set,
 * even to none, keep them.
 *
 * @param {{ getAllPrompts: () => Promise<object[]>, updatePrompt: (id: number, updates: object) => Promise<unknown>,
 *   storage?: { get: Function, set: Function } }} options
 * @returns {Promise<boolean>} Whether this call ran the update.
 */
export async function ensureDefaultModeTriggers({ getAllPrompts, updatePrompt, storage }) {
  if (!storage?.get || !storage?.set) return false;
  const stored = await storage.get(PROMPT_MODE_TRIGGERS_SEEDED_KEY);
  if (stored?.[PROMPT_MODE_TRIGGERS_SEEDED_KEY]) return false;
  for (const prompt of await getAllPrompts()) {
    const mode = getPromptMode(prompt?.modeKey);
    if (mode && prompt.triggers === undefined) await updatePrompt(prompt.id, { triggers: [...mode.triggers] });
  }
  await storage.set({ [PROMPT_MODE_TRIGGERS_SEEDED_KEY]: true });
  return true;
}
