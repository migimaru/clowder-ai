const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const [mode, rootArg, flag] = process.argv.slice(2);
if (!['source', 'packaged', 'inventory'].includes(mode) || !rootArg || (flag && flag !== '--check')) {
  console.error('Usage: node localize.cjs <source|packaged|inventory> <Clowder AI root> [--check]');
  process.exit(1);
}

const root = path.resolve(rootArg);
const web = path.join(root, 'packages', 'web');
const source = mode === 'source';
const inventory = mode === 'inventory';
const checkOnly = flag === '--check';
const parser = [__dirname, root, 'C:\\Program Files\\ClowderAI'].reduce((found, directory) => {
  if (found) return found;
  try {
    return createRequire(path.join(directory, 'package.json'))('@babel/parser');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
}, undefined);
if (!parser) throw new Error('Install the localizer dependencies with npm ci in localization/.');

const dictionary = new Map();
for (const file of fs.readdirSync(__dirname).filter(name => /^ja-[\w-]+\.json$/.test(name))) {
  for (const [english, japanese] of Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')))) {
    if (!english || typeof japanese !== 'string' || !japanese) throw new Error(`Invalid translation in ${file}`);
    if (dictionary.has(english) && dictionary.get(english) !== japanese) {
      throw new Error(`Conflicting translations for ${JSON.stringify(english)} in ${file}`);
    }
    dictionary.set(english, japanese);
  }
}

const applied = new Set();
const catalogEntries = new Set();
const pending = new Map();
const integration = { preference: 0, copy: 0, document: 0, settings: 0, settingsLabels: 0,
  ...(source ? { navigation: 0, tests: 0, compatibility: 0 } : {}) };
let copies = 0;
let exactEdits = 0;

function filesUnder(directory, filter) {
  return fs.readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && filter(entry.name))
    .map(entry => path.join(entry.parentPath, entry.name));
}

function visit(node, callback, parent) {
  if (!node || typeof node.type !== 'string' || callback(node, parent) === false) return;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback, node));
    else visit(value, callback, node);
  }
}

function property(node, name) {
  return node.properties.find(item => item.type === 'ObjectProperty' && !item.computed &&
    (item.key.name === name || item.key.value === name));
}

function editRanges(text, edits) {
  let end = text.length;
  for (const [start, stop, replacement] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1])) {
    if (stop > end) throw new Error('Overlapping localization edits');
    text = text.slice(0, start) + replacement + text.slice(stop);
    end = start;
  }
  return text;
}

