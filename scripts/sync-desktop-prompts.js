#!/usr/bin/env node

/**
 * Synchronize built-in prompt mode definitions from the Chrome extension
 * (_locales/zh_CN/messages.json, _locales/en/messages.json and
 * modules/prompts/prompt-modes.js) into the macOS desktop client's Swift
 * source (PromptModeDefinitions.swift).
 *
 * This establishes a single source of truth: extension localization files and
 * module definitions are canonical, and desktop client definitions are
 * generated. Both languages ship in the generated file; the client picks one
 * from the macOS system language at runtime.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_MODES } from '../modules/prompts/prompt-modes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

export const TARGET_SWIFT_PATH = resolve(
  REPO_ROOT,
  'desktop/macos/Sources/PanelizeSearchCore/Composer/PromptModeDefinitions.swift'
);
export const LOCALES_ZH_CN_PATH = resolve(REPO_ROOT, '_locales/zh_CN/messages.json');
export const LOCALES_EN_PATH = resolve(REPO_ROOT, '_locales/en/messages.json');

const LOCALE_DIRS = {
  zh: 'zh_CN',
  en: 'en'
};

/**
 * Normalizes multi-line instruction text into a single line with whitespace collapsed.
 * Mirrors oneLine() in PromptModePreview.swift.
 *
 * @param {string} text
 * @returns {string}
 */
