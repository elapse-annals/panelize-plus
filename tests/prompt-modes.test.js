import { describe, expect, it, vi } from 'vitest';
import {
  COMPETE_PROMPT_TEXTS,
  COMPETE_PROMPT_MIGRATED_KEY,
  DEFAULT_PROMPT_MODE,
  PROMPT_MODES,
  PROMPT_MODE_IDS,
  PROMPT_MODES_SEEDED_KEY,
  PROMPT_MODES_SEEDED_IDS_KEY,
  PROMPT_MODE_TRIGGERS_SEEDED_KEY,
  applyPromptMode,
  createModeKey,
  describePromptSend,
  detectPromptModeTriggers,
  findPromptTriggerCompletion,
  cleanupSamplePrompts,
  ensureDefaultModePrompts,
  ensureDefaultModeTriggers,
  migrateCompetePrompt,
  normalizePromptTriggers,
  restoreDefaultModePrompts,
  resolvePromptModeForText,
  getDefaultModePrompts,
  getPromptAiContent,
  getPromptDisplayContent,
  getPromptMode,
  getPromptModeSuffix,
  isPromptMode,
  selectModePrompts
} from '../modules/prompt-modes.js';

// Mirrors getLocalizedText: a missing locale string falls back to English.
const translate = (key, fallback) => fallback;

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: vi.fn(async key => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async values => { Object.assign(data, values); })
  };
}

function memoryLibrary(initial = []) {
  const prompts = [...initial];
  return {
    prompts,
    getAllPrompts: vi.fn(async () => [...prompts]),
    savePrompt: vi.fn(async prompt => { prompts.push({ ...prompt, id: prompts.length + 1 }); })
  };
}

describe('built-in prompt modes', () => {
  it('lists the built-in modes in seed order', () => {
    expect(PROMPT_MODE_IDS).toEqual(['concise', 'learning', 'compete', 'brainstorm', 'deep']);
  });

  it('recognises only the built-in modes', () => {
    PROMPT_MODE_IDS.forEach(mode => expect(isPromptMode(mode)).toBe(true));
    [null, undefined, '', 'verbose', 'Learning', 0].forEach(value => expect(isPromptMode(value)).toBe(false));
  });

  it('uses a wire-only Default sentinel that is not a prompt mode', () => {
    expect(DEFAULT_PROMPT_MODE).toBe('default');
    expect(isPromptMode(DEFAULT_PROMPT_MODE)).toBe(false);
  });

  it('names the compete mode Challenge', () => {
    expect(getPromptMode('compete').label).toBe('Challenge');
  });

  it('gives every mode a label and hint with locale keys', () => {
    expect(PROMPT_MODES.map(mode => mode.id)).toEqual(PROMPT_MODE_IDS);
    PROMPT_MODES.forEach(mode => {
      expect(getPromptMode(mode.id)).toBe(mode);
      expect(mode.labelKey).toMatch(/^promptMode[A-Z]/);
      expect(mode.hintKey).toBe(`${mode.labelKey}Hint`);
      expect(mode.label && mode.hint).toBeTruthy();
    });
    expect(getPromptMode('verbose')).toBeNull();
  });

  it('uses the locale string for the built-in instruction', () => {
    const tr = (key, fallback) => (key === 'promptModeSuffix_compete' ? '比较一下。' : fallback);

    expect(getPromptModeSuffix('compete', tr)).toBe('比较一下。');
    expect(getPromptModeSuffix('learning', () => '')).toContain('Answer as a teacher');
    expect(getPromptModeSuffix('deep', translate)).toBe('Think step by step: break the problem down, identify assumptions, analyze root causes, compare options and verify in reverse; before the final conclusion, list your reasoning steps in detail and state any uncertainty.');
    expect(getPromptModeSuffix(null, translate)).toBe('');
    expect(getPromptModeSuffix('verbose', translate)).toBe('');
  });

  it('ships the adversarial Challenge instruction as the built-in text', () => {
    expect(getPromptModeSuffix('compete', translate)).toBe(COMPETE_PROMPT_TEXTS.current.en);
    expect(getDefaultModePrompts(translate).find(prompt => prompt.modeKey === 'compete').content)
      .toBe(COMPETE_PROMPT_TEXTS.current.en);
  });
});

