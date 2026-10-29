import { describe, expect, it, vi } from 'vitest';
import {
  ANSWER_TEXT_MAX_LENGTH,
  buildSummaryMessages,
  formatSummaryText,
  groupItemsBySources,
  getSummaryOriginPattern,
  isRoundReadyForSummary,
  isStronglySupported,
  isSummaryConfigured,
  normalizeChatCompletionsUrl,
  parseSummaryResponse,
  replaceSourceIds,
  requestSummary,
  stripSourceIds,
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
    expect(messages[0].content).toContain('"verdict"');
    expect(messages[0].content).toContain('"positions"');
    expect(messages[0].content).toContain('"unique"');
    expect(messages[0].content).toContain('2–5 short, themed sections');
    expect(messages[0].content).toContain('"heading"');
    expect(messages[0].content).toContain('"points"');
    expect(messages[0].content).toContain('complete paragraph of 1–3 sentences');
    expect(messages[0].content).toContain('contradict each other and cannot both be true');
    expect(messages[0].content).toContain('does not mention a point does not disagree');
    expect(messages[0].content).toContain('Never write source ids');
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
    const summary = parseSummaryResponse('```json\n{"verdict":{"text":"Yes","sources":["s1","S9"]},"consensus":[{"text":"Scattering","sources":["s1","S2","S9","S1"]},{"text":" ","sources":["S1"]}],"disagreements":[{"topic":"Color","positions":[{"text":"Blue","sources":["S1"]},{"text":"Violet","sources":["S2"]}]}]}\n```', valid);
    expect(summary).toEqual({
      verdict: { text: 'Yes', sources: ['S1'] },
      overview: '',
      consensus: [{ text: 'Scattering', sources: ['S1', 'S2'] }],
      unique: [],
      disagreements: [{ topic: 'Color', sources: [], positions: [{ text: 'Blue', sources: ['S1'] }, { text: 'Violet', sources: ['S2'] }] }]
    });
  });

  it('reads unique points and strips cited source ids from the text', () => {
    const summary = parseSummaryResponse(JSON.stringify({
      consensus: [{ text: 'Uses EAV (S1, S2)', sources: ['S1', 'S2'] }],
      unique: [{ text: 'S2：Has plugins', sources: ['S2'] }],
      disagreements: [{ topic: 'Cost【S1】', positions: [{ text: 'Cheap（S1、S2）', sources: ['S1'] }] }]
    }), valid);
    expect(summary.consensus).toEqual([{ text: 'Uses EAV', sources: ['S1', 'S2'] }]);
    expect(summary.unique).toEqual([{ text: 'Has plugins', sources: ['S2'] }]);
    expect(summary.disagreements[0].topic).toBe('Cost');
    expect(summary.disagreements[0].positions[0].text).toBe('Cheap');
  });

  it('flattens themed consensus groups and keeps headings only when present', () => {
    const summary = parseSummaryResponse(JSON.stringify({
      consensus: [
        { heading: 'Evidence', points: [
          { text: 'First paragraph.', sources: ['S1', 'S2'] },
          { text: 'Second paragraph (S1).', sources: ['S1'] }
        ] },
        { heading: ' ', points: [{ text: 'Unsectioned paragraph.', sources: ['S2'] }] }
      ]
    }), valid);

    expect(summary.consensus).toEqual([
      { text: 'First paragraph.', sources: ['S1', 'S2'], section: 'Evidence' },
      { text: 'Second paragraph.', sources: ['S1'], section: 'Evidence' },
      { text: 'Unsectioned paragraph.', sources: ['S2'] }
    ]);
  });

  it('keeps at most three positions and drops empty disagreements', () => {
    const positions = ['A', 'B', 'C', 'D'].map(text => ({ text, sources: ['S1'] }));
    const summary = parseSummaryResponse(JSON.stringify({ verdict: null, disagreements: [{ topic: 'T', positions }, { topic: ' ', positions: [] }] }), valid);
    expect(summary.verdict).toBeNull();
    expect(summary.disagreements).toHaveLength(1);
    expect(summary.disagreements[0].positions.map(position => position.text)).toEqual(['A', 'B', 'C']);
  });

  it('reads the older points and flat disagreements', () => {
    const summary = parseSummaryResponse('{"overview":"Both agree.","points":[{"text":"Scattering","sources":["S1"]}],"disagreements":[{"text":"Color","sources":["S2"]}]}', valid);
    expect(summary).toEqual({
      verdict: null,
      overview: 'Both agree.',
      consensus: [{ text: 'Scattering', sources: ['S1'] }],
      unique: [],
      disagreements: [{ topic: 'Color', sources: ['S2'], positions: [] }]
    });
  });

  it('keeps a non-JSON reply as the overview', () => {
    expect(parseSummaryResponse('Plain summary', valid)).toEqual({ verdict: null, overview: 'Plain summary', consensus: [], unique: [], disagreements: [] });
  });
});