function translatedValue(node, text) {
  const changes = [];
  visit(node, (current, parent) => {
    let english;
    let format;
    if (current.type === 'StringLiteral') {
      if (parent && (parent.key === current || parent.type === 'BinaryExpression' ||
        parent.type === 'MemberExpression' || parent.test === current || parent.type.startsWith('TS'))) return;
      english = current.value;
      format = JSON.stringify;
    } else if (current.type === 'TemplateLiteral' && current.expressions.length &&
      current.quasis.every(part => part.value.cooked !== null)) {
      english = current.quasis.map((part, index) => `${index ? `{${index - 1}}` : ''}${part.value.cooked}`).join('');
      format = japanese => {
        const slots = [...japanese.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
        if (slots.length !== current.expressions.length || slots.some((slot, index) => slot !== index)) {
          throw new Error(`Keep template placeholders in order for ${JSON.stringify(english)}`);
        }
        const parts = japanese.split(/\{\d+\}/g).map(part => JSON.stringify(part).slice(1, -1)
          .replaceAll('`', '\\`').replaceAll('${', '\\${'));
        return '`' + parts.map((part, index) => index === 0 ? part :
          '${' + text.slice(current.expressions[index - 1].start, current.expressions[index - 1].end) + '}' + part).join('') + '`';
      };
    }
    if (english === undefined || !/\p{L}/u.test(english)) return;
    catalogEntries.add(english);
    const japanese = dictionary.get(english);
    if (japanese === undefined) return;
    changes.push([current.start - node.start, current.end - node.start, format(japanese)]);
    applied.add(english);
    return false;
  });
  return changes.length ? editRanges(text.slice(node.start, node.end), changes) : null;
}

function addJapaneseCatalogs(text) {
  const ast = parser.parse(text, { sourceType: 'unambiguous', plugins: source ? ['typescript'] : [] });
  const edits = [];
  visit(ast.program, node => {
    if (node.type !== 'CallExpression') return;
    if (source && node.callee.name !== 'defineShellCopy') return;
    const copy = node.arguments[0];
    if (copy?.type !== 'ObjectExpression' || copy.properties.length !== 2) return;
    const en = property(copy, 'en');
    const zh = property(copy, 'zh');
    if (en?.value.type !== 'ObjectExpression' || zh?.value.type !== 'ObjectExpression') return;
    // Compiled chunks have mangled callee names; require a matching bilingual object shape.
    if (en.value.properties.length !== zh.value.properties.length) return;
    const japanese = translatedValue(en.value, text);
    copies++;
    if (japanese) {
      const tail = text.slice(copy.properties.at(-1).end, copy.end - 1);
      const separator = /^\s*,/.test(tail) ? '' : ',';
      const insert = source ? `${separator}ja: ${japanese},\n` : `${separator}ja:${japanese}`;
      edits.push([copy.end - 1, copy.end - 1, insert]);
      exactEdits++;
    }
    return false;
  });
  const result = editRanges(text, edits);
  if (edits.length) parser.parse(result, { sourceType: 'unambiguous', plugins: source ? ['typescript'] : [] });
  return result;
}

function replaceOnce(text, before, after, file, role) {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) !== -1) {
    throw new Error(`${file}: expected exactly one ${role} integration point: ${before}`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function editSource(relative, role, replacements) {
  const file = path.join(web, 'src', relative);
  const original = pending.get(file) ?? fs.readFileSync(file, 'utf8');
  let result = original.replaceAll('\r\n', '\n');
  for (const [before, after] of replacements) {
    if (before instanceof RegExp) {
      if (!before.test(result)) throw new Error(`${relative}: missing ${role} integration point: ${before}`);
      before.lastIndex = 0;
      result = result.replace(before, after);
    } else result = replaceOnce(result, before, after, relative, role);
  }
  if (original.includes('\r\n')) result = result.replaceAll('\n', '\r\n');
  parser.parse(result, { sourceType: 'module', plugins: ['typescript', ...(relative.endsWith('.tsx') ? ['jsx'] : [])] });
  pending.set(file, result);
  integration[role]++;
}

function integrateSource() {
  editSource('components/shell/shell-language.ts', 'preference', [
    ["export type ShellLanguage = 'zh' | 'en';", "export type ShellLanguage = 'zh' | 'en' | 'ja';"],
    ["DEFAULT_SHELL_LANGUAGE: ShellLanguage = 'zh';",
      "DEFAULT_SHELL_LANGUAGE: ShellLanguage = process.env.NEXT_PUBLIC_CLOWDER_JAPANESE_DEFAULT === '1' ? 'ja' : 'zh';"],
    ["value === 'zh' || value === 'en'", "value === 'zh' || value === 'en' || value === 'ja'"],
    ['export function useShellLanguage(): ShellLanguage {', [
      "export function useBilingualShellLanguage(): 'zh' | 'en' {",
      "  return useShellLanguage() === 'zh' ? 'zh' : 'en';",
      '}',
      '',
      'export function useShellLanguage(): ShellLanguage {',
    ].join('\n')],
  ]);
  editSource('components/shell/shell-copy.ts', 'copy', [
    ['  readonly en: T;', '  readonly en: T;\n  readonly ja: T;'],
    ['readonly zh: T; readonly en: NoInfer<T>', 'readonly zh: T; readonly en: NoInfer<T>; readonly ja?: NoInfer<T>'],
    ['    en: copy.en,', '    en: copy.en,\n    ja: copy.ja ?? copy.en,'],
    ['return copy[language];', 'return copy[language] ?? copy.en;'],
  ]);
  editSource('components/shell/ShellDocumentLanguage.tsx', 'document', [
    ["language === 'en' ? 'en' : 'zh-CN'", "language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh-CN'"],
  ]);
  editSource('components/settings/ThemeSettingsPanel.tsx', 'settings', [
    ["['zh', 'en'];", "['zh', 'en', 'ja'];"],
    ["en: 'English' };", "en: 'English', ja: '日本語' };"],
    ["en: 'en' };", "en: 'en', ja: 'ja' };"],
    ['en: t.language.names.english,', "en: t.language.names.english,\n    ja: '日本語',"],
  ]);
  integration.settingsLabels++;
  editSource('components/shell/WorldRail.tsx', 'navigation', [
    ["import { useOpenDestination } from './use-open-destination';",
      "import { useOpenDestination } from './use-open-destination';\nimport { useShellLanguage } from './shell-language';"],
    ['export function WorldRail() {', "export function WorldRail() {\n  const japanese = useShellLanguage() === 'ja';"],
    ['aria-label="主导航"', 'aria-label={japanese ? "メインナビゲーション" : "主导航"}'],
    ["function CafeWorld({ selected, onOpen }: { selected: boolean; onOpen: () => void }) {",
      "function CafeWorld({ selected, onOpen }: { selected: boolean; onOpen: () => void }) {\n  const name = useShellLanguage() === 'ja' ? 'マイカフェ' : CAFE_NAME;"],
    ['ariaLabel={CAFE_NAME}\n      tip={CAFE_NAME}', 'ariaLabel={name}\n      tip={name}'],
    ['  const coCreator = useCoCreatorConfig();',
      "  const coCreator = useCoCreatorConfig();\n  const label = useShellLanguage() === 'ja' ? '設定' : '设置与管理';"],
    ['ariaLabel="设置与管理"\n      tip="设置与管理"', 'ariaLabel={label}\n      tip={label}'],
  ]);
  editSource('components/settings/__tests__/theme-settings-language.test.tsx', 'tests', [
    ["expect(group?.querySelectorAll('[role=\"radio\"]')).toHaveLength(2);",
      "expect(group?.querySelectorAll('[role=\"radio\"]')).toHaveLength(3);"],
    [".replace('中文（简体）', '').match(", ".replace('中文（简体）', '').replace('日本語', '').match("],
    ["  it('says the classic interface is not affected, in both languages', () => {", [
      "  it('persists Japanese and updates the UI on the same page', () => {",
      '    render();',
      '    click(\'[data-testid="shell-language-ja"]\');',
      "    expect(readShellLanguage()).toBe('ja');",
      "    expect(window.localStorage.getItem(SHELL_LANGUAGE_STORAGE_KEY)).toBe('ja');",
      '    expect(text(\'[data-testid="theme-settings-panel"] h2\')).toBe(\'テーマ\');',
      "    expect(text('#shell-language-heading')).toBe('言語');",
      '  });',
      '',
      "  it('says the classic interface is not affected, in both languages', () => {",
    ].join('\n')],
  ]);
  editSource('components/shell/__tests__/shell-language.test.tsx', 'tests', [
    ["only knows 中文 and English", "knows 中文, English, and Japanese"],
    ["    expect(parseShellLanguage('en')).toBe('en');",
      "    expect(parseShellLanguage('en')).toBe('en');\n    expect(parseShellLanguage('ja')).toBe('ja');"],
  ]);
  editSource('components/shell/__tests__/shell-copy-parity-check.test.ts', 'tests', [
    ["return { kind: 'shell-copy', zh, en, samples, grammar };", "return { kind: 'shell-copy', zh, en, ja: en, samples, grammar };"],
  ]);
  integrateExistingLanguageConsumers();
}

function integrateExistingLanguageConsumers() {
  for (const file of [
    'ChatComposerActions.tsx', 'ChatInputStickers.tsx', 'CliDiagnosticsPanel.tsx',
    'CodexStartupRecoveryStatus.tsx', 'ComposerRoutingPreview.tsx',
    'collective/use-collective-appearance-bridge.ts', 'collective/use-collective-text.ts',
    'workbench/content-review/VideoWorkMaterialPreview.tsx',
  ]) {
    editSource(`components/${file}`, 'compatibility', [[/\buseShellLanguage\b/g, 'useBilingualShellLanguage']]);
  }

  const desktopLanguageType = /\blanguage(:|\?:) 'zh' \| 'en'/g;
  for (const file of [
    'components/accounts/account-directory-view.ts', 'components/codex-accounts/CodexQuotaControl.tsx',
    'components/codex-accounts/QuotaQueryFeedback.tsx', 'components/rich/ScheduleApprovalContent.tsx',
    'components/shell/mailbox/HandledApprovalRow.tsx', 'components/shell/mailbox/mailbox-row-text.ts',
    'lib/approval-presentation.ts',
  ]) {
    editSource(file, 'compatibility', [
      [/^import/m, "import type { ShellLanguage } from '@/components/shell/shell-language';\nimport"],
      [desktopLanguageType, 'language$1 ShellLanguage'],
    ]);
  }

  const locale = "language === 'ja' ? 'ja-JP' : language === 'zh' ? 'zh-CN' : 'en-US'";
  for (const file of ['CodexQuotaControl.tsx', 'QuotaQueryFeedback.tsx']) {
    editSource(`components/codex-accounts/${file}`, 'compatibility', [
      ["language === 'zh' ? 'zh-CN' : 'en-US'", locale],
    ]);
  }
  for (const file of ['rich/ScheduleApprovalContent.tsx', 'shell/mailbox/HandledApprovalRow.tsx']) {
    editSource(`components/${file}`, 'compatibility', [["language === 'en' ? 'en-US' : 'zh-CN'", locale]]);
  }
  editSource('components/new-conversation/session-import-presentation.ts', 'compatibility', [
    ["  en: new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }),",
      "  en: new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }),\n  ja: new Intl.RelativeTimeFormat('ja-JP', { numeric: 'auto' }),"],
    ["language === 'zh' ? 'zh-CN' : 'en-US'", locale],
  ]);
  editSource('lib/approval-presentation.ts', 'compatibility', [
    ["  if (language === 'en') {", "  if (language !== 'zh') {"],
    ["if (minutes < 1) return 'just now';", "if (minutes < 1) return language === 'ja' ? 'たった今' : 'just now';"],
    ["new Intl.RelativeTimeFormat('en',", 'new Intl.RelativeTimeFormat(language,'],
    [".toLocaleDateString('en-US')", ".toLocaleDateString(language === 'ja' ? 'ja-JP' : 'en-US')"],
    ["language === 'en' ? 'en-US' : 'zh-CN'", locale],
  ]);
  editSource('components/shell/mailbox/mailbox-row-text.ts', 'compatibility', [
    ["language === 'en' ? entry?.badgeLabel : entry?.label", "language !== 'zh' ? entry?.badgeLabel : entry?.label"],
  ]);

  for (const [file, hook] of [
    ['eval-workspace/eval-workspace.shell-copy.ts', 'useEvalLanguage'],
    ['paw-feel/paw-feel.shell-copy.ts', 'usePawFeelLanguage'],
  ]) {
    editSource(`components/${file}`, 'compatibility', [
      ["return presentation === 'v2' ? language : 'zh';", "return presentation === 'v2' && language !== 'zh' ? 'en' : 'zh';"],
    ]);
    if (hook === 'useEvalLanguage') {
      editSource(`components/${file}`, 'compatibility', [
        ['  return evalWorkspaceCopy[useEvalLanguage()];', [
          '  const language = useShellLanguage();',
          '  const presentation = useShellPresentation();',
          "  return evalWorkspaceCopy[presentation === 'v2' ? language : 'zh'];",
        ].join('\n')],
      ]);
    }
  }
}

function integratePackaged(text, filename) {
  if (text.includes('kind:"shell-copy"')) {
    const before = /kind:"shell-copy",zh:(\w+)\.zh,en:\1\.en/g;
    text = text.replace(before, (match, name) => {
      integration.copy++;
      return `${match},ja:${name}.ja??${name}.en`;
    });
  }
  if (text.includes('cat-cafe:shell-language-sync')) {
    const prefix = text.match(/cat-cafe:shell-language-sync[^}]{0,1600}/)?.[0];
    const key = text.indexOf(prefix);
    // The module occupies one webpack entry. Change only its default and parser.
    const nextModule = /},\d+:(?:function\(|\()/g;
    nextModule.lastIndex = key;
    const end = nextModule.exec(text)?.index ?? text.length;
    const moduleText = text.slice(key, end);
    const localized = moduleText.replace(/"en"===(\w+)\?/g, '"en"===$1||"ja"===$1?')
      .replace(/(?:return\s*|=>|:)("zh")(?=[},;)])/g, match => match.replace('"zh"', '"ja"'));
    if (localized === moduleText) throw new Error(`${filename}: shell preference is incompatible`);
    text = text.slice(0, key) + localized + text.slice(end);
    integration.preference++;
  }
  if (text.includes('"en":"zh-CN"')) {
    text = text.replace(/(\w+)==="en"\?"en":"zh-CN"|"en"===(\w+)\?"en":"zh-CN"/g, (match, left, right) => {
      integration.document++;
      return `${left ?? right}==="ja"?"ja":${match}`;
    });
  }
  if (text.includes('shell-language-heading')) {
    for (const [before, after] of [
      ['["zh","en"]', '["zh","en","ja"]'],
      ['{zh:"中文（简体）",en:"English"}', '{zh:"中文（简体）",en:"English",ja:"日本語"}'],
      ['{zh:"zh-CN",en:"en"}', '{zh:"zh-CN",en:"en",ja:"ja"}'],
    ]) text = replaceOnce(text, before, after, filename, 'settings');
    text = text.replace(/en:(\w+)\.language\.names\.english(?=[},])/g, match => {
      integration.settingsLabels++;
      return `${match},ja:"日本語"`;
    });
    integration.settings++;
  }
  return text;
}