export function collapseToOneLine(text) {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Escapes a string literal for inclusion in Swift source code.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeSwiftString(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

/**
 * Reads one required localized message.
 *
 * @param {Record<string, { message?: string }>} locales
 * @param {string} key
 * @param {string} localeDir
 * @returns {string}
 */
function readMessage(locales, key, localeDir) {
  const message = locales?.[key]?.message;
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error(
      `[sync-desktop-prompts] Missing or empty "${key}" in _locales/${localeDir}/messages.json`
    );
  }
  return message;
}

/**
 * Builds the locale-independent prompt mode data used by the Swift generator.
 *
 * @param {{
 *   localesZh?: Record<string, { message?: string }>,
 *   localesEn?: Record<string, { message?: string }>,
 *   locales?: Record<string, { message?: string }>,
 *   promptModes?: typeof PROMPT_MODES
 * }} [options]
 * @returns {{
 *   autoTriggerLegend: { zh: string, en: string },
 *   modesInMenuOrder: string[],
 *   triggers: Record<string, string[]>,
 *   titles: Record<string, { zh: string, en: string }>,
 *   hints: Record<string, { zh: string, en: string }>,
 *   instructions: Record<string, { zh: string, en: string }>
 * }}
 */
export function buildPromptModeData(options = {}) {
  const localesZh = options.localesZh
    || options.locales
    || JSON.parse(readFileSync(LOCALES_ZH_CN_PATH, 'utf8'));
  const localesEn = options.localesEn
    || JSON.parse(readFileSync(LOCALES_EN_PATH, 'utf8'));
  const promptModes = options.promptModes || PROMPT_MODES;

  const readers = {
    zh: key => collapseToOneLine(readMessage(localesZh, key, LOCALE_DIRS.zh)),
    en: key => collapseToOneLine(readMessage(localesEn, key, LOCALE_DIRS.en))
  };
  const textPair = key => ({ zh: readers.zh(key), en: readers.en(key) });

  const entries = [
    {
      id: 'defaultMode',
      titleKey: 'promptModeDefault',
      hintKey: 'promptModeDefaultHint'
    },
    {
      id: 'auto',
      titleKey: 'promptModeAuto',
      hintKey: 'promptModeAutoHint'
    },
    ...promptModes.map(mode => ({
      id: mode.id,
      titleKey: mode.labelKey,
      hintKey: mode.hintKey
    }))
  ];

  const titles = {};
  const hints = {};
  for (const entry of entries) {
    titles[entry.id] = textPair(entry.titleKey);
    hints[entry.id] = textPair(entry.hintKey);
  }

  const instructions = {};
  for (const mode of promptModes) {
    instructions[mode.id] = textPair(`promptModeSuffix_${mode.id}`);
  }

  const legend = language => promptModes
    .map(mode => `${mode.triggers[0]} ${readers[language](mode.labelKey)}`)
    .join(' · ');

  return {
    autoTriggerLegend: { zh: legend('zh'), en: legend('en') },
    modesInMenuOrder: promptModes.map(mode => mode.id),
    triggers: Object.fromEntries(promptModes.map(mode => [mode.id, mode.triggers])),
    titles,
    hints,
    instructions
  };
}

/**
 * Formats a bilingual string pair as a PromptModeText initializer.
 *
 * @param {{ zh: string, en: string }} pair
 * @param {string} indent
 * @returns {string}
 */
function formatTextPair(pair, indent) {
  const inner = `${indent}    `;
  return [
    'PromptModeText(',
    `${inner}zh: "${escapeSwiftString(pair.zh)}",`,
    `${inner}en: "${escapeSwiftString(pair.en)}"`,
    `${indent})`
  ].join('\n');
}

/**
 * Formats a dictionary of bilingual strings keyed by PromptModeChoice case.
 *
 * @param {Record<string, { zh: string, en: string }>} entries
 * @param {string} keyPrefix - Swift case name prefix, e.g. `.`.
 * @returns {string}
 */
function formatTextDictionary(entries, keyPrefix = '.') {
  const all = Object.entries(entries);
  return all.map(([key, pair], index) => {
    const indent = '        ';
    const comma = index < all.length - 1 ? ',' : '';
    return `${indent}${keyPrefix}${key}: ${formatTextPair(pair, indent)}${comma}`;
  }).join('\n');
}

/**
 * Generates the Swift source code for PromptModeDefinitions.swift.
 *
 * @param {{
 *   localesZh?: Record<string, { message?: string }>,
 *   localesEn?: Record<string, { message?: string }>,
 *   locales?: Record<string, { message?: string }>,
 *   promptModes?: typeof PROMPT_MODES
 * }} [options]
 * @returns {string}
 */
export function generatePromptModeDefinitionsSwift(options = {}) {
  const data = buildPromptModeData(options);

  const modesInMenuOrder = data.modesInMenuOrder.map(id => `.${id}`).join(', ');

  const triggersLines = Object.entries(data.triggers).map(([id, triggers]) => {
    const formattedTriggers = triggers.map(t => `"${escapeSwiftString(t)}"`).join(', ');
    return `        .${id}: [${formattedTriggers}]`;
  }).join(',\n');

  return `// Generated by scripts/sync-desktop-prompts.js - DO NOT EDIT MANUALLY.
// Single source of truth: _locales/zh_CN/messages.json,
// _locales/en/messages.json & modules/prompts/prompt-modes.js
import Foundation

public enum PromptModeDefinitions {
    /// Auto's fallback hint when the question contains no trigger word. The
    /// trigger names follow the extension's menu order.
    public static let autoTriggerLegend = ${formatTextPair(data.autoTriggerLegend, '    ')}

    /// Built-in prompt modes in menu order.
    public static let modesInMenuOrder: [PromptModeChoice] = [
        ${modesInMenuOrder}
    ]

    /// Built-in trigger words for each mode.
    public static let triggers: [PromptModeChoice: [String]] = [
${triggersLines}
    ]

    /// Localized titles for every menu choice, including Default and Auto.
    public static let titles: [PromptModeChoice: PromptModeText] = [
${formatTextDictionary(data.titles)}
    ]

    /// Localized explanations shown under each mode and below the picker.
    public static let hints: [PromptModeChoice: PromptModeText] = [
${formatTextDictionary(data.hints)}
    ]

    /// The shipped instructions from both locale files (promptModeSuffix_<mode>),
    /// normalized to a single line for the composer preview.
    public static let instructions: [PromptModeChoice: PromptModeText] = [
${formatTextDictionary(data.instructions)}
    ]
}
`;
}

/**
 * Checks if the existing Swift file matches the generated definitions.
 *
 * @returns {boolean}
 */
export function checkDesktopPromptsInSync() {
  const currentContent = readFileSync(TARGET_SWIFT_PATH, 'utf8');
  const expectedContent = generatePromptModeDefinitionsSwift();
  return currentContent === expectedContent;
}

/**
 * Main execution handler.
 */
export function main() {
  try {
    const isCheck = process.argv.includes('--check');

    if (isCheck) {
      if (!checkDesktopPromptsInSync()) {
        console.error(
          '[sync-desktop-prompts] Mismatch found in PromptModeDefinitions.swift.\n' +
          'Run "npm run sync:prompts" to regenerate from extension prompt modes.'
        );
        process.exit(1);
      }
      console.log('[sync-desktop-prompts] Desktop prompt definitions are in sync.');
      return;
    }

    const generated = generatePromptModeDefinitionsSwift();
    writeFileSync(TARGET_SWIFT_PATH, generated, 'utf8');
    console.log('[sync-desktop-prompts] Generated PromptModeDefinitions.swift successfully.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isEntrypoint) {
  main();
}