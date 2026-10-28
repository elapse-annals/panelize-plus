// AI summary: merges the answers of one round into a single summary through a
// user-configured OpenAI-compatible chat completions API. Every point cites
// the answers it came from by source id (S1, S2, ...), which the caller maps
// back to panels. Text and panel names come from the caller so this module
// has no page globals.

import { ANSWER_STATUS } from './answer-stats.js';

export const AI_SUMMARY_API_KEY_STORAGE_KEY = 'aiSummaryApiKey';
export const AI_SUMMARY_REQUEST_TIMEOUT_MS = 120 * 1000;
export const AI_SUMMARY_MIN_ANSWERS = 2;
// Longest answer text sent per panel; longer answers are cut.
export const ANSWER_TEXT_MAX_LENGTH = 20000;
const ERROR_BODY_MAX_LENGTH = 300;
const CHAT_COMPLETIONS_PATH = '/chat/completions';
// Most positions shown side by side for one disagreement.
export const MAX_DISAGREEMENT_POSITIONS = 3;
// Items backed by at least this share of the summarized answers are highlighted.
export const STRONG_SUPPORT_RATIO = 0.8;

export function normalizeChatCompletionsUrl(baseUrl) {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (!trimmed) {
    return '';
  }
  return trimmed.endsWith(CHAT_COMPLETIONS_PATH) ? trimmed : `${trimmed}${CHAT_COMPLETIONS_PATH}`;
}

// The host permission pattern for the API, or '' when the URL is not http(s).
export function getSummaryOriginPattern(baseUrl) {
  try {
    const url = new URL(normalizeChatCompletionsUrl(baseUrl));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return '';
    }
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return '';
  }
}

export function isSummaryConfigured(config) {
  return Boolean(getSummaryOriginPattern(config?.baseUrl) && config?.model?.trim() && config?.apiKey?.trim());
}

export function truncateAnswerText(text, maxLength = ANSWER_TEXT_MAX_LENGTH) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

/**
 * Chat messages asking for a JSON summary of the answers.
 *
 * @param {{ question: string, answers: Array<{ sourceId: string, label: string, text: string }>, language?: string }} options
 */
export function buildSummaryMessages({ question, answers, language = 'en' }) {
  const system = [
    'You merge several AI assistants\' answers to the same question into one summary.',
    'Use only what the answers say; do not add facts of your own.',
    'Every item must list the source ids of all answers that support it.',
    'If the question asks for a judgment or a choice (yes or no, true or false, which is better, should I), put the clear answer first in "verdict", citing the answers that reach it; otherwise set "verdict" to null.',
    'Put what most answers agree on in "consensus".',
    'Put points that only some answers raise, and that no other answer contradicts, in "unique". An answer that does not mention a point does not disagree with it.',
    `Put in "disagreements" only points where answers contradict each other and cannot both be true; if there are none, return []. Give each a short "topic" with up to ${MAX_DISAGREEMENT_POSITIONS} "positions"; merge similar positions and cite each one's sources.`,
    'Never write source ids (S1, S2, ...) or assistant names in any "text" or "topic"; attribution belongs only in "sources".',
    `Write the text in the language with BCP 47 tag "${language}".`,
    'Reply with JSON only, no code fence, in this shape:',
    '{"verdict": {"text": "...", "sources": ["S1"]} or null, "consensus": [{"text": "...", "sources": ["S1", "S2"]}], "unique": [{"text": "...", "sources": ["S2"]}], "disagreements": [{"topic": "...", "positions": [{"text": "...", "sources": ["S1"]}, {"text": "...", "sources": ["S2"]}]}]}'
  ].join('\n');

  const user = [
    `Question:\n${question || '(no text)'}`,
    ...answers.map(answer => `--- Answer ${answer.sourceId} (${answer.label}) ---\n${truncateAnswerText(answer.text)}`)
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function normalizeSources(sources, validSourceIds) {
  return [...new Set((Array.isArray(sources) ? sources : [])
    .map(source => String(source).trim().toUpperCase())
    .filter(source => validSourceIds.includes(source)))];
}

const SOURCE_ID_PATTERN = 'S\\d+';
const SOURCE_ID_LIST = `${SOURCE_ID_PATTERN}(?:\\s*(?:[,，、/&]|and|和|与)\\s*${SOURCE_ID_PATTERN})*`;
// A bracketed group of ids such as "(S1, S2)", "（S1、S3）" or "[S2]".
const BRACKETED_SOURCE_IDS = new RegExp(`\\s*[(（\\[【]\\s*${SOURCE_ID_LIST}\\s*[)）\\]】]`, 'gi');
// Ids that open the text, such as "S1: " or "S1、S2：".
const LEADING_SOURCE_IDS = new RegExp(`^${SOURCE_ID_LIST}\\s*[:：]\\s*`, 'i');
const BARE_SOURCE_ID = /\bS\d+\b/gi;

/**
 * Text without the source ids the model cited inline; the sources field
 * already carries them.
 */
export function stripSourceIds(text) {
  return typeof text === 'string'
    ? text.replace(BRACKETED_SOURCE_IDS, '').replace(LEADING_SOURCE_IDS, '').trim()
    : '';
}

/**
 * Text with any remaining source id of a known source replaced by its label,
 * so no stand-in id reaches the reader.
 *
 * @param {string} text
 * @param {(sourceId: string) => string | undefined} getLabel
 */
export function replaceSourceIds(text, getLabel) {
  return String(text ?? '').replace(BARE_SOURCE_ID, match => getLabel(match.toUpperCase()) || match);
}

function normalizeItem(item, validSourceIds) {
  return {
    text: stripSourceIds(item?.text),
    sources: normalizeSources(item?.sources, validSourceIds)
  };
}

function normalizeItems(items, validSourceIds) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map(item => normalizeItem(item, validSourceIds)).filter(item => item.text);
}

// An older flat disagreement ({ text, sources }) becomes a topic without
// positions so its sources still show.
function normalizeDisagreements(items, validSourceIds) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(item => {
      const positions = normalizeItems(item?.positions, validSourceIds).slice(0, MAX_DISAGREEMENT_POSITIONS);
      const topic = stripSourceIds(item?.topic);
      if (!topic && !positions.length && typeof item?.text === 'string') {
        return { topic: item.text.trim(), sources: normalizeSources(item.sources, validSourceIds), positions: [] };
      }
      return { topic, sources: [], positions };
    })
    .filter(item => item.topic || item.positions.length);
}

