/**
 * Light Markdown blocks for an AI summary overview.
 *
 * The overview holds a reply that is not the requested JSON, so it may be
 * Markdown or plain prose. Splitting it into blocks lets the drawer use its
 * own typography instead of showing raw markers. The parser is pure; the
 * renderer only creates elements and text nodes, so reply text can never
 * become markup.
 */

/**
 * @typedef {{ text: string, marks: Array<'strong' | 'em' | 'code'> }} OverviewSpan
 * @typedef {{ type: 'heading', level: number, spans: OverviewSpan[] }
 *   | { type: 'paragraph', spans: OverviewSpan[] }
 *   | { type: 'list', ordered: boolean, items: OverviewSpan[][] }
 *   | { type: 'code', text: string }} OverviewBlock
 */

const CJK_EDGE = /[　-〿぀-ヿ㐀-鿿가-힯＀-￯]/u;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const HEADING_PATTERN = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/u;
const UNORDERED_ITEM_PATTERN = /^\s*[-*+•・]\s+(.*)$/u;
const ORDERED_ITEM_PATTERN = /^\s*\d{1,3}[.)]\s+(.*)$/u;
const CJK_ORDERED_ITEM_PATTERN = /^\s*\d{1,3}、\s*(.*)$/u;

/**
 * @param {string} text
 * @returns {OverviewBlock[]}
 */
export function parseOverviewBlocks(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return [];
  const lines = source.split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }

    const fence = line.match(FENCE_PATTERN);
    if (fence) {
      const marker = fence[1];
      const length = marker.length;
      const closing = marker[0] === '`'
        ? new RegExp('^ {0,3}`{' + length + ',}\\s*$', 'u')
        : new RegExp('^ {0,3}~{' + length + ',}\\s*$', 'u');
      const codeLines = [];
      index++;
      while (index < lines.length && !closing.test(lines[index])) {
        codeLines.push(lines[index]);
        index++;
      }
      if (index < lines.length) index++;
      if (codeLines.some(codeLine => codeLine.trim())) {
        blocks.push({ type: 'code', text: codeLines.join('\n') });
      }
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const headingText = heading[2].replace(/[ \t]+#+$/u, '').trim();
      if (headingText) {
        blocks.push({ type: 'heading', level: heading[1].length, spans: parseInlineSpans(headingText) });
      }
      index++;
      continue;
    }

    const item = matchListItem(line);
    if (item) {
      const items = [item.text];
      index++;
      while (index < lines.length) {
        const next = lines[index];
        if (!next.trim()) break;
        const nextItem = matchListItem(next);
        if (nextItem) {
          if (nextItem.ordered !== item.ordered) break;
          items.push(nextItem.text);
          index++;
          continue;
        }
        if (isBlockStart(next)) break;
        items[items.length - 1] = joinLines(items[items.length - 1], next.trim());
        index++;
      }
      blocks.push({ type: 'list', ordered: item.ordered, items: items.map(parseInlineSpans) });
      continue;
    }

    const paragraphLines = [line.trim()];
    index++;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim() || isBlockStart(next)) break;
      paragraphLines.push(next.trim());
      index++;
    }
    blocks.push({
      type: 'paragraph',
      spans: parseInlineSpans(paragraphLines.reduce(joinLines))
    });
  }

  return blocks;
}

function matchListItem(line) {
  const unordered = line.match(UNORDERED_ITEM_PATTERN);
  if (unordered) return { ordered: false, text: unordered[1].trim() };
  const ordered = line.match(ORDERED_ITEM_PATTERN);
  if (ordered) return { ordered: true, text: ordered[1].trim() };
  const cjkOrdered = line.match(CJK_ORDERED_ITEM_PATTERN);
  if (cjkOrdered) return { ordered: true, text: cjkOrdered[1].trim() };
  return null;
}

function isBlockStart(line) {
  return FENCE_PATTERN.test(line) || HEADING_PATTERN.test(line) || Boolean(matchListItem(line));
}

// Soft-wrapped lines join with a space in English, but without one at a CJK
// boundary so Chinese and Japanese prose does not gain stray spaces.
function joinLines(left, right) {
  const start = left.replace(/[ \t]+$/u, '');
  const end = right.replace(/^[ \t]+/u, '');
  if (!start) return end;
  if (!end) return start;
  return CJK_EDGE.test(start.at(-1)) || CJK_EDGE.test(end[0]) ? start + end : `${start} ${end}`;
}

/**
 * @param {string} text
 * @returns {OverviewSpan[]}
 */