describe('applyPromptMode', () => {
  it.each([null, undefined, '', '   '])('leaves the question alone without an instruction (%j)', (instruction) => {
    expect(applyPromptMode('Explain closures', instruction)).toBe('Explain closures');
  });

  it.each(['', '   ', '\n\n'])('adds nothing to empty text (%j)', (text) => {
    expect(applyPromptMode(text, 'Be brief.')).toBe(text);
  });

  it('appends the instruction after a blank line', () => {
    expect(applyPromptMode('Explain closures', 'Be brief.')).toBe('Explain closures\n\nBe brief.');
  });

  it('keeps the user text verbatim, including its own line breaks', () => {
    const text = 'Line one\n\nLine two';

    expect(applyPromptMode(text, 'Be brief.')).toBe(`${text}\n\nBe brief.`);
  });
});

describe('prompt text helpers', () => {
  it('shows the Chinese text and falls back to the English one', () => {
    expect(getPromptDisplayContent({ content: '中文', contentEn: 'English' })).toBe('中文');
    expect(getPromptDisplayContent({ content: '   ', contentEn: ' English ' })).toBe('English');
    expect(getPromptDisplayContent({ content: '中文' })).toBe('中文');
    expect(getPromptDisplayContent({ contentEn: 'English' })).toBe('English');
    expect(getPromptDisplayContent({})).toBe('');
    expect(getPromptDisplayContent(null)).toBe('');
  });

  it('sends the English text and falls back to the Chinese one', () => {
    expect(getPromptAiContent({ content: '中文', contentEn: 'English' })).toBe('English');
    expect(getPromptAiContent({ content: ' 中文 ', contentEn: '  ' })).toBe('中文');
    expect(getPromptAiContent({ content: '中文' })).toBe('中文');
    expect(getPromptAiContent({ contentEn: 'English' })).toBe('English');
    expect(getPromptAiContent({})).toBe('');
    expect(getPromptAiContent(undefined)).toBe('');
  });

  it('ignores text fields that are not strings', () => {
    expect(getPromptDisplayContent({ content: 3, contentEn: 'English' })).toBe('English');
    expect(getPromptAiContent({ content: '中文', contentEn: 3 })).toBe('中文');
  });
});

