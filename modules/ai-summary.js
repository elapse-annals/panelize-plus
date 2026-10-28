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
    'Every point must list the source ids of all answers that support it.',
    'Put points where the answers contradict each other in "disagreements", citing each side.',
    `Write the text in the language with BCP 47 tag "${language}".`,
    'Reply with JSON only, no code fence, in this shape:',
    '{"overview": "two or three sentences", "points": [{"text": "...", "sources": ["S1"]}], "disagreements": [{"text": "...", "sources": ["S1", "S2"]}]}'
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

function normalizeItems(items, validSourceIds) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map(item => ({
      text: typeof item?.text === 'string' ? item.text.trim() : '',
      sources: [...new Set((Array.isArray(item?.sources) ? item.sources : [])
        .map(source => String(source).trim().toUpperCase())
        .filter(source => validSourceIds.includes(source)))]
    }))
    .filter(item => item.text);
}

/**
 * The summary in the model's reply. A reply that is not the requested JSON is
 * kept as a plain overview so nothing the model wrote is lost.
 *
 * @returns {{ overview: string, points: Array<{ text: string, sources: string[] }>, disagreements: Array<{ text: string, sources: string[] }> }}
 */
export function parseSummaryResponse(content, validSourceIds) {
  const raw = typeof content === 'string' ? content.trim() : '';
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  try {
    if (start < 0 || end <= start) throw new Error('No JSON object');
    const parsed = JSON.parse(unfenced.slice(start, end + 1));
    return {
      overview: typeof parsed.overview === 'string' ? parsed.overview.trim() : '',
      points: normalizeItems(parsed.points, validSourceIds),
      disagreements: normalizeItems(parsed.disagreements, validSourceIds)
    };
  } catch {
    return { overview: raw, points: [], disagreements: [] };
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
 * The summary as plain text, each line followed by its sources' labels.
 *
 * @param {{ overview: string, points: Array<object>, disagreements: Array<object> }} summary
 * @param {(sourceId: string) => string} getLabel
 * @param {{ disagreementsTitle?: string }} [options]
 */
export function formatSummaryText(summary, getLabel, { disagreementsTitle = 'Disagreements' } = {}) {
  const line = item => `- ${item.text}${item.sources.length ? ` [${item.sources.map(getLabel).join(', ')}]` : ''}`;
  const parts = [];
  if (summary.overview) parts.push(summary.overview);
  if (summary.points.length) parts.push(summary.points.map(line).join('\n'));
  if (summary.disagreements.length) parts.push(`${disagreementsTitle}:\n${summary.disagreements.map(line).join('\n')}`);
  return parts.join('\n\n');
}