export function parseInlineSpans(text) {
  const source = String(text ?? '');
  const spans = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      pushSpan(spans, { text: buffer, marks: [] });
      buffer = '';
    }
  };

  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '`') {
      const runLength = countRun(source, index, '`');
      const start = index + runLength;
      const close = findClosingRun(source, start, '`', runLength);
      if (close > start) {
        flush();
        pushSpan(spans, { text: source.slice(start, close), marks: ['code'] });
        index = close + runLength;
        continue;
      }
      buffer += source.slice(index, index + runLength);
      index += runLength;
      continue;
    }

    if (character === '*' || character === '_') {
      const runLength = countRun(source, index, character);
      const emphasis = runLength <= 3 ? matchEmphasis(source, index, character, runLength) : null;
      if (emphasis) {
        flush();
        pushSpan(spans, { text: emphasis.content, marks: emphasis.marks });
        index = emphasis.end;
        continue;
      }
      buffer += source.slice(index, index + runLength);
      index += runLength;
      continue;
    }

    buffer += character;
    index++;
  }

  flush();
  return spans;
}

function matchEmphasis(source, index, character, runLength) {
  if (character === '_' && isWordCharacter(source[index - 1])) return null;
  const start = index + runLength;
  const close = findClosingRun(source, start, character, runLength);
  if (close < 0) return null;
  const content = source.slice(start, close);
  if (!content.trim() || /^\s|\s$/u.test(content)) return null;
  if (character === '_' && isWordCharacter(source[close + runLength])) return null;
  const marks = runLength === 1 ? ['em'] : runLength === 2 ? ['strong'] : ['strong', 'em'];
  return { content, marks, end: close + runLength };
}

function countRun(source, index, character) {
  let end = index;
  while (source[end] === character) end++;
  return end - index;
}

// The next run of exactly this many characters, so a single ` closes a single
// ` and a three-character fence is not closed by two.
function findClosingRun(source, from, character, length) {
  let index = from;
  while (index < source.length) {
    const found = source.indexOf(character, index);
    if (found < 0) return -1;
    const runLength = countRun(source, found, character);
    if (runLength === length) return found;
    index = found + runLength;
  }
  return -1;
}

function isWordCharacter(character) {
  return Boolean(character) && WORD_CHARACTER.test(character);
}

function pushSpan(spans, span) {
  if (!span.text) return;
  const previous = spans.at(-1);
  if (previous && previous.marks.join() === span.marks.join()) {
    previous.text += span.text;
    return;
  }
  spans.push(span);
}

/**
 * Replaces the container's children with the blocks. Every string is set with
 * a text node, so reply text cannot become markup.
 *
 * @param {HTMLElement} container
 * @param {OverviewBlock[]} blocks
 * @param {(text: string) => string} [formatText]
 */
export function renderOverviewBlocks(container, blocks, formatText = value => value) {
  container.replaceChildren(...(blocks || []).map(block => createBlock(block, formatText)));
}

function createBlock(block, formatText) {
  if (block.type === 'heading') {
    const heading = document.createElement(block.level <= 2 ? 'h4' : block.level <= 4 ? 'h5' : 'h6');
    heading.className = 'ai-summary-overview-heading';
    appendSpans(heading, block.spans, formatText);
    return heading;
  }
  if (block.type === 'paragraph') {
    const paragraph = document.createElement('p');
    paragraph.className = 'ai-summary-overview-paragraph';
    appendSpans(paragraph, block.spans, formatText);
    return paragraph;
  }
  if (block.type === 'list') {
    const list = document.createElement(block.ordered ? 'ol' : 'ul');
    list.className = 'ai-summary-overview-list';
    (block.items || []).forEach(spans => {
      const item = document.createElement('li');
      appendSpans(item, spans, formatText);
      list.append(item);
    });
    return list;
  }
  const pre = document.createElement('pre');
  pre.className = 'ai-summary-overview-code';
  const code = document.createElement('code');
  code.textContent = formatText(block.text);
  pre.append(code);
  return pre;
}

function appendSpans(parent, spans, formatText) {
  (spans || []).forEach(span => {
    let node = document.createTextNode(formatText(span.text));
    const tags = [];
    if (span.marks?.includes('code')) tags.push('code');
    if (span.marks?.includes('strong')) tags.push('strong');
    if (span.marks?.includes('em')) tags.push('em');
    tags.forEach(tagName => {
      const element = document.createElement(tagName);
      element.append(node);
      node = element;
    });
    parent.append(node);
  });
}