/**
 * The summary in the model's reply. A reply that is not the requested JSON is
 * kept as a plain overview so nothing the model wrote is lost. Replies in the
 * older shape ("points") are read as consensus; replies without "unique" have none.
 *
 * @returns {{ verdict: { text: string, sources: string[] } | null, overview: string, consensus: Array<{ text: string, sources: string[] }>, unique: Array<{ text: string, sources: string[] }>, disagreements: Array<{ topic: string, sources: string[], positions: Array<{ text: string, sources: string[] }> }> }}
 */
export function parseSummaryResponse(content, validSourceIds) {
  const raw = typeof content === 'string' ? content.trim() : '';
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  try {
    if (start < 0 || end <= start) throw new Error('No JSON object');
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    const verdict = typeof parsed.verdict === 'string'
      ? normalizeItem({ text: parsed.verdict }, validSourceIds)
      : normalizeItem(parsed.verdict, validSourceIds);
    return {
      verdict: verdict.text ? verdict : null,
      overview: typeof parsed.overview === 'string' ? parsed.overview.trim() : '',
      consensus: normalizeItems(parsed.consensus ?? parsed.points, validSourceIds),
      unique: normalizeItems(parsed.unique, validSourceIds),
      disagreements: normalizeDisagreements(parsed.disagreements, validSourceIds)
    };
  } catch {
    return { verdict: null, overview: raw, consensus: [], unique: [], disagreements: [] };
  }
}

/**
 * Calls the chat completions API and returns the reply text.
 *
 * @param {{ config: { baseUrl: string, apiKey: string, model: string }, messages: Array<object>, fetchImpl?: Function, signal?: AbortSignal, timeoutMs?: number }} options
 */
export async function requestSummary({
  config,
  messages,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = AI_SUMMARY_REQUEST_TIMEOUT_MS
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeoutId = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(normalizeChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({ model: config.model.trim(), messages, temperature: 0.2 }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, ERROR_BODY_MAX_LENGTH)}` : ''}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Empty reply');
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * True once every timed answer in the round has finished and at least
 * AI_SUMMARY_MIN_ANSWERS answers have text.
 *
 * @param {object} round
 * @param {Map<string, string>} answerTexts Answer text by panel id.
 */
export function isRoundReadyForSummary(round, answerTexts) {
  const answers = Object.values(round?.answers || {});
  if (answers.length === 0 || answers.some(answer => answer.timed && answer.status === ANSWER_STATUS.PENDING)) {
    return false;
  }
  const withText = Object.keys(round.answers).filter(panelId => answerTexts?.get(panelId)?.trim());
  return withText.length >= AI_SUMMARY_MIN_ANSWERS;
}

/**
 * True when an item's sources make up at least STRONG_SUPPORT_RATIO of the
 * summarized answers (rounded up), and at least AI_SUMMARY_MIN_ANSWERS were summarized.
 *
 * @param {string[]} sources
 * @param {number} totalSources
 */
export function isStronglySupported(sources, totalSources) {
  if (!(totalSources >= AI_SUMMARY_MIN_ANSWERS)) return false;
  const count = Array.isArray(sources) ? sources.length : 0;
  // Integer comparison: 15 * 0.8 is not exactly 12 in floating point.
  return count * 10 >= totalSources * Math.round(STRONG_SUPPORT_RATIO * 10);
}

/**
 * The summary as plain text, each line followed by its sources' labels.
 *
 * @param {{ verdict: object | null, overview: string, consensus: Array<object>, unique?: Array<object>, disagreements: Array<object> }} summary
 * @param {(sourceId: string) => string} getLabel
 * @param {{ verdictTitle?: string, consensusTitle?: string, uniqueTitle?: string, disagreementsTitle?: string }} [options]
 */
export function formatSummaryText(summary, getLabel, {
  verdictTitle = 'Verdict',
  consensusTitle = 'Agreed',
  uniqueTitle = 'Unique insights',
  disagreementsTitle = 'Disagreements'
} = {}) {
  const cite = sources => (sources?.length ? ` [${sources.map(getLabel).join(', ')}]` : '');
  const line = item => `- ${item.text}${cite(item.sources)}`;
  const disagreement = item => [
    `- ${item.topic}${cite(item.sources)}`,
    ...item.positions.map(position => `  · ${position.text}${cite(position.sources)}`)
  ].join('\n');
  const parts = [];
  if (summary.verdict) parts.push(`${verdictTitle}: ${summary.verdict.text}${cite(summary.verdict.sources)}`);
  if (summary.overview) parts.push(summary.overview);
  if (summary.consensus.length) parts.push(`${consensusTitle}:\n${summary.consensus.map(line).join('\n')}`);
  if (summary.unique?.length) parts.push(`${uniqueTitle}:\n${summary.unique.map(line).join('\n')}`);
  if (summary.disagreements.length) parts.push(`${disagreementsTitle}:\n${summary.disagreements.map(disagreement).join('\n')}`);
  return parts.join('\n\n');
}
