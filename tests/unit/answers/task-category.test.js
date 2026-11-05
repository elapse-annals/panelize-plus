import { describe, expect, it } from 'vitest';
import { classifyTask, TASK_CATEGORIES } from '../../../modules/answers/task-category.js';

describe('classifyTask', () => {
  it('exposes the supported categories in stable order', () => {
    expect(TASK_CATEGORIES).toEqual(['coding', 'writing', 'translation', 'qa', 'other']);
  });

  it.each([
    ['翻译成英文：今天天气很好。', 'translation'],
    ['Translate this paragraph into English', 'translation'],
    ['Could you put it IN English?', 'translation'],
    ['Please translate this to Chinese', 'translation'],
    ['请用英文回答这个问题', 'translation'],
    ['如何修复这个 bug？', 'coding'],
    ['Why does this function return null?', 'coding'],
    ['Implement the SQL query', 'coding'],
    ['Import the module and call def run()', 'coding'],
    ['Explain this code: ```const x = 1```', 'coding'],
    ['写一篇关于春天的作文', 'writing'],
    ['Please polish this email draft', 'writing'],
    ['Write an email to the team', 'writing'],
    ['EMAIL subject line ideas', 'writing'],
    ['为什么天空是蓝色的？', 'qa'],
    ['What is a closure?', 'qa'],
    ['how do I reset it', 'qa'],
    ['This somehow works', 'other'],
    ['We can do this anyhow', 'other'],
    ['这个决定是错误的吗？', 'qa'],
    ['Explain photosynthesis', 'other'],
    ['', 'other'],
    [null, 'other']
  ])('classifies %j as %s', (prompt, expected) => {
    expect(classifyTask(prompt)).toBe(expected);
  });

  it('applies translation, coding and writing priority in order', () => {
    expect(classifyTask('Translate this code: function greet() {}')).toBe('translation');
    expect(classifyTask('Write a draft explaining this bug')).toBe('coding');
    expect(classifyTask('请用英文写一封邮件')).toBe('translation');
  });

  it('recognizes dense code punctuation without misclassifying ordinary punctuation', () => {
    expect(classifyTask('const x = foo(bar);')).toBe('coding');
    expect(classifyTask('What is 2 + 2?')).toBe('qa');
    expect(classifyTask('The list [one, two]; what do you think?')).toBe('qa');
    expect(classifyTask('Thanks! That helps.')).toBe('other');
    expect(classifyTask('However, the answer is simple.')).toBe('other');
  });
});