describe('mode prompts in the library', () => {
  it('lists only prompts marked as modes, oldest first', () => {
    const prompts = [
      { id: 1, title: 'Plain', content: 'x', createdAt: 1 },
      { id: 2, title: 'B', content: 'b', isMode: true, modeKey: 'b', createdAt: 20 },
      { id: 3, title: 'A', content: 'a', isMode: true, modeKey: 'a', createdAt: 10 },
      { id: 4, title: 'No key', content: 'n', isMode: true, createdAt: 5 },
      { id: 5, title: 'Blank', content: '  ', isMode: true, modeKey: 'blank', createdAt: 6 },
      { id: 6, title: 'Unticked', content: 'u', isMode: false, modeKey: 'u', createdAt: 7 }
    ];

    expect(selectModePrompts(prompts).map(prompt => prompt.title)).toEqual(['A', 'B']);
    expect(selectModePrompts(null)).toEqual([]);
  });

  it('puts built-in modes first in menu order and shows each modeKey once', () => {
    const prompts = [
      { id: 1, title: 'Mine', content: 'm', isMode: true, modeKey: 'custom-1', createdAt: 1 },
      { id: 2, title: 'Learning', content: 'l', isMode: true, modeKey: 'learning', createdAt: 2 },
      { id: 3, title: 'Concise', content: 'c', isMode: true, modeKey: 'concise', createdAt: 3 },
      { id: 4, title: 'Learning copy', content: 'l2', isMode: true, modeKey: 'learning', createdAt: 4 },
      { id: 5, title: 'Brainstorm', content: 'b', isMode: true, modeKey: 'brainstorm', createdAt: 5 },
      { id: 6, title: 'Challenge', content: 'x', isMode: true, modeKey: 'compete', createdAt: 6 },
      { id: 7, title: 'Deep thinking', content: 'd', isMode: true, modeKey: 'deep', createdAt: 7 }
    ];

    expect(selectModePrompts(prompts).map(prompt => prompt.title))
      .toEqual(['Concise', 'Learning', 'Challenge', 'Brainstorm', 'Deep thinking', 'Mine']);
  });

  it('lists a mode that only has English text, and skips one with neither', () => {
    const prompts = [
      { id: 1, title: 'English only', content: '', contentEn: 'Answer in English.', isMode: true, modeKey: 'en', createdAt: 1 },
      { id: 2, title: 'Empty', content: '   ', contentEn: '  ', isMode: true, modeKey: 'empty', createdAt: 2 }
    ];

    expect(selectModePrompts(prompts).map(prompt => prompt.title)).toEqual(['English only']);
  });

  it('creates distinct custom mode keys', () => {
    const key = createModeKey();

    expect(key).toMatch(/^custom-/);
    expect(createModeKey()).not.toBe(key);
  });

  it('builds the built-ins as mode prompts keyed by their legacy ids', () => {
    const tr = (key, fallback) => ({ promptModeCompete: '挑战', promptModeCategory: '模式' }[key] || fallback);
    const prompts = getDefaultModePrompts(tr);

    expect(prompts.map(prompt => prompt.modeKey)).toEqual(PROMPT_MODE_IDS);
    prompts.forEach(prompt => {
      expect(prompt.isMode).toBe(true);
      expect(prompt.category).toBe('模式');
      expect(prompt.content).toBe(getPromptModeSuffix(prompt.modeKey, tr));
    });
    expect(prompts[2].title).toBe('挑战');
    expect(selectModePrompts(prompts).map(prompt => prompt.modeKey)).toEqual(PROMPT_MODE_IDS);
  });

  it('seeds the built-ins once per device', async () => {
    const storage = memoryStorage();
    const library = memoryLibrary();

    expect(await ensureDefaultModePrompts({ ...library, storage, tr: translate })).toBe(true);
    expect(library.prompts.map(prompt => prompt.modeKey)).toEqual(PROMPT_MODE_IDS);
    expect(storage.data[PROMPT_MODES_SEEDED_KEY]).toBe(true);
    expect(storage.data[PROMPT_MODES_SEEDED_IDS_KEY]).toEqual(PROMPT_MODE_IDS);

    // A mode the user deleted stays deleted after its ID has been recorded.
    library.prompts.splice(0, 1);
    expect(await ensureDefaultModePrompts({ ...library, storage, tr: translate })).toBe(false);
    expect(library.prompts).toHaveLength(4);
  });

  it('migrates a legacy seed by adding only deep and records all mode IDs', async () => {
    const legacyModes = getDefaultModePrompts(translate)
      .filter(prompt => prompt.modeKey !== 'deep' && prompt.modeKey !== 'concise');
    const library = memoryLibrary(legacyModes);
    const storage = memoryStorage({ [PROMPT_MODES_SEEDED_KEY]: true });

    expect(await ensureDefaultModePrompts({ ...library, storage, tr: translate })).toBe(true);
    expect(library.prompts.map(prompt => prompt.modeKey)).toEqual([
      'learning', 'compete', 'brainstorm', 'deep'
    ]);
    expect(storage.data[PROMPT_MODES_SEEDED_IDS_KEY]).toEqual(PROMPT_MODE_IDS);
    // The missing concise prompt was deleted before this upgrade and stays deleted.
    expect(library.prompts.some(prompt => prompt.modeKey === 'concise')).toBe(false);
  });

  it('does not duplicate an existing deep mode while migrating legacy storage', async () => {
    const existingDeep = {
      title: 'My deep mode', content: 'Customized.', isMode: true, modeKey: 'deep'
    };
    const library = memoryLibrary([existingDeep]);
    const storage = memoryStorage({ [PROMPT_MODES_SEEDED_KEY]: true });

    await ensureDefaultModePrompts({ ...library, storage, tr: translate });

    expect(library.prompts.filter(prompt => prompt.modeKey === 'deep')).toEqual([existingDeep]);
    expect(storage.data[PROMPT_MODES_SEEDED_IDS_KEY]).toEqual(PROMPT_MODE_IDS);
  });

  it('keeps a deleted deep mode deleted after migration', async () => {
    const library = memoryLibrary(getDefaultModePrompts(translate)
      .filter(prompt => prompt.modeKey !== 'deep'));
    const storage = memoryStorage({ [PROMPT_MODES_SEEDED_KEY]: true });

    expect(await ensureDefaultModePrompts({ ...library, storage, tr: translate })).toBe(true);
    expect(library.prompts.map(prompt => prompt.modeKey)).toEqual(['concise', 'learning', 'compete', 'brainstorm', 'deep']);
    library.prompts.splice(library.prompts.findIndex(prompt => prompt.modeKey === 'deep'), 1);

    expect(await ensureDefaultModePrompts({ ...library, storage, tr: translate })).toBe(false);
    expect(library.prompts.some(prompt => prompt.modeKey === 'deep')).toBe(false);
  });

  it('skips built-ins the library already holds', async () => {
    const library = memoryLibrary([{ id: 1, title: 'Mine', content: 'mine', isMode: true, modeKey: 'concise' }]);

    await ensureDefaultModePrompts({ ...library, storage: memoryStorage(), tr: translate });

    expect(library.prompts.filter(prompt => prompt.modeKey === 'concise')).toHaveLength(1);
    expect(library.prompts).toHaveLength(5);
  });

  it('does nothing without storage', async () => {
    const library = memoryLibrary();

    expect(await ensureDefaultModePrompts({ ...library, storage: undefined })).toBe(false);
    expect(library.savePrompt).not.toHaveBeenCalled();
  });
});