describe('source ids in text', () => {
  it('strips bracketed and leading ids only', () => {
    expect(stripSourceIds('Fast (S1, S2)')).toBe('Fast');
    expect(stripSourceIds('采用 EAV（S1、S3）模型')).toBe('采用 EAV模型');
    expect(stripSourceIds('Point [S2] here')).toBe('Point here');
    expect(stripSourceIds('S1, S2: Fast')).toBe('Fast');
    expect(stripSourceIds('S1 thinks so')).toBe('S1 thinks so');
    expect(stripSourceIds(null)).toBe('');
  });

  it('replaces remaining known ids with labels', () => {
    const label = id => ({ S1: 'ChatGPT', S2: 'Gemini' })[id];
    expect(replaceSourceIds('S1 认为 A，s2 认为 B，S9 未知', label)).toBe('ChatGPT 认为 A，Gemini 认为 B，S9 未知');
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

describe('isStronglySupported', () => {
  const ids = count => Array.from({ length: count }, (_, index) => `S${index + 1}`);

  it('is true at or above 80% of the summarized answers', () => {
    expect(isStronglySupported(ids(4), 5)).toBe(true);
    expect(isStronglySupported(ids(12), 15)).toBe(true);
    expect(isStronglySupported(ids(2), 2)).toBe(true);
  });

  it('is false below 80%, with one answer, or without sources', () => {
    expect(isStronglySupported(ids(3), 5)).toBe(false);
    expect(isStronglySupported(ids(11), 15)).toBe(false);
    expect(isStronglySupported(ids(1), 1)).toBe(false);
    expect(isStronglySupported([], 5)).toBe(false);
    expect(isStronglySupported(undefined, 5)).toBe(false);
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
  it('lists the verdict, consensus and disagreements with their source labels', () => {
    const text = formatSummaryText({
      verdict: { text: 'Yes', sources: ['S1'] },
      overview: '',
      consensus: [{ text: 'Point', sources: ['S1', 'S2'] }],
      unique: [{ text: 'Only one', sources: ['S2'] }],
      disagreements: [{ topic: 'Split', sources: [], positions: [{ text: 'A', sources: ['S1'] }, { text: 'B', sources: ['S2'] }] }]
    }, id => ({ S1: 'ChatGPT', S2: 'Gemini' })[id], { verdictTitle: '结论', consensusTitle: '一致', uniqueTitle: '独到观点', disagreementsTitle: '分歧' });
    expect(text).toBe('结论: Yes [ChatGPT]\n\n一致:\nPoint [ChatGPT, Gemini]\n\n独到观点:\n[Gemini]\n- Only one\n\n分歧:\n- Split\n  · A [ChatGPT]\n  · B [Gemini]');
  });

  it('copies consensus sections as paragraphs and unique insights by source group', () => {
    const text = formatSummaryText({
      verdict: null,
      overview: 'Overview.',
      consensus: [
        { section: 'Evidence', text: 'First paragraph.', sources: ['S2', 'S1'] },
        { section: 'Evidence', text: 'Second paragraph.', sources: ['S2'] },
        { section: 'Caveats', text: 'A caveat.', sources: ['S1'] },
        { text: 'Legacy flat point.', sources: ['S1', 'S2'] }
      ],
      unique: [
        { text: 'Only Gemini.', sources: ['S2'] },
        { text: 'Shared insight.', sources: ['S2', 'S1'] },
        { text: 'Only ChatGPT.', sources: ['S1'] },
        { text: 'Same source set.', sources: ['S1', 'S2'] },
        { text: 'No attribution.', sources: [] }
      ],
      disagreements: []
    }, id => ({ S1: 'ChatGPT', S2: 'Gemini' })[id], {
      consensusTitle: '一致',
      uniqueTitle: '独到观点',
      sourceOrder: ['S1', 'S2']
    });

    expect(text).toBe([
      'Overview.',
      '一致:\n## Evidence\nFirst paragraph. [ChatGPT, Gemini]\n\nSecond paragraph. [Gemini]\n\n## Caveats\nA caveat. [ChatGPT]\n\nLegacy flat point. [ChatGPT, Gemini]',
      '独到观点:\n[ChatGPT]\n- Only ChatGPT.\n\n[Gemini]\n- Only Gemini.\n\n[ChatGPT, Gemini]\n- Shared insight.\n- Same source set.\n\n- No attribution.'
    ].join('\n\n'));
  });
});

describe('groupItemsBySources', () => {
  it('groups exact source sets in panel order without duplicating items', () => {
    const items = [
      { text: 'S1/S3 first', sources: ['S3', 'S1'] },
      { text: 'S2 only', sources: ['S2'] },
      { text: 'S1 only', sources: ['S1', 'S1'] },
      { text: 'S1/S2', sources: ['S1', 'S2'] },
      { text: 'S3 only', sources: ['S3'] },
      { text: 'S3/S1 reversed', sources: ['S1', 'S3'] },
      { text: 'Unknown pair first', sources: ['S9', 'S8'] },
      { text: 'Unknown pair reversed', sources: ['S8', 'S9'] },
      { text: 'No sources', sources: [] },
      { text: 'Sources omitted' }
    ];

    const groups = groupItemsBySources(items, ['S1', 'S2', 'S3']);

    expect(groups.map(group => group.sources)).toEqual([
      ['S1'], ['S2'], ['S3'], ['S1', 'S3'], ['S1', 'S2'], ['S8', 'S9'], []
    ]);
    expect(groups.map(group => group.items.map(item => item.text))).toEqual([
      ['S1 only'], ['S2 only'], ['S3 only'], ['S1/S3 first', 'S3/S1 reversed'], ['S1/S2'],
      ['Unknown pair first', 'Unknown pair reversed'], ['No sources', 'Sources omitted']
    ]);
    expect(groups.flatMap(group => group.items)).toHaveLength(items.length);
    expect(items[0].sources).toEqual(['S3', 'S1']);
  });

  it('keeps multi-source groups with the same first panel in first-seen order', () => {
    const groups = groupItemsBySources([
      { text: 'S1/S3', sources: ['S1', 'S3'] },
      { text: 'S1/S2', sources: ['S1', 'S2'] }
    ], ['S1', 'S2', 'S3']);

    expect(groups.map(group => group.sources)).toEqual([['S1', 'S3'], ['S1', 'S2']]);
  });
});
