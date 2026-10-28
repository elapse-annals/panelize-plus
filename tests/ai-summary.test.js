import { describe, expect, it, vi } from 'vitest';
import {
  ANSWER_TEXT_MAX_LENGTH,
  buildSummaryMessages,
  formatSummaryText,
  getSummaryOriginPattern,
  isRoundReadyForSummary,
  isSummaryConfigured,
  normalizeChatCompletionsUrl,
  parseSummaryResponse,
  requestSummary,
  truncateAnswerText
} from '../modules/ai-summary.js';
import { applyTimingEvent, createRound } from '../modules/answer-stats.js';

const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: ' sk-test ', model: ' gpt-test ' };

describe('normalizeChatCompletionsUrl', () => {
  it('appends the chat completions path once', () => {
    expect(normalizeChatCompletionsUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1/chat/completions');
    expect(normalizeChatCompletionsUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1/chat/completions');
    expect(normalizeChatCompletionsUrl('  ')).toBe('');
  });
});

describe('getSummaryOriginPattern', () => {
  it('returns the host pattern for http(s) URLs only', () => {
    expect(getSummaryOriginPattern('https://api.example.com:8443/v1')).toBe('https://api.example.com/*');
    expect(getSummaryOriginPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(getSummaryOriginPattern('ftp://example.com')).toBe('');
    expect(getSummaryOriginPattern('not a url')).toBe('');
  });
});

describe('isSummaryConfigured', () => {
  it('needs a URL, model and key', () => {
    expect(isSummaryConfigured(CONFIG)).toBe(true);
    expect(isSummaryConfigured({ ...CONFIG, apiKey: ' ' })).toBe(false);
    expect(isSummaryConfigured({ ...CONFIG, model: '' })).toBe(false);
    expect(isSummaryConfigured({ ...CONFIG, baseUrl: '' })).toBe(false);
    expect(isSummaryConfigured(null)).toBe(false);
  });
});

describe('buildSummaryMessages', () => {
  it('labels each answer with its source id and truncates long text', () => {
    const messages = buildSummaryMessages({
      question: 'Why is the sky blue?',
      answers: [
        { sourceId: 'S1', label: 'AI 1', text: 'Rayleigh scattering.' },
        { sourceId: 'S2', label: 'AI 2', text: 'x'.repeat(ANSWER_TEXT_MAX_LENGTH + 10) }
      ],
      language: 'zh-CN'
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('"zh-CN"');
    expect(messages[1].content).toContain('Why is the sky blue?');
    expect(messages[1].content).toContain('--- Answer S1 (AI 1) ---\nRayleigh scattering.');
    expect(messages[1].content).not.toContain('x'.repeat(ANSWER_TEXT_MAX_LENGTH));
  });

  it('truncates answer text', () => {
    expect(truncateAnswerText('  abc  ', 5)).toBe('abc');
    expect(truncateAnswerText('abcdef', 4)).toBe('abc…');
  });
});

describe('parseSummaryResponse', () => {
  const valid = ['S1', 'S2'];

  it('parses JSON in a code fence and drops unknown sources', () => {
    const summary = parseSummaryResponse('```json\n{"overview":"Both agree.","points":[{"text":"Scattering","sources":["s1","S2","S9","S1"]},{"text":" ","sources":["S1"]}],"disagreements":[{"text":"Color","sources":["S2"]}]}\n```', valid);
    expect(summary).toEqual({
      overview: 'Both agree.',
      points: [{ text: 'Scattering', sources: ['S1', 'S2'] }],
      disagreements: [{ text: 'Color', sources: ['S2'] }]
    });
  });

  it('keeps a non-JSON reply as the overview', () => {
    expect(parseSummaryResponse('Plain summary', valid)).toEqual({ overview: 'Plain summary', points: [], disagreements: [] });
  });
});

describe('requestSummary', () => {
  it('posts the model and messages with the API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"overview":"ok"}' } }] })
    });
    const content = await requestSummary({ config: CONFIG, messages: [{ role: 'user', content: 'hi' }], fetchImpl });
    expect(content).toBe('{"overview":"ok"}');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] });
  });

  it('reports HTTP errors with the status and body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' });
    await expect(requestSummary({ config: CONFIG, messages: [], fetchImpl })).rejects.toThrow('HTTP 401: bad key');
  });

  it('rejects an empty reply', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
    await expect(requestSummary({ config: CONFIG, messages: [], fetchImpl })).rejects.toThrow('Empty reply');
  });

  it('aborts when the caller aborts', async () => {
    const fetchImpl = vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const controller = new AbortController();
    const pending = requestSummary({ config: CONFIG, messages: [], fetchImpl, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});

describe('isRoundReadyForSummary', () => {
  const round = createRound({
    id: 'r1',
    createdAt: 1000,
    text: 'Q',
    panels: [
      { id: 'p1', providerId: 'chatgpt' },
      { id: 'p2', providerId: 'gemini' },
      { id: 'p3', providerId: 'claude' }
    ]
  });

  it('waits for every timed answer and at least two texts', () => {
    const texts = new Map([['p1', 'A']]);
    let next = applyTimingEvent(round, 'p1', 'complete', 2000);
    expect(isRoundReadyForSummary(next, texts)).toBe(false);
    next = applyTimingEvent(next, 'p2', 'complete', 3000);
    expect(isRoundReadyForSummary(next, texts)).toBe(false);
    texts.set('p2', 'B');
    expect(isRoundReadyForSummary(next, texts)).toBe(true);
  });
});

describe('formatSummaryText', () => {
  it('lists points with their source labels', () => {
    const text = formatSummaryText({
      overview: 'Overview',
      points: [{ text: 'Point', sources: ['S1', 'S2'] }],
      disagreements: [{ text: 'Split', sources: [] }]
    }, id => ({ S1: 'ChatGPT', S2: 'Gemini' })[id]);
    expect(text).toBe('Overview\n\n- Point [ChatGPT, Gemini]\n\nDisagreements:\n- Split');
  });
});
