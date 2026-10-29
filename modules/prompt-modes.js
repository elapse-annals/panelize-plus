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

// Menu and seed order (Concise, Learning, Challenge, Brainstorm, Deep thinking), with each
// built-in mode's locale keys and English fallbacks.
// `id` becomes the seeded prompt's modeKey, which also matches the
// selectedPromptMode values saved before modes moved into the library.
export const PROMPT_MODES = [
  { id: 'concise', labelKey: 'promptModeConcise', label: 'Concise',
    hintKey: 'promptModeConciseHint', hint: 'Append a concise instruction: conclusion and key points only',
    triggers: ['/brief', '/concise'] },
  { id: 'learning', labelKey: 'promptModeLearning', label: 'Learning',
    hintKey: 'promptModeLearningHint', hint: 'Append a teaching instruction: conclusion first, then the reasoning',
    triggers: ['/study', '/learn'] },
  { id: 'compete', labelKey: 'promptModeCompete', label: 'Challenge',
    hintKey: 'promptModeCompeteHint', hint: 'Append a challenge instruction: aim to win the side-by-side comparison',
    triggers: ['/challenge', '/compete'] },
  { id: 'brainstorm', labelKey: 'promptModeBrainstorm', label: 'Brainstorm',
    hintKey: 'promptModeBrainstormHint', hint: 'Append a brainstorm instruction: many varied angles, no early verdict',
    triggers: ['/brainstorm', '/idea'] },
  { id: 'deep', labelKey: 'promptModeDeep', label: 'Deep thinking',
    hintKey: 'promptModeDeepHint', hint: 'Append a reasoning instruction: break down, verify, show the steps',
    triggers: ['/think', '/deep'] }
];

// The composer's Auto choice: no mode by default, but a mode prompt's trigger
// word typed in the question (say /study) applies that mode to this send only.
export const AUTO_PROMPT_MODE = 'auto';

export const PROMPT_MODE_IDS = PROMPT_MODES.map(mode => mode.id);

// chrome.storage.local, not sync: the library lives in this device's IndexedDB.
export const PROMPT_MODES_SEEDED_KEY = 'promptModesSeeded';
// Tracks which built-ins were offered, so later additions can be seeded without
// restoring built-ins a user deleted.
export const PROMPT_MODES_SEEDED_IDS_KEY = 'promptModesSeededIds';
const LEGACY_PROMPT_MODE_IDS = ['concise', 'learning', 'compete', 'brainstorm'];
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
  compete: 'You are answering this alongside several other AIs and the answers will be compared side by side. Give the most accurate, insightful and useful answer you can.',
  deep: 'Think step by step: break the problem down, identify assumptions, analyze root causes, compare options and verify in reverse; before the final conclusion, list your reasoning steps in detail and state any uncertainty.'
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
 * @param {string | null | undefined} instruction - The mode prompt's text for the AIs.
 * @returns {string}
 */
export function applyPromptMode(text, instruction) {
  if (typeof text !== 'string' || !text.trim()) return text;
  if (typeof instruction !== 'string' || !instruction.trim()) return text;
  return `${text}\n\n${instruction}`;
}

