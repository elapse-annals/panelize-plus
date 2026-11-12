// Local cache of AI summaries keyed by the question text. A cached summary is
// reused for an identical question within three days; the drawer labels it and
// the existing "Summarize again" button bypasses the cache. Every summary from
// the last three days is kept so the desktop client can show it in its history
// browser.

import { hasSummaryContent, normalizeChatCompletionsUrl } from './ai-summary.js';

export const AI_SUMMARY_CACHE_STORAGE_KEY = 'aiSummaryCache';
export const AI_SUMMARY_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const AI_SUMMARY_CACHE_VERSION = 1;
export const AI_SUMMARY_MAX_FORMATTED_TEXT_LENGTH = 200000;

export function normalizeCacheQuestion(text) {
  return typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '';
}

function normalizePanels(panels) {
  if (!Array.isArray(panels)) return [];
  return panels
    .map(panel => ({
      position: Number(panel?.position),
      providerId: typeof panel?.providerId === 'string' ? panel.providerId : ''
    }))
    .filter(panel => Number.isFinite(panel.position) && panel.position > 0 && panel.providerId)
    .sort((left, right) => left.position - right.position);
}

function samePanels(left, right) {
  return left.length === right.length && left.every((panel, index) => (
    panel.position === right[index].position && panel.providerId === right[index].providerId
  ));
}

export function isAiSummaryCacheEntryFresh(entry, now = Date.now(), ttl = AI_SUMMARY_CACHE_TTL_MS) {
  const createdAt = Number(entry?.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
  const age = now - createdAt;
  return age >= 0 && age <= ttl;
}

export function isAiSummaryCacheEntryValid(entry) {
  return Boolean(
    entry
    && entry.version === AI_SUMMARY_CACHE_VERSION
    && normalizeCacheQuestion(entry.question)
    && typeof entry.baseUrl === 'string'
    && typeof entry.model === 'string'
    && typeof entry.language === 'string'
    && normalizePanels(entry.panels).length > 0
    && Array.isArray(entry.sourcePositions)
    && entry.sourcePositions.length > 0
    && hasSummaryContent(entry.summary)
  );
}

/** Valid, unexpired entries, newest first, with one entry per question. */
export function readAiSummaryCache(value, now = Date.now(), ttl = AI_SUMMARY_CACHE_TTL_MS) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const entry of value) {
    if (!isAiSummaryCacheEntryValid(entry) || !isAiSummaryCacheEntryFresh(entry, now, ttl)) continue;
    const question = normalizeCacheQuestion(entry.question);
    if (entries.some(existing => normalizeCacheQuestion(existing.question) === question)) continue;
    entries.push(entry);
  }
  return entries;
}

export function createAiSummaryCacheEntry({
  question,
  config,
  language,
  panels,
  sources,
  summary,
  blind = false,
  formattedText = '',
  now = Date.now()
}) {
  return {
    version: AI_SUMMARY_CACHE_VERSION,
    question: normalizeCacheQuestion(question),
    baseUrl: normalizeChatCompletionsUrl(config?.baseUrl || ''),
    model: String(config?.model || '').trim(),
    language: String(language || ''),
    panels: normalizePanels(panels),
    sourcePositions: (Array.isArray(sources) ? sources : [])
      .map(source => Number(source?.position))
      .filter(position => Number.isFinite(position)),
    summary,
    // Blind mode is recorded at generation time so the synced copy never has
    // to re-derive provider labels from the panel list.
    blind: blind === true,
    formattedText: typeof formattedText === 'string'
      ? formattedText.slice(0, AI_SUMMARY_MAX_FORMATTED_TEXT_LENGTH)
      : '',
    createdAt: now
  };
}

/**
 * Finds a cached summary for the same question, API and panel positions. The
 * question match is exact after trimming; model, API and language must also
 * match so a summary is never shown against a different setup.
 */
export function matchAiSummaryCache(entries, query, { now = Date.now(), ttl = AI_SUMMARY_CACHE_TTL_MS } = {}) {
  const question = normalizeCacheQuestion(query?.question);
  const baseUrl = normalizeChatCompletionsUrl(query?.baseUrl || '');
  const model = String(query?.model || '').trim();
  const language = String(query?.language || '');
  const panels = normalizePanels(query?.panels);
  if (!question || !baseUrl || !model || !panels.length) return null;

  return readAiSummaryCache(entries, now, ttl).find(entry => (
    normalizeCacheQuestion(entry.question) === question
    && normalizeChatCompletionsUrl(entry.baseUrl) === baseUrl
    && entry.model.trim() === model
    && entry.language === language
    && samePanels(normalizePanels(entry.panels), panels)
  )) || null;
}

/** Puts the newest summary for a question first, keeping every fresh question. */
export function upsertAiSummaryCache(
  entries,
  entry,
  { now = Date.now(), ttl = AI_SUMMARY_CACHE_TTL_MS } = {}
) {
  const current = readAiSummaryCache(entries, now, ttl);
  if (!isAiSummaryCacheEntryValid(entry) || !isAiSummaryCacheEntryFresh(entry, now, ttl)) return current;
  const question = normalizeCacheQuestion(entry.question);
  return [entry, ...current.filter(existing => normalizeCacheQuestion(existing.question) !== question)];
}

function defaultStorage() {
  return typeof chrome !== 'undefined' ? chrome.storage?.local : null;
}

export async function loadAiSummaryCache(storage = defaultStorage(), now = Date.now()) {
  if (!storage?.get) return [];
  try {
    const result = await storage.get({ [AI_SUMMARY_CACHE_STORAGE_KEY]: [] });
    return readAiSummaryCache(result?.[AI_SUMMARY_CACHE_STORAGE_KEY], now);
  } catch (error) {
    console.warn('[Panelize] Could not read the summary cache:', error);
    return [];
  }
}

export async function saveAiSummaryCacheEntry(entry, storage = defaultStorage(), now = Date.now()) {
  if (!storage?.get || !storage?.set) return [];
  try {
    const result = await storage.get({ [AI_SUMMARY_CACHE_STORAGE_KEY]: [] });
    const next = upsertAiSummaryCache(result?.[AI_SUMMARY_CACHE_STORAGE_KEY], entry, { now });
    await storage.set({ [AI_SUMMARY_CACHE_STORAGE_KEY]: next });
    return next;
  } catch (error) {
    console.warn('[Panelize] Could not save the summary cache:', error);
    return [];
  }
}
