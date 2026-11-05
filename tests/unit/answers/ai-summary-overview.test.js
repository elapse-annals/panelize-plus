import { describe, expect, it } from 'vitest';
import { parseInlineSpans, parseOverviewBlocks, renderOverviewBlocks } from '../../../modules/answers/ai-summary-overview.js';

describe('parseOverviewBlocks', () => {
  it('reads plain prose as one paragraph', () => {
    expect(parseOverviewBlocks('Plain summary')).toEqual([
      { type: 'paragraph', spans: [{ text: 'Plain summary', marks: [] }] }
    ]);
  });

  it('reads the readable-lines fallback as a paragraph and a list', () => {
    expect(parseOverviewBlocks('Theme\n- First\n- Second')).toEqual([
      { type: 'paragraph', spans: [{ text: 'Theme', marks: [] }] },
      { type: 'list', ordered: false, items: [[{ text: 'First', marks: [] }], [{ text: 'Second', marks: [] }]] }
    ]);
  });

  it('reads headings only when a space follows the hashes', () => {
    expect(parseOverviewBlocks('## Key **points**')).toEqual([
      { type: 'heading', level: 2, spans: [{ text: 'Key ', marks: [] }, { text: 'points', marks: ['strong'] }] }
    ]);
    expect(parseOverviewBlocks('#hashtag')).toEqual([
      { type: 'paragraph', spans: [{ text: '#hashtag', marks: [] }] }
    ]);
    expect(parseOverviewBlocks('# C#')).toEqual([
      { type: 'heading', level: 1, spans: [{ text: 'C#', marks: [] }] }
    ]);
    expect(parseOverviewBlocks('## Key ##')).toEqual([
      { type: 'heading', level: 2, spans: [{ text: 'Key', marks: [] }] }
    ]);
  });

  it('accepts every unordered marker', () => {
    const blocks = parseOverviewBlocks('- A\n* B\n+ C\n• D\n・ E');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].items.map(item => item[0].text)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('accepts ordered markers and starts a new list when the kind changes', () => {
    const ordered = parseOverviewBlocks('1. A\n2) B\n3、C');
    expect(ordered).toEqual([
      { type: 'list', ordered: true, items: [[{ text: 'A', marks: [] }], [{ text: 'B', marks: [] }], [{ text: 'C', marks: [] }]] }
    ]);
    expect(parseOverviewBlocks('- A\n1. B')).toEqual([
      { type: 'list', ordered: false, items: [[{ text: 'A', marks: [] }]] },
      { type: 'list', ordered: true, items: [[{ text: 'B', marks: [] }]] }
    ]);
  });

  it('flattens nested bullets into the same list', () => {
    const blocks = parseOverviewBlocks('- A\n  - A1\n- B');
    expect(blocks[0].items.map(item => item[0].text)).toEqual(['A', 'A1', 'B']);
  });

  it('joins wrapped lines by language', () => {
    expect(parseOverviewBlocks('- First line\nsecond line')).toEqual([
      { type: 'list', ordered: false, items: [[{ text: 'First line second line', marks: [] }]] }
    ]);
    expect(parseOverviewBlocks('中文\n续行')).toEqual([
      { type: 'paragraph', spans: [{ text: '中文续行', marks: [] }] }
    ]);
  });

  it('keeps fenced code literal', () => {
    const blocks = parseOverviewBlocks('```js\n# not a heading\n- not a list\n\n**not bold**\n```');
    expect(blocks).toEqual([{ type: 'code', text: '# not a heading\n- not a list\n\n**not bold**' }]);
  });

  it('consumes the rest of an unclosed fence', () => {
    expect(parseOverviewBlocks('```\nline one\nline two')).toEqual([
      { type: 'code', text: 'line one\nline two' }
    ]);
  });

  it('does not close a four-character fence with three', () => {
    expect(parseOverviewBlocks('````\n```\n````')).toEqual([{ type: 'code', text: '```' }]);
  });

  it('returns no blocks for empty input', () => {
    expect(parseOverviewBlocks('  \n\n')).toEqual([]);
    expect(parseOverviewBlocks('')).toEqual([]);
  });
});

describe('parseInlineSpans', () => {
  it('reads code before emphasis', () => {
    expect(parseInlineSpans('Use `**literal**` and **bold**')).toEqual([
      { text: 'Use ', marks: [] },
      { text: '**literal**', marks: ['code'] },
      { text: ' and ', marks: [] },
      { text: 'bold', marks: ['strong'] }
    ]);
  });

  it('reads bold, italic and bold italic', () => {
    expect(parseInlineSpans('**bold** __strong__ *italic* _also_ ***both***')).toEqual([
      { text: 'bold', marks: ['strong'] },
      { text: ' ', marks: [] },
      { text: 'strong', marks: ['strong'] },
      { text: ' ', marks: [] },
      { text: 'italic', marks: ['em'] },
      { text: ' ', marks: [] },
      { text: 'also', marks: ['em'] },
      { text: ' ', marks: [] },
      { text: 'both', marks: ['strong', 'em'] }
    ]);
  });

  it('leaves intraword underscores and unmatched markers literal', () => {
    expect(parseInlineSpans('snake_case_name')).toEqual([
      { text: 'snake_case_name', marks: [] }
    ]);
    expect(parseInlineSpans('**unclosed')).toEqual([
      { text: '**unclosed', marks: [] }
    ]);
    expect(parseInlineSpans('`unclosed')).toEqual([
      { text: '`unclosed', marks: [] }
    ]);
  });

  it('treats markup as text', () => {
    expect(parseInlineSpans('<img src=x onerror=alert(1)>')).toEqual([
      { text: '<img src=x onerror=alert(1)>', marks: [] }
    ]);
  });
});

describe('renderOverviewBlocks', () => {
  const render = (text, formatText) => {
    const container = document.createElement('div');
    renderOverviewBlocks(container, parseOverviewBlocks(text), formatText);
    return container;
  };

  it('renders headings, paragraphs, lists, code and inline marks', () => {
    const container = render('## Head\n\n- **A** `b`\n\n```\ncode **x**\n```');
    expect(container.querySelector('h4').textContent).toBe('Head');
    expect(container.querySelector('ul li strong').textContent).toBe('A');
    expect(container.querySelector('ul li code').textContent).toBe('b');
    expect(container.querySelector('pre code').textContent).toBe('code **x**');
    expect(container.querySelector('pre code strong')).toBeNull();

    const paragraph = render('Plain **words**');
    expect(paragraph.querySelector('p').textContent).toBe('Plain words');
    expect(paragraph.querySelector('p strong').textContent).toBe('words');

    const ordered = render('1. A\n2. B');
    expect(ordered.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('formats every text node, including code', () => {
    const container = render('S1 says `S1` and\n\n```\nS1\n```', text => text.replaceAll('S1', 'ChatGPT'));
    expect(container.querySelector('p').textContent).toBe('ChatGPT says ChatGPT and');
    expect(container.querySelector('pre code').textContent).toBe('ChatGPT');
  });

  it('does not create elements from reply markup', () => {
    const container = render('<img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)> <script>alert(1)</script>');
  });

  it('clears old content', () => {
    const container = document.createElement('div');
    renderOverviewBlocks(container, parseOverviewBlocks('Old'));
    renderOverviewBlocks(container, []);
    expect(container.childElementCount).toBe(0);
  });
});