describe('restoring built-in modes', () => {
  it('adds only the built-ins the library lacks', async () => {
    const library = memoryLibrary([{ id: 1, title: 'Mine', content: 'mine', isMode: true, modeKey: 'concise' }]);

    expect(await restoreDefaultModePrompts({ ...library, tr: translate })).toBe(4);
    expect(library.prompts.map(prompt => prompt.modeKey).sort()).toEqual(['brainstorm', 'compete', 'concise', 'deep', 'learning']);
    expect(await restoreDefaultModePrompts({ ...library, tr: translate })).toBe(0);
    expect(library.savePrompt).toHaveBeenCalledTimes(4);
  });
});

describe('prompt send preview', () => {
  const prompts = [
    { modeKey: 'learning', content: 'Teach.', triggers: ['/study'] },
    { modeKey: 'concise', content: 'Be brief.', triggers: ['/brief'] }
  ];

  it('shows the appended instruction after the text outside Auto mode', () => {
    expect(describePromptSend('Explain closures', { instruction: 'Teach.' }))
      .toEqual([{ kind: 'text', value: 'Explain closures' }, { kind: 'suffix', value: '\n\nTeach.' }]);
  });

  it('marks removed trigger words in Auto mode', () => {
    expect(describePromptSend('/study what is a closure?', { auto: true, modePrompts: prompts })).toEqual([
      { kind: 'removed', value: '/study' },
      { kind: 'text', value: ' what is a closure?' },
      { kind: 'suffix', value: '\n\nTeach.' }
    ]);
  });

  it('shows nothing when nothing is appended or the text is empty', () => {
    expect(describePromptSend('Plain question', { auto: true, modePrompts: prompts })).toBeNull();
    expect(describePromptSend('   ', { instruction: 'Teach.' })).toBeNull();
    expect(describePromptSend('/study', { auto: true, modePrompts: prompts })).toBeNull();
    expect(describePromptSend('Plain question', { instruction: null })).toBeNull();
  });

  it('previews the Chinese instruction while the send uses the English one', () => {
    const bilingual = {
      modeKey: 'learning', content: '像老师一样回答。', contentEn: 'Answer as a teacher.', triggers: ['/study']
    };
    const options = {
      instruction: getPromptAiContent(bilingual),
      displayInstruction: getPromptDisplayContent(bilingual)
    };

    expect(describePromptSend('Explain closures', options)).toEqual([
      { kind: 'text', value: 'Explain closures' },
      { kind: 'suffix', value: '\n\n像老师一样回答。' }
    ]);
    expect(describePromptSend('/study Explain closures', { auto: true, modePrompts: [bilingual] })).toEqual([
      { kind: 'removed', value: '/study' },
      { kind: 'text', value: ' Explain closures' },
      { kind: 'suffix', value: '\n\n像老师一样回答。' }
    ]);
    // Without a display text the preview falls back to the instruction itself.
    expect(describePromptSend('Explain closures', { instruction: 'Answer as a teacher.' })).toEqual([
      { kind: 'text', value: 'Explain closures' },
      { kind: 'suffix', value: '\n\nAnswer as a teacher.' }
    ]);
  });
});

