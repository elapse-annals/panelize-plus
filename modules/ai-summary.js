// AI summary: merges the answers of one round into a single summary through a
// user-configured OpenAI-compatible chat completions API. Every point cites
// the answers it came from by source id (S1, S2, ...), which the caller maps
// back to panels. Text and panel names come from the caller so this module
// has no page globals.

import { ANSWER_STATUS } from './answer-stats.js';

export const AI_SUMMARY_API_KEY_STORAGE_KEY = 'aiSummaryApiKey';
// How long the API may go without sending anything before the request fails.
export const AI_SUMMARY_REQUEST_TIMEOUT_MS = 90 * 1000;
// Longest a summary request may run in total, even while data keeps arriving.
export const AI_SUMMARY_MAX_DURATION_MS = 5 * 60 * 1000;
export const AI_SUMMARY_TIMEOUT_ERROR = 'Timed out';
export const AI_SUMMARY_MIN_ANSWERS = 2;
// Longest answer text sent per panel; longer answers are cut.
export const ANSWER_TEXT_MAX_LENGTH = 20000;
// Longest combined answer text sent in one summary request.
export const ANSWER_TEXTS_TOTAL_MAX_LENGTH = 60000;
const ERROR_BODY_MAX_LENGTH = 300;
const CHAT_COMPLETIONS_PATH = '/chat/completions';
// Most positions shown side by side for one disagreement.
export const MAX_DISAGREEMENT_POSITIONS = 3;
// Items backed by at least this share of the summarized answers are highlighted.
export const STRONG_SUPPORT_RATIO = 0.8;
// The automatic summary starts once this share of a round's answers finished.
export const AUTO_SUMMARY_READY_RATIO = 0.8;

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
 * Answer texts cut to share a total budget: short answers stay whole and the
 * room they leave goes to the longer ones, each still capped at maxLength.
 *
 * @param {string[]} texts
 * @returns {string[]}
 */
export function fitAnswerTexts(texts, totalMaxLength = ANSWER_TEXTS_TOTAL_MAX_LENGTH, maxLength = ANSWER_TEXT_MAX_LENGTH) {
  const normalized = texts.map(text => truncateAnswerText(text, maxLength));
  const limits = new Array(normalized.length).fill(0);
  let remaining = totalMaxLength;
  let open = normalized.map((_, index) => index);
  while (open.length && remaining > 0) {
    const share = Math.floor(remaining / open.length);
    if (share <= 0) break;
    const fits = open.filter(index => normalized[index].length <= share);
    if (!fits.length) {
      open.forEach(index => { limits[index] = share; });
      break;
    }
    fits.forEach(index => {
      limits[index] = normalized[index].length;
      remaining -= normalized[index].length;
    });
    open = open.filter(index => !fits.includes(index));
  }
  return normalized.map((text, index) => truncateAnswerText(text, Math.max(1, limits[index])));
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
    'Put what most answers agree on in "consensus", grouped into 2–5 short, themed sections with at most 3 points each.',
    'Use this shape for "consensus": [{"heading": "Short theme", "points": [{"text": "A complete paragraph of 1–3 sentences", "sources": ["S1", "S2"]}]}]. Each point must read as a complete paragraph; do not turn points into fragments or lists.',
    'Put points that only some answers raise, and that no other answer contradicts, in "unique", at most 8 of the most useful. An answer that does not mention a point does not disagree with it.',
    `Put in "disagreements" only points where answers contradict each other and cannot both be true, at most 5; if there are none, return []. Give each a short "topic" with up to ${MAX_DISAGREEMENT_POSITIONS} "positions"; merge similar positions and cite each one's sources.`,
    'Be concise: keep the whole summary short enough to read in a minute.',
    'Never write source ids (S1, S2, ...) or assistant names in any "text" or "topic"; attribution belongs only in "sources".',
    `Write the text in the language with BCP 47 tag "${language}".`,
    'Reply with JSON only, no code fence, in this shape:',
    '{"verdict": {"text": "...", "sources": ["S1"]} or null, "consensus": [{"heading": "...", "points": [{"text": "...", "sources": ["S1", "S2"]}]}], "unique": [{"text": "...", "sources": ["S2"]}], "disagreements": [{"topic": "...", "positions": [{"text": "...", "sources": ["S1"]}, {"text": "...", "sources": ["S2"]}]}]}'
  ].join('\n');

  const texts = fitAnswerTexts(answers.map(answer => answer.text));
  const user = [
    `Question:\n${question || '(no text)'}`,
    ...answers.map((answer, index) => `--- Answer ${answer.sourceId} (${answer.label}) ---\n${texts[index]}`)
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

function normalizeConsensus(items, validSourceIds) {
  if (!Array.isArray(items)) {
    return [];
  }

  const consensus = [];
  items.forEach(item => {
    if (Array.isArray(item?.points)) {
      const section = stripSourceIds(item.heading);
      normalizeItems(item.points, validSourceIds).forEach(point => {
        consensus.push(section ? { ...point, section } : point);
      });
      return;
    }

    const point = normalizeItem(item, validSourceIds);
    if (point.text) consensus.push(point);
  });
  return consensus;
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
 * @returns {{ verdict: { text: string, sources: string[] } | null, overview: string, consensus: Array<{ text: string, sources: string[], section?: string }>, unique: Array<{ text: string, sources: string[] }>, disagreements: Array<{ topic: string, sources: string[], positions: Array<{ text: string, sources: string[] }> }> }}
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
      consensus: normalizeConsensus(parsed.consensus ?? parsed.points, validSourceIds),
      unique: normalizeItems(parsed.unique, validSourceIds),
      disagreements: normalizeDisagreements(parsed.disagreements, validSourceIds)
    };
  } catch {
    return { verdict: null, overview: raw, consensus: [], unique: [], disagreements: [] };
  }
}