// Trimmed prompt text, '' for a missing or non-string field. Prompts saved
// before `contentEn` existed have none, so both helpers fall back to the other.
function promptText(prompt, field) {
  const value = prompt?.[field];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The text shown for a prompt in the library, the mode menu, the placeholder
 * and the send preview: the Chinese `content` first, the English `contentEn`
 * when there is none.
 *
 * @param {{ content?: string, contentEn?: string } | null | undefined} prompt
 * @returns {string}
 */
export function getPromptDisplayContent(prompt) {
  return promptText(prompt, 'content') || promptText(prompt, 'contentEn');
}

/**
 * The text sent to the AIs for a prompt: the English `contentEn` first, the
 * Chinese `content` when there is none.
 *
 * @param {{ content?: string, contentEn?: string } | null | undefined} prompt
 * @returns {string}
 */
export function getPromptAiContent(prompt) {
  return promptText(prompt, 'contentEn') || promptText(prompt, 'content');
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

// A trigger word is a whole word: it may not follow a path, URL or identifier
// character (a/study, https://x/study) or be followed by one (/studying,
// /study.md). Whitespace, Chinese text and punctuation may touch it.
const TRIGGER_NOT_AFTER = '(?<![A-Za-z0-9_/.:@%~#&=+\\-])';
const TRIGGER_NOT_BEFORE = '(?![A-Za-z0-9_/.\\-])';

/**
 * Trigger word matches in `text`, in text order, as { start, end, prompt }.
 * Matching ignores case; overlapping matches keep the earlier one.
 *
 * @param {string} text
 * @param {Array<object>} modePrompts - Prompts from selectModePrompts.
 * @returns {Array<{ start: number, end: number, prompt: object }>}
 */
function findPromptModeMatches(text, modePrompts) {
  const found = [];
  for (const prompt of Array.isArray(modePrompts) ? modePrompts : []) {
    for (const trigger of normalizePromptTriggers(prompt?.triggers)) {
      const pattern = new RegExp(`${TRIGGER_NOT_AFTER}${escapeRegExp(trigger)}${TRIGGER_NOT_BEFORE}`, 'giu');
      for (const match of text.matchAll(pattern)) {
        found.push({ start: match.index, end: match.index + match[0].length, prompt });
      }
    }
  }
  const kept = [];
  for (const match of found.sort((a, b) => a.start - b.start)) {
    if (!kept.length || match.start >= kept[kept.length - 1].end) kept.push(match);
  }
  return kept;
}

/**
 * Finds the mode prompts whose trigger words appear in `text` as whole words
 * and removes those words from it. Each matched mode counts once, in menu order.
 *
 * @param {string} text - The question as the user typed it.
 * @param {Array<object>} modePrompts - Prompts from selectModePrompts.
 * @returns {{ text: string, prompts: Array<object> }}
 */
export function detectPromptModeTriggers(text, modePrompts) {
  if (typeof text !== 'string' || !text) return { text, prompts: [] };
  const matches = findPromptModeMatches(text, modePrompts);
  if (!matches.length) return { text, prompts: [] };
  let remaining = '';
  let cursor = 0;
  for (const match of matches) {
    remaining += text.slice(cursor, match.start);
    cursor = match.end;
  }
  remaining += text.slice(cursor);
  const prompts = (Array.isArray(modePrompts) ? modePrompts : [])
    .filter(prompt => matches.some(match => match.prompt === prompt));
  // Only the edges are trimmed; the rest of the question keeps its spacing.
  return { text: remaining.trim(), prompts };
}

/**
 * The trigger word the user is typing at `caret`, for Tab completion: "/st"
 * completes to the first trigger, in menu order, that starts with it. Only at
 * the end of a line, so the inline hint never covers text after the caret.
 *
 * @param {string} text
 * @param {number} caret - Caret offset in `text`.
 * @param {Array<object>} modePrompts - Prompts from selectModePrompts.
 * @returns {{ start: number, end: number, trigger: string, rest: string, prompt: object } | null}
 */
export function findPromptTriggerCompletion(text, caret, modePrompts) {
  if (typeof text !== 'string' || !Number.isInteger(caret) || caret < 0 || caret > text.length) return null;
  if (caret < text.length && text[caret] !== '\n') return null;
  const match = new RegExp(`${TRIGGER_NOT_AFTER}/[^\\s/]+$`, 'u').exec(text.slice(0, caret));
  if (!match) return null;
  const typed = match[0].toLowerCase();
  for (const prompt of Array.isArray(modePrompts) ? modePrompts : []) {
    for (const trigger of normalizePromptTriggers(prompt?.triggers)) {
      if (trigger.length > typed.length && trigger.startsWith(typed)) {
        return { start: match.index, end: caret, trigger, rest: trigger.slice(typed.length), prompt };
      }
    }
  }
  return null;
}

/**
 * The text and instruction one send uses. Auto mode looks for trigger words
 * and appends the matched modes' instructions in the text the AIs receive
 * (English first); any other mode passes `text` through with `instruction`.
 *
 * @param {string} text
 * @param {{ auto?: boolean, instruction?: string | null, modePrompts?: Array<object> }} options
 * @returns {{ text: string, instruction: string | null, prompts: Array<object> }}
 */
export function resolvePromptModeForText(text, { auto = false, instruction = null, modePrompts = [] } = {}) {
  if (!auto) return { text, instruction: instruction || null, prompts: [] };
  const detected = detectPromptModeTriggers(text, modePrompts);
  const combined = detected.prompts.map(getPromptAiContent).filter(Boolean).join('\n\n');
  return { text: detected.text, instruction: combined || null, prompts: detected.prompts };
}

/**
 * What the composer previews under the question: the typed text with the
 * trigger words Auto mode removes marked, then the instruction that follows
 * it. Mirrors resolvePromptModeForText, so the preview matches the send, but
 * shows each instruction as the library shows it (Chinese first).
 * Returns null when nothing is appended or nothing would be sent.
 *
 * @param {string} text
 * @param {{ auto?: boolean, instruction?: string | null, displayInstruction?: string | null,
 *   modePrompts?: Array<object> }} options
 * @returns {Array<{ kind: 'text' | 'removed' | 'suffix', value: string }> | null}
 */
export function describePromptSend(text, { auto = false, instruction = null, displayInstruction, modePrompts = [] } = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const resolved = resolvePromptModeForText(text, { auto, instruction, modePrompts });
  const matches = auto ? findPromptModeMatches(text, modePrompts) : [];
  if (!resolved.text.trim() || (!resolved.instruction && !matches.length)) return null;
  // Auto collects the matched modes' instructions again, in display form; a
  // single mode previews `displayInstruction`, or the sent text when absent.
  const suffix = auto
    ? resolved.prompts.map(getPromptDisplayContent).filter(Boolean).join('\n\n')
    : (displayInstruction ?? instruction);
  const segments = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start > cursor) segments.push({ kind: 'text', value: text.slice(cursor, match.start) });
    segments.push({ kind: 'removed', value: text.slice(match.start, match.end) });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
  if (resolved.instruction) segments.push({ kind: 'suffix', value: `\n\n${suffix || resolved.instruction}` });
  return segments;
}

/** A modeKey for a prompt the user marks as a mode. */
export function createModeKey() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function builtInModeRank(prompt) {
  const index = PROMPT_MODE_IDS.indexOf(prompt.modeKey);
  return index === -1 ? PROMPT_MODE_IDS.length : index;
}

/**
 * Library prompts marked as modes, in menu order: the built-in modes in
 * PROMPT_MODES order, then the user's own modes oldest first. A modeKey listed
 * twice (say after an import) shows once, as its oldest prompt. A mode needs
 * only one of its two texts, since the AIs receive the English one when set.
 *
 * @param {Array<object>} prompts
 * @returns {Array<object>}
 */
export function selectModePrompts(prompts) {
  const byAge = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id || 0) - (b.id || 0);
  const seen = new Set();
  return (Array.isArray(prompts) ? prompts : [])
    .filter(prompt => prompt?.isMode === true && prompt.modeKey && getPromptAiContent(prompt))
    .sort(byAge)
    .filter(prompt => !seen.has(prompt.modeKey) && seen.add(prompt.modeKey))
    .sort((a, b) => builtInModeRank(a) - builtInModeRank(b) || byAge(a, b));
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
 * Adds the built-in modes the library lacks (by modeKey) and returns how many
 * it added. Built-ins already present, from an import say, are not copied again.
 *
 * @param {{ getAllPrompts: () => Promise<object[]>, savePrompt: (data: object) => Promise<unknown>, tr?: Function }} options
 * @returns {Promise<number>}
 */
export async function restoreDefaultModePrompts({ getAllPrompts, savePrompt, tr = null }) {
  const existing = new Set((await getAllPrompts()).map(prompt => prompt.modeKey).filter(Boolean));
  let added = 0;
  for (const prompt of getDefaultModePrompts(tr)) {
    if (existing.has(prompt.modeKey)) continue;
    await savePrompt(prompt);
    added += 1;
  }
  return added;
}

/**
 * Adds newly introduced built-in modes to the library once per device. Modes
 * the user deleted stay deleted, and a library that already holds a built-in
 * (from an import, say) does not get a second copy.
 *
 * @param {{ getAllPrompts: () => Promise<object[]>, savePrompt: (data: object) => Promise<unknown>,
 *   storage?: { get: Function, set: Function }, tr?: Function }} options
 * @returns {Promise<boolean>} Whether this call seeded the library.
 */
export async function ensureDefaultModePrompts({ getAllPrompts, savePrompt, storage, tr = null }) {
  if (!storage?.get || !storage?.set) return false;
  const [seeded, seededIds] = await Promise.all([
    storage.get(PROMPT_MODES_SEEDED_KEY),
    storage.get(PROMPT_MODES_SEEDED_IDS_KEY)
  ]);
  const legacySeeded = seeded?.[PROMPT_MODES_SEEDED_KEY] === true;
  const storedIds = seededIds?.[PROMPT_MODES_SEEDED_IDS_KEY];
  const offeredIds = Array.isArray(storedIds)
    ? new Set(storedIds.filter(id => typeof id === 'string'))
    : new Set(legacySeeded ? LEGACY_PROMPT_MODE_IDS : []);
  const existing = new Set((await getAllPrompts()).map(prompt => prompt.modeKey).filter(Boolean));
  let added = 0;
  for (const prompt of getDefaultModePrompts(tr)) {
    if (offeredIds.has(prompt.modeKey) || existing.has(prompt.modeKey)) continue;
    await savePrompt(prompt);
    added += 1;
  }
  const currentIds = [...PROMPT_MODE_IDS];
  const idsChanged = !Array.isArray(storedIds)
    || storedIds.length !== currentIds.length
    || storedIds.some((id, index) => id !== currentIds[index]);
  await storage.set({
    [PROMPT_MODES_SEEDED_KEY]: true,
    [PROMPT_MODES_SEEDED_IDS_KEY]: currentIds
  });
  return added > 0 || idsChanged || !legacySeeded;
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

// chrome.storage.local flag for the one-time sample cleanup below. V2 runs it
// again for samples re-imported before Options stopped importing them.
export const SAMPLE_PROMPTS_CLEANED_KEY = 'samplePromptsCleanedV2';

const normalizeSampleText = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * Removes, once per device, the sample prompts an earlier "Import default
 * library" added, so the library starts from the prompt modes. Only prompts
 * still exactly as shipped (same title and content) go; modes, favorites and
 * anything the user edited or wrote stay.
 *
 * @param {{ getAllPrompts: () => Promise<object[]>, deletePrompt: (id: number) => Promise<unknown>,
 *   loadSamples: () => Promise<Array<{ title?: string, content?: string }>>,
 *   storage?: { get: Function, set: Function } }} options
 * @returns {Promise<number>} How many prompts were removed.
 */
export async function cleanupSamplePrompts({ getAllPrompts, deletePrompt, loadSamples, storage }) {
  if (!storage?.get || !storage?.set) return 0;
  const stored = await storage.get(SAMPLE_PROMPTS_CLEANED_KEY);
  if (stored?.[SAMPLE_PROMPTS_CLEANED_KEY]) return 0;
  const samples = new Set((await loadSamples())
    .map(sample => `${normalizeSampleText(sample?.title)}\n${normalizeSampleText(sample?.content)}`));
  let removed = 0;
  for (const prompt of await getAllPrompts()) {
    if (prompt?.isMode === true || prompt?.isFavorite) continue;
    if (!samples.has(`${normalizeSampleText(prompt?.title)}\n${normalizeSampleText(prompt?.content)}`)) continue;
    await deletePrompt(prompt.id);
    removed += 1;
  }
  await storage.set({ [SAMPLE_PROMPTS_CLEANED_KEY]: true });
  return removed;
}