describe('trigger word completion', () => {
  const prompts = [
    { title: 'Learning', triggers: ['/study', '/learn'] },
    { title: 'Concise', triggers: ['/brief'] },
    { title: 'Brainstorm', triggers: ['/brainstorm'] }
  ];
  const complete = (text, caret = text.length) => findPromptTriggerCompletion(text, caret, prompts);

  it('completes the trigger word typed at the end of a line', () => {
    expect(complete('/st')).toMatchObject({ start: 0, end: 3, trigger: '/study', rest: 'udy', prompt: prompts[0] });
    expect(complete('why /LE')).toMatchObject({ start: 4, trigger: '/learn', rest: 'arn' });
    expect(complete('问题/st')).toMatchObject({ start: 2, rest: 'udy' });
    expect(complete('/st\nmore', 3)).toMatchObject({ rest: 'udy' });
  });

  it('picks the first match in menu order', () => {
    expect(complete('/b')).toMatchObject({ trigger: '/brief', prompt: prompts[1] });
    expect(complete('/bra')).toMatchObject({ trigger: '/brainstorm' });
  });

  it('offers nothing for full words, paths, bare slashes or text after the caret', () => {
    expect(complete('/study')).toBeNull();
    expect(complete('a/st')).toBeNull();
    expect(complete('https://x.com/st')).toBeNull();
    expect(complete('/')).toBeNull();
    expect(complete('/xyz')).toBeNull();
    expect(complete('/st more', 3)).toBeNull();
    expect(complete('/st', 2)).toBeNull();
    expect(findPromptTriggerCompletion('/st', 3, null)).toBeNull();
  });
});

describe('prompt mode trigger words', () => {
  const prompts = [
    { modeKey: 'learning', content: 'Teach.', triggers: ['/study', '/学习'] },
    { modeKey: 'concise', content: 'Be brief.', triggers: ['/brief'] },
    { modeKey: 'plain', content: 'No triggers.' }
  ];

  it('stores triggers lowercase with a leading slash and no duplicates', () => {
    expect(normalizePromptTriggers('study, /Learn  学习，/STUDY')).toEqual(['/study', '/learn', '/学习']);
    expect(normalizePromptTriggers(['/a', '', '/', 3, '/a'])).toEqual(['/a']);
    expect(normalizePromptTriggers(undefined)).toEqual([]);
  });

  it('matches whole words anywhere in the question and removes them', () => {
    expect(detectPromptModeTriggers('/study what is a closure?', prompts)).toEqual({ text: 'what is a closure?', prompts: [prompts[0]] });
    expect(detectPromptModeTriggers('what is a closure? /学习', prompts).text).toBe('what is a closure?');
    expect(detectPromptModeTriggers('line one\n/Brief', prompts)).toEqual({ text: 'line one', prompts: [prompts[1]] });
  });

  it('ignores triggers inside other words and paths', () => {
    const text = 'see /studying and a/study or /brief.';
    expect(detectPromptModeTriggers(text, prompts)).toEqual({ text, prompts: [] });
  });

  it('matches trigger words next to Chinese text and punctuation', () => {
    expect(detectPromptModeTriggers('/study，帮我解释闭包', prompts)).toEqual({ text: '，帮我解释闭包', prompts: [prompts[0]] });
    expect(detectPromptModeTriggers('闭包怎么用/study?', prompts).text).toBe('闭包怎么用?');
    expect(detectPromptModeTriggers('问题/学习的意义', prompts).text).toBe('问题的意义');
    expect(detectPromptModeTriggers('https://x.com/study', prompts).prompts).toEqual([]);
    expect(detectPromptModeTriggers('/study.md', prompts).prompts).toEqual([]);
  });

  it.each(['/think', '/deep'])('detects the deep-thinking trigger %s and previews its instruction', (trigger) => {
    const deepPrompt = getDefaultModePrompts(translate).find(prompt => prompt.modeKey === 'deep');
    const modePrompts = [deepPrompt];
    const instruction = getPromptDisplayContent(deepPrompt);

    expect(detectPromptModeTriggers(`${trigger} Explain closures`, modePrompts)).toEqual({
      text: 'Explain closures', prompts: [deepPrompt]
    });
    expect(describePromptSend(`${trigger} Explain closures`, { auto: true, modePrompts })).toEqual([
      { kind: 'removed', value: trigger },
      { kind: 'text', value: ' Explain closures' },
      { kind: 'suffix', value: `\n\n${instruction}` }
    ]);
  });

  it('combines the matched modes in menu order, once each', () => {
    const resolved = resolvePromptModeForText('/brief /study q /study', { auto: true, modePrompts: prompts });
    expect(resolved.text).toBe('q');
    expect(resolved.instruction).toBe('Teach.\n\nBe brief.');
  });

  it('passes the text and instruction through outside Auto mode', () => {
    expect(resolvePromptModeForText('/study q', { instruction: 'Fixed.', modePrompts: prompts }))
      .toEqual({ text: '/study q', instruction: 'Fixed.', prompts: [] });
  });

  it('combines the English text of the matched modes for the send', () => {
    const bilingual = [
      { modeKey: 'learning', content: '像老师一样回答。', contentEn: 'Answer as a teacher.', triggers: ['/study'] },
      { modeKey: 'concise', content: '尽量简洁。', contentEn: 'Be concise.', triggers: ['/brief'] }
    ];

    expect(resolvePromptModeForText('/study /brief q', { auto: true, modePrompts: bilingual }).instruction)
      .toBe('Answer as a teacher.\n\nBe concise.');
  });

  it('seeds built-in modes with their default triggers', () => {
    const seeded = getDefaultModePrompts(translate);
    expect(seeded.find(prompt => prompt.modeKey === 'learning').triggers).toContain('/study');
    seeded.forEach(prompt => expect(prompt.triggers.length).toBeGreaterThan(0));
  });

  it('adds default triggers once to built-in modes saved without them', async () => {
    const library = [
      { id: 1, modeKey: 'learning', isMode: true, content: 'Teach.' },
      { id: 2, modeKey: 'concise', isMode: true, content: 'Brief.', triggers: [] },
      { id: 3, modeKey: 'custom-x', isMode: true, content: 'Mine.' }
    ];
    const updatePrompt = vi.fn(async () => {});
    const storage = memoryStorage();
    const options = { getAllPrompts: async () => library, updatePrompt, storage };

    expect(await ensureDefaultModeTriggers(options)).toBe(true);
    expect(updatePrompt).toHaveBeenCalledExactlyOnceWith(1, { triggers: ['/study', '/learn'] });
    expect(storage.data[PROMPT_MODE_TRIGGERS_SEEDED_KEY]).toBe(true);
    expect(await ensureDefaultModeTriggers(options)).toBe(false);
    expect(updatePrompt).toHaveBeenCalledOnce();
  });
});