// Reads a server-sent events body of chat completion chunks. Calls onActivity
// for every chunk, including reasoning the reply leaves out.
async function readStreamedContent(body, onActivity) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const readLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return false;
    }
    if (chunk?.error) {
      throw new Error(chunk.error.message || JSON.stringify(chunk.error).slice(0, ERROR_BODY_MAX_LENGTH));
    }
    const delta = chunk?.choices?.[0]?.delta;
    if (typeof delta?.content === 'string') content += delta.content;
    onActivity(content.length);
    return false;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onActivity(content.length);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (readLine(line)) {
        reader.cancel().catch(() => {});
        return content;
      }
    }
  }
  buffer += decoder.decode();
  if (buffer) readLine(buffer);
  return content;
}

/**
 * Calls the chat completions API and returns the reply text. The reply is
 * streamed when the API supports it, so a long summary does not time out
 * while it is still being written: the request fails only after timeoutMs
 * without new data, or after maxDurationMs in all.
 *
 * @param {{ config: { baseUrl: string, apiKey: string, model: string }, messages: Array<object>, fetchImpl?: Function, signal?: AbortSignal, timeoutMs?: number, maxDurationMs?: number, onProgress?: (receivedChars: number) => void }} options
 */
export async function requestSummary({
  config,
  messages,
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = AI_SUMMARY_REQUEST_TIMEOUT_MS,
  maxDurationMs = AI_SUMMARY_MAX_DURATION_MS,
  onProgress
}) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timeOut = () => {
    timedOut = true;
    controller.abort();
  };
  signal?.addEventListener('abort', abort, { once: true });
  let idleTimeoutId = setTimeout(timeOut, timeoutMs);
  const maxTimeoutId = setTimeout(timeOut, maxDurationMs);
  const onActivity = (receivedChars) => {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(timeOut, timeoutMs);
    onProgress?.(receivedChars);
  };
  try {
    const response = await fetchImpl(normalizeChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`
      },
      body: JSON.stringify({ model: config.model.trim(), messages, temperature: 0.2, stream: true }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, ERROR_BODY_MAX_LENGTH)}` : ''}`);
    }
    let content;
    if (response.body?.getReader && /text\/event-stream/i.test(response.headers?.get?.('content-type') || '')) {
      content = await readStreamedContent(response.body, onActivity);
    } else {
      const data = await response.json();
      content = data?.choices?.[0]?.message?.content;
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Empty reply');
    }
    return content;
  } catch (error) {
    if (timedOut) throw new Error(AI_SUMMARY_TIMEOUT_ERROR);
    throw error;
  } finally {
    clearTimeout(idleTimeoutId);
    clearTimeout(maxTimeoutId);
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
 * True once at least AUTO_SUMMARY_READY_RATIO of the round's answers have
 * finished and at least AI_SUMMARY_MIN_ANSWERS answers have text, so a slow
 * AI does not hold up the automatic summary.
 *
 * @param {object} round
 * @param {Map<string, string>} answerTexts Answer text by panel id.
 */
export function isRoundReadyForAutoSummary(round, answerTexts) {
  const answers = Object.values(round?.answers || {});
  if (answers.length === 0) {
    return false;
  }
  const finished = answers.filter(answer => !(answer.timed && answer.status === ANSWER_STATUS.PENDING)).length;
  // Integer comparison, as in isStronglySupported.
  if (finished * 10 < answers.length * Math.round(AUTO_SUMMARY_READY_RATIO * 10)) {
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

function normalizeSourceIds(sources) {
  return [...new Set((Array.isArray(sources) ? sources : [])
    .map(source => typeof source === 'string' ? source.trim().toUpperCase() : '')
    .filter(Boolean))];
}

function orderSourceIds(sources, sourceOrder = []) {
  const orderedSourceIds = normalizeSourceIds(sourceOrder);
  const sourceRanks = new Map(orderedSourceIds.map((sourceId, index) => [sourceId, index]));
  const rank = sourceId => sourceRanks.has(sourceId) ? sourceRanks.get(sourceId) : Number.MAX_SAFE_INTEGER;
  return normalizeSourceIds(sources).sort((left, right) => {
    const rankDifference = rank(left) - rank(right);
    return rankDifference || left.localeCompare(right);
  });
}

/**
 * Group items by their exact source set. The source order also determines the
 * order of source ids within each group and the display order of the groups.
 * Items with no sources are retained together in a final unattributed group.
 *
 * @param {Array<object>} items
 * @param {string[]} sourceOrder Source ids in panel order.
 * @returns {Array<{ sources: string[], items: object[] }>}
 */
export function groupItemsBySources(items, sourceOrder = []) {
  if (!Array.isArray(items) || !items.length) return [];

  const orderedSourceIds = normalizeSourceIds(sourceOrder);
  const sourceRanks = new Map(orderedSourceIds.map((sourceId, index) => [sourceId, index]));
  const rank = sourceId => sourceRanks.has(sourceId) ? sourceRanks.get(sourceId) : Number.MAX_SAFE_INTEGER;

  const groupsByKey = new Map();
  items.forEach(item => {
    const sources = orderSourceIds(item?.sources, orderedSourceIds);
    const key = JSON.stringify(sources);
    let group = groupsByKey.get(key);
    if (!group) {
      group = { sources, items: [], firstIndex: groupsByKey.size };
      groupsByKey.set(key, group);
    }
    group.items.push(item);
  });

  const sourceRankForGroup = group => group.sources.length
    ? Math.min(...group.sources.map(rank))
    : Number.MAX_SAFE_INTEGER;
  return [...groupsByKey.values()].sort((left, right) => {
    const leftKind = left.sources.length === 0 ? 2 : left.sources.length === 1 ? 0 : 1;
    const rightKind = right.sources.length === 0 ? 2 : right.sources.length === 1 ? 0 : 1;
    if (leftKind !== rightKind) return leftKind - rightKind;
    if (leftKind !== 2) {
      const rankDifference = sourceRankForGroup(left) - sourceRankForGroup(right);
      if (rankDifference) return rankDifference;
    }
    return left.firstIndex - right.firstIndex;
  }).map(({ sources, items: groupItems }) => ({ sources, items: groupItems }));
}

/**
 * The summary as plain text, with article paragraphs and source-grouped unique
 * insights. Source ids in output follow the supplied panel order.
 *
 * @param {{ verdict: object | null, overview: string, consensus: Array<object>, unique?: Array<object>, disagreements: Array<object> }} summary
 * @param {(sourceId: string) => string} getLabel
 * @param {{ verdictTitle?: string, consensusTitle?: string, uniqueTitle?: string, disagreementsTitle?: string, sourceOrder?: string[] }} [options]
 */
export function formatSummaryText(summary, getLabel, {
  verdictTitle = 'Verdict',
  consensusTitle = 'Agreed',
  uniqueTitle = 'Unique insights',
  disagreementsTitle = 'Disagreements',
  sourceOrder = []
} = {}) {
  const cite = sources => {
    const orderedSources = orderSourceIds(sources, sourceOrder);
    return orderedSources.length ? ` [${orderedSources.map(getLabel).join(', ')}]` : '';
  };
  const consensusGroups = [];
  summary.consensus.forEach(item => {
    const section = typeof item.section === 'string' ? item.section.trim() : '';
    let group = consensusGroups.at(-1);
    if (!group || group.section !== section) {
      group = { section, paragraphs: [] };
      consensusGroups.push(group);
    }
    group.paragraphs.push(`${item.text}${cite(item.sources)}`);
  });
  const consensusText = consensusGroups
    .map(group => `${group.section ? `## ${group.section}\n` : ''}${group.paragraphs.join('\n\n')}`)
    .join('\n\n');
  const uniqueText = groupItemsBySources(summary.unique || [], sourceOrder)
    .map(group => {
      const heading = group.sources.length ? `[${group.sources.map(getLabel).join(', ')}]` : '';
      return [heading, ...group.items.map(item => `- ${item.text}`)].filter(Boolean).join('\n');
    })
    .join('\n\n');
  const disagreement = item => [
    `- ${item.topic}${cite(item.sources)}`,
    ...item.positions.map(position => `  · ${position.text}${cite(position.sources)}`)
  ].join('\n');
  const parts = [];
  if (summary.verdict) parts.push(`${verdictTitle}: ${summary.verdict.text}${cite(summary.verdict.sources)}`);
  if (summary.overview) parts.push(summary.overview);
  if (summary.consensus.length) parts.push(`${consensusTitle}:\n${consensusText}`);
  if (summary.unique?.length) parts.push(`${uniqueTitle}:\n${uniqueText}`);
  if (summary.disagreements.length) parts.push(`${disagreementsTitle}:\n${summary.disagreements.map(disagreement).join('\n')}`);
  return parts.join('\n\n');
}