const targets = source ? filesUnder(path.join(web, 'src'), name => name.endsWith('.shell-copy.ts'))
  .filter(file => !file.includes(`${path.sep}__tests__${path.sep}`)) :
  ['static', 'server'].flatMap(directory => filesUnder(path.join(web, '.next', directory), name => name.endsWith('.js')));

for (const file of targets) {
  const text = fs.readFileSync(file, 'utf8');
  let localized = text;
  if (source || (text.includes('zh:{') && text.includes('en:{'))) localized = addJapaneseCatalogs(text);
  if (!source && !inventory) localized = integratePackaged(localized, file);
  if (!inventory && text !== localized) pending.set(file, localized);
}
if (inventory) {
  console.log(JSON.stringify([...catalogEntries].sort(), null, 2));
  process.exit(0);
}
if (source) integrateSource();
if (Object.values(integration).some(count => !count) || !exactEdits) {
  throw new Error(`Upstream integration requires review: ${JSON.stringify({ integration, copies, exactEdits })}`);
}
for (const [file, content] of pending) {
  if (file.endsWith('.js')) parser.parse(content, { sourceType: 'unambiguous' });
}
if (!checkOnly) for (const [file, content] of pending) fs.writeFileSync(file, content);
console.log(JSON.stringify({ mode, checkOnly, copies, localizedCopies: exactEdits, files: pending.size, integration,
  entries: catalogEntries.size, matchedTranslations: applied.size,
  unmatchedTranslations: [...dictionary.keys()].filter(key => !applied.has(key)) }, null, 2));