describe('migrating the built-in Challenge prompt', () => {
  const { previous, current } = COMPETE_PROMPT_TEXTS;
  const libraryWith = prompts => {
    const items = [...prompts];
    return {
      items,
      getAllPrompts: vi.fn(async () => items),
      updatePrompt: vi.fn(async (id, updates) => {
        Object.assign(items.find(prompt => prompt.id === id), updates);
      })
    };
  };
  const migrate = (library, storage = memoryStorage()) =>
    migrateCompetePrompt({ ...library, storage });

  it('rewrites the untouched Chinese instruction in place', async () => {
    const library = libraryWith([
      { id: 1, title: '挑战', modeKey: 'compete', isMode: true, content: previous.zh }
    ]);
    const storage = memoryStorage();

    expect(await migrate(library, storage)).toBe(1);
    expect(library.items[0].content).toBe(current.zh);
    expect(library.items[0].contentEn).toBeUndefined();
    expect(storage.data[COMPETE_PROMPT_MIGRATED_KEY]).toBe(true);
  });

  it('rewrites the untouched English instruction in place', async () => {
    const library = libraryWith([
      { id: 1, title: 'Challenge', modeKey: 'compete', isMode: true, content: previous.en }
    ]);

    expect(await migrate(library)).toBe(1);
    expect(library.items[0].content).toBe(current.en);
  });

  it('updates an old English contentEn while keeping an edited content', async () => {
    const library = libraryWith([
      { id: 1, title: 'Challenge', modeKey: 'compete', isMode: true, content: '我的自定义指令。', contentEn: previous.en }
    ]);

    expect(await migrate(library)).toBe(1);
    expect(library.items[0].content).toBe('我的自定义指令。');
    expect(library.items[0].contentEn).toBe(current.en);
  });

  it('never touches the same text under another modeKey', async () => {
    const library = libraryWith([
      { id: 1, modeKey: 'learning', isMode: true, content: previous.en },
      { id: 2, modeKey: 'custom-x', isMode: true, content: previous.zh }
    ]);
    const storage = memoryStorage();

    expect(await migrate(library, storage)).toBe(0);
    expect(library.updatePrompt).not.toHaveBeenCalled();
    expect(library.items.map(prompt => prompt.content)).toEqual([previous.en, previous.zh]);
    expect(storage.data[COMPETE_PROMPT_MIGRATED_KEY]).toBe(true);
  });

  it('keeps a renamed built-in prompt and updates its text', async () => {
    const library = libraryWith([
      { id: 1, title: 'Red team', modeKey: 'compete', isMode: true, content: previous.zh }
    ]);

    expect(await migrate(library)).toBe(1);
    expect(library.items[0].title).toBe('Red team');
    expect(library.items[0].content).toBe(current.zh);
  });

  it('updates every prompt still carrying the built-in modeKey', async () => {
    const library = libraryWith([
      { id: 1, modeKey: 'compete', content: previous.zh },
      { id: 2, modeKey: 'compete', content: previous.en }
    ]);

    expect(await migrate(library)).toBe(2);
    expect(library.items.map(prompt => prompt.content)).toEqual([current.zh, current.en]);
  });

  it('runs once per device', async () => {
    const library = libraryWith([{ id: 1, modeKey: 'compete', content: previous.zh }]);
    const storage = memoryStorage();

    expect(await migrate(library, storage)).toBe(1);
    expect(await migrate(library, storage)).toBe(0);
    expect(library.getAllPrompts).toHaveBeenCalledOnce();
  });

  it('does nothing without storage', async () => {
    const library = libraryWith([{ id: 1, modeKey: 'compete', content: previous.zh }]);

    expect(await migrateCompetePrompt(library)).toBe(0);
    expect(library.getAllPrompts).not.toHaveBeenCalled();
  });

  it('records the flag when the user deleted the mode', async () => {
    const library = libraryWith([{ id: 1, modeKey: 'concise', content: 'Be brief.' }]);
    const storage = memoryStorage();

    expect(await migrate(library, storage)).toBe(0);
    expect(storage.data[COMPETE_PROMPT_MIGRATED_KEY]).toBe(true);
  });
});

