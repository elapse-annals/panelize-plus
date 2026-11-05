// Lightweight local categorization for answer statistics. Keep these rules
// deterministic and independent of provider responses.
export const TASK_CATEGORIES = Object.freeze(['coding', 'writing', 'translation', 'qa', 'other']);

const TRANSLATION_PATTERN = /翻译|译成|翻成|用英文|translate|translation|into\s+english|in\s+english/i;
const CODING_PATTERN = /```|(?:\b(?:function|class|def|import|sql|bug|code|regex)\b)|报错|代码|函数|正则|堆栈|stack\s+trace/i;
const WRITING_PATTERN = /写一篇|写一封|润色|改写|文案|邮件|作文|\b(?:email|rewrite|draft|essay|polish|copywriting)\b/i;
const QUESTION_START_PATTERN = /^(?:什么|为什么|如何|是否|what\b|why\b|how\b)/i;
const QUESTION_END_PATTERN = /(?:什么|为什么|如何|是否|(?:^|[^a-z])(?:what|why|how))[?？.!。！]?$/i;
const QUESTION_MARK_PATTERN = /[?？]/;

function hasHighSymbolDensity(text) {
  const visible = text.replace(/\s/g, '');
  if (visible.length < 6) return false;
  const symbols = (visible.match(/[{}\[\]();=<>`]|=>|->|::|\$\w+/g) || []).join('').length;
  return symbols >= 3 && symbols / visible.length >= 0.22;
}

/** Classifies a prompt using local bilingual keyword and punctuation rules. */
export function classifyTask(text) {
  const prompt = typeof text === 'string' ? text.trim() : '';
  if (!prompt) return 'other';

  if (TRANSLATION_PATTERN.test(prompt)) return 'translation';
  if (CODING_PATTERN.test(prompt) || hasHighSymbolDensity(prompt)) return 'coding';
  if (WRITING_PATTERN.test(prompt)) return 'writing';
  if (QUESTION_MARK_PATTERN.test(prompt) || QUESTION_START_PATTERN.test(prompt) || QUESTION_END_PATTERN.test(prompt)) {
    return 'qa';
  }
  return 'other';
}