describe('cleaning up imported sample prompts', () => {
  const samples = [
    { title: 'Writing Coach', content: 'Improve   my writing.' },
    { title: '研究助手', content: '帮我做研究。' }
  ];
  const libraryWith = prompts => {
    const items = [...prompts];
    return {
      items,
      getAllPrompts: vi.fn(async () => [...items]),
      deletePrompt: vi.fn(async id => { items.splice(items.findIndex(prompt => prompt.id === id), 1); })
    };
  };

  it('removes unedited samples once and keeps modes, favorites and edited prompts', async () => {
    const library = libraryWith([
      { id: 1, title: 'Writing Coach', content: 'Improve my writing.' },
      { id: 2, title: '研究助手', content: '帮我做研究。', isFavorite: true },
      { id: 3, title: 'Writing Coach', content: 'Improve my writing, my way.' },
      { id: 4, title: '研究助手', content: '帮我做研究。', isMode: true, modeKey: 'custom-x' },
      { id: 5, title: 'Mine', content: 'Hello' }
    ]);
    const storage = memoryStorage();
    const loadSamples = vi.fn(async () => samples);

    expect(await cleanupSamplePrompts({ ...library, loadSamples, storage })).toBe(1);
    expect(library.items.map(prompt => prompt.id)).toEqual([2, 3, 4, 5]);
    expect(storage.data.samplePromptsCleanedV2).toBe(true);

    expect(await cleanupSamplePrompts({ ...library, loadSamples, storage })).toBe(0);
    expect(loadSamples).toHaveBeenCalledOnce();
  });

  it('does nothing without storage and leaves the flag unset when samples cannot load', async () => {
    const library = libraryWith([{ id: 1, title: 'Writing Coach', content: 'Improve my writing.' }]);
    const storage = memoryStorage();

    expect(await cleanupSamplePrompts({ ...library, loadSamples: async () => samples })).toBe(0);
    await expect(cleanupSamplePrompts({ ...library, storage, loadSamples: async () => { throw new Error('fetch'); } }))
      .rejects.toThrow('fetch');
    expect(storage.data.samplePromptsCleanedV2).toBeUndefined();
    expect(library.items).toHaveLength(1);
  });
});
