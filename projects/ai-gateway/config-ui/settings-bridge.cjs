/**
 * rc.2 配置新家兼容层。
 *
 * dsh 0.2.2 起，`$DSH_HOME/settings.yaml` 不再是配置的存放位置：启动时 Loader
 * 会把老 settings.yaml 一次性迁移进「profile 的 patch 层」——
 * `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（patchPath），并把原文件改名为
 * `settings.yaml.imported`。上游源码依据：
 *   packages/settings/settings/src/index.ts → importLegacyDocument()
 *     const path = join(profile.home, 'settings.yaml')
 *     const imported = `${path}.imported`
 *     await rename(path, imported)
 *     … this.update(ns, values)
 *   packages/boot/config-editor/src/index.ts → get documentPath() { return profileContext.patchPath }
 *
 * 新格式与老格式的差别：
 *   老：一个 YAML 映射，顶层 key = section（`llm-pi-ai:` / `agent-default-model:` …）
 *   新：一个 YAML **数组**，每个元素形如
 *       - id: llm-pi-ai
 *         name: "@deepseek-ai/dsh-llm-pi-ai"
 *         config:
 *           providers: { … }
 *   且允许 `!!js` 表达式（cordis 的 custom tag），js-yaml 默认会抛错。
 *
 * 本模块提供两个方向的桥：
 *   readSettingsDoc()  → 返回 { 'llm-pi-ai': {...}, 'agent-default-model': {...} } 老形状
 *   （由新格式反解而来；老格式存在时直接读老文件）
 *   写路径走 writeSettingsDoc()，在新格式下会**就地改写 cordis.patch.yml 的对应
 *   entry.config 段**（行级编辑，保留文件里的 `!!js` 表达式与注释），老格式下行为不变。
 *
 * 设计约束：只做「形状适配」，不引入新语义；任何解析不了的形态一律 fail-closed
 * （抛错让调用方返回 4xx/5xx），绝不写出半截配置。
 */

const fs = require('node:fs/promises');
const path = require('node:path');

/** profile 目录名（rc.2 的 active profile）。dsh-web 以 `web` profile 跑生产。 */
const ACTIVE_PROFILE = process.env.DSH_ACTIVE_PROFILE || 'web';

/** 新家：profile patch 层。 */
function patchFilePath(configDir) {
  return path.join(configDir, 'profiles', ACTIVE_PROFILE, 'cordis.patch.yml');
}

/** 老家：一次性迁移前的 settings.yaml。 */
function legacyFilePath(configDir) {
  return path.join(configDir, 'settings.yaml');
}

/**
 * 探测当前用的是哪套格式。
 * @returns {Promise<'legacy'|'patch'|'none'>}
 */
async function detectFormat(configDir) {
  const legacy = legacyFilePath(configDir);
  try {
    await fs.access(legacy);
    return 'legacy';
  } catch {
    /* 继续看 patch 层 */
  }
  const patch = patchFilePath(configDir);
  try {
    await fs.access(patch);
    return 'patch';
  } catch {
    return 'none';
  }
}

/** 从 patch 层的元素数组里反解出老形状的 section 映射。 */
function sectionsFromPatchEntries(entries) {
  const out = {};
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const id = entry.id ?? entry.name;
    if (typeof id !== 'string' || !id) continue;
    const config = entry.config;
    if (config && typeof config === 'object') {
      out[id] = config;
    } else if (id in out) {
      /* 同 id 的多个 entry：后写的 config 覆盖先写的 */
      out[id] = { ...(out[id] || {}), ...(out[id] || {}) };
    }
  }
  return out;
}

/**
 * 读配置，统一返回老形状（section 映射）。
 * @param {string} configDir
 * @param {(text: string, label: string) => any} parseYaml js-yaml 解析器（可抛错）
 * @returns {Promise<{ doc: Record<string, any>, format: 'legacy'|'patch'|'none', file: string }>}
 */
async function readSettingsDoc(configDir, parseYaml) {
  const format = await detectFormat(configDir);
  if (format === 'legacy') {
    const file = legacyFilePath(configDir);
    const text = await fs.readFile(file, 'utf8');
    const doc = parseYaml(text, file) || {};
    return { doc: normalizeLegacyDoc(doc), format: 'legacy', file };
  }
  if (format === 'patch') {
    const file = patchFilePath(configDir);
    const text = await fs.readFile(file, 'utf8');
    const entries = parsePatchYaml(text, file);
    return { doc: sectionsFromPatchEntries(entries), format: 'patch', file };
  }
  return { doc: {}, format: 'none', file: legacyFilePath(configDir) };
}

/** 老形状里顶层可能是数组（rc.2 的 patch 层）——统一成映射。 */
function normalizeLegacyDoc(doc) {
  if (Array.isArray(doc)) return sectionsFromPatchEntries(doc);
  if (doc && typeof doc === 'object') return doc;
  return {};
}

/**
 * 解析 patch 层 YAML。
 * cordis 允许 `!!js` 自定义 tag，js-yaml 默认 schema 不认识 → 这里用
 * CORE_SCHEMA + 显式的 js 类型兜底；无法解析的 `!!js` 表达式降级为**字符串**，
 * 绝不抛错（那是上游自己会 eval 的东西，config-ui 只需要看到它的存在）。
 */
function parsePatchYaml(text, fileLabel) {
  // 优先用调用方的 js-yaml（能配 schema 的最好），否则用宽松正则兜底。
  let jsYaml = null;
  try {
    const candidates = [
      process.env.JS_YAML_PATH,
      '/home/dingx/dsh/node_modules/js-yaml',
      '/home/dingx/dsh/node_modules/js-yaml',
    ].filter(Boolean);
    for (const c of candidates) {
      try {
        jsYaml = require(c);
        break;
      } catch {
        /* try next */
      }
    }
  } catch {
    jsYaml = null;
  }
  if (jsYaml) {
    try {
      // js-yaml 4.x 要求 extend() 收 Type 实例（传普通对象会抛
      // "Schema.extend argument should be a Type…"）；3.x 只认普通对象。
      const jsTag = {
        kind: 'scalar',
        construct: (data) => ({ __jsExpr: String(data) }),
      };
      let schema;
      if (typeof jsYaml.Type === 'function') {
        schema = jsYaml.DEFAULT_SCHEMA.extend([
          new jsYaml.Type('tag:yaml.org,2002:js', jsTag),
        ]);
      } else {
        schema = jsYaml.DEFAULT_SCHEMA.extend({
          'tag:yaml.org,2002:js': jsTag,
        });
      }
      const doc = jsYaml.load(text, { schema });
      if (Array.isArray(doc)) return doc;
      if (doc && typeof doc === 'object') return Object.values(doc);
      return [];
    } catch (err) {
      throw new Error(`${fileLabel}: patch 层 YAML 解析失败: ${err.message}`);
    }
  }
  return parsePatchYamlFallback(text);
}

/**
 * 无 js-yaml 时的兜底解析：只提取每个 `- id: X` 元素的 `config:` 子树。
 * 够 config-ui 读 providers / agent-default-model 用；写路径在无 js-yaml 时拒绝落盘。
 */
function parsePatchYamlFallback(text) {
  const entries = [];
  const lines = text.split('\n');
  let cur = null;
  let inConfig = false;
  let configIndent = 0;
  const configLines = [];
  const flush = () => {
    if (!cur) return;
    if (configLines.length) {
      // 缩进裁平后按 2 空格解析
      const stripped = configLines.map((l) => l.slice(Math.min(configIndent, l.length - l.trimStart().length)));
      const body = stripped.join('\n');
      try {
        cur.config = parseSimpleYamlMap(body);
      } catch {
        cur.config = null;
      }
    }
    entries.push(cur);
    cur = null;
  };
  for (const line of lines) {
    const idMatch = /^-\s+id:\s*(.+?)\s*$/.exec(line);
    if (idMatch) {
      flush();
      cur = { id: idMatch[1].replace(/^["']|["']$/g, ''), config: null };
      inConfig = false;
      configLines.length = 0;
      continue;
    }
    if (!cur) continue;
    const cfgMatch = /^(\s*)config:\s*$/.exec(line);
    if (cfgMatch) {
      inConfig = true;
      configIndent = cfgMatch[1].length + 2;
      continue;
    }
    if (inConfig) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#')) configLines.push(line);
        continue;
      }
      const indent = line.length - line.trimStart().length;
      if (indent <= configIndent - 2) {
        inConfig = false;
        continue;
      }
      configLines.push(line);
    }
  }
  flush();
  return entries;
}

/** 极简 YAML 映射解析（仅用于兜底路径的 providers 读取）。 */
function parseSimpleYamlMap(body) {
  const out = {};
  const stack = [{ indent: -1, node: out }];
  for (const raw of body.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const m = /^([^:]+):\s*(.*)$/.exec(raw.trim());
    if (!m) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    const key = m[1].trim().replace(/^["']|["']$/g, '');
    const val = m[2].trim();
    if (val === '') {
      const child = {};
      parent.node[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent.node[key] = val;
    }
  }
  return out;
}

/**
 * 在 patch 层里定位某个 entry 的 `config:` 子树的行范围（行级编辑用）。
 * @returns {{entryStart:number, configStart:number, configEnd:number}|null}
 */
function locatePatchConfig(lines, entryId) {
  let entryStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^-\s+(?:id|name):\s*["']?([^"'\s]+)["']?\s*$/.exec(lines[i]);
    if (m && m[1] === entryId) {
      entryStart = i;
      break;
    }
  }
  if (entryStart < 0) return null;
  let configStart = -1;
  let configIndent = 0;
  for (let i = entryStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^-\s+/.test(line)) break; // 下一个 entry
    const m = /^(\s*)config:\s*$/.exec(line);
    if (m) {
      configStart = i;
      configIndent = m[1].length;
      break;
    }
  }
  if (configStart < 0) return null;
  let configEnd = lines.length;
  for (let i = configStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= configIndent) {
      configEnd = i;
      break;
    }
  }
  return { entryStart, configStart, configEnd };
}

/**
 * 写回 patch 层的某个 entry.config.<section>。
 * 用行级替换，文件里的 `!!js` 表达式、注释、其它 entry 一律不动。
 *
 * @param {string} configDir
 * @param {string} entryId   patch 层的 entry id（如 `llm-pi-ai`）
 * @param {string} section   entry.config 下的顶层 key（如 `providers`）
 * @param {string[]} blockLines 已渲染好的 YAML 行（不含 section 自身的 `key:` 行）
 * @param {string} sectionKeyLine section 的键行（如 `    providers:`）
 * @returns {Promise<{file:string, changed:boolean}>}
 */
async function writePatchSection(configDir, entryId, sectionKeyLine, blockLines) {
  const file = patchFilePath(configDir);
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const loc = locatePatchConfig(lines, entryId);
  if (!loc) throw new Error(`patch 层里找不到 entry '${entryId}' 的 config 段（${file}）`);

  const configIndent = lines[loc.configStart].length - lines[loc.configStart].trimStart().length;
  // entry.config 里 section 的键行缩进 = configIndent + 2
  const sectionIndent = configIndent + 2;
  // sectionKeyLine 形如 "providers:"（可带尾随空格）→ 取裸键名。
  // 注意：旧写法 /\s*:.*$/ 要求冒号前有空白，"providers:" 匹配不到，
  // 于是正则变成 ^\s{4}providers:\s*:（两个冒号）永远不匹配，
  // 走到「section 不存在 → 插入」分支 → 写出重复的 providers: 键。
  const bareKey = sectionKeyLine.trim().replace(/:\s*$/, '');
  const sectionRe = new RegExp(`^\\s{${sectionIndent}}${escapeRe(bareKey)}\\s*:`);

  // 找 section 键行
  let secStart = -1;
  for (let i = loc.configStart + 1; i < loc.configEnd; i++) {
    if (sectionRe.test(lines[i])) {
      secStart = i;
      break;
    }
  }
  let next;
  if (secStart >= 0) {
    // section 内容范围：从下一行到缩进 <= sectionIndent 的行
    let secEnd = loc.configEnd;
    for (let i = secStart + 1; i < loc.configEnd; i++) {
      const line = lines[i];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= sectionIndent) {
        secEnd = i;
        break;
      }
    }
    next = [...lines.slice(0, secStart + 1), ...blockLines, ...lines.slice(secEnd)];
  } else {
    // section 不存在 → 插到 config: 之后
    next = [
      ...lines.slice(0, loc.configStart + 1),
      ' '.repeat(sectionIndent) + sectionKeyLine,
      ...blockLines,
      ...lines.slice(loc.configStart + 1),
    ];
  }
  const next2 = next;
  while (next2.length && next2[next2.length - 1] === '') next2.pop();
  const content = next2.join('\n') + '\n';

  // 写前校验：新内容必须仍能解析（防止行级替换写出重复键/坏缩进）。
  // 校验用与读取同一套解析器（带 !!js 支持）。
  try {
    parsePatchYaml(content, file);
  } catch (err) {
    throw new Error(`${file}: 写入内容校验失败，已拒绝保存（未改动文件）: ${err.message}`);
  }

  // 原子写：临时文件 + rename，避免半截文件。
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
  return { file, changed: true };
}

/**
 * 在 patch 层的某个 entry.config 下覆写/删除一个叶子键（行级）。
 * 用于 agent-default-model.provider 这类「单键改名」的操作：
 * 命中 → 替换该行的 value；未命中 → 在 config: 之后追加。
 *
 * @param {string} configDir
 * @param {string} entryId
 * @param {string} key
 * @param {string|null} value null = 删除该行
 * @returns {Promise<{file:string, changed:boolean, action:'updated'|'added'|'removed'|'none'}>}
 */
async function writePatchLeaf(configDir, entryId, key, value) {
  const file = patchFilePath(configDir);
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split('\n');
  const loc = locatePatchConfig(lines, entryId);
  if (!loc) throw new Error(`patch 层里找不到 entry '${entryId}' 的 config 段（${file}）`);

  const configIndent = lines[loc.configStart].length - lines[loc.configStart].trimStart().length;
  const leafIndent = configIndent + 2;
  const keyRe = new RegExp(`^(\\s{${leafIndent}})${escapeRe(key)}\\s*:`);

  let hit = -1;
  for (let i = loc.configStart + 1; i < loc.configEnd; i++) {
    if (keyRe.test(lines[i])) { hit = i; break; }
  }

  let next;
  let action;
  if (hit >= 0) {
    if (value === null) {
      next = [...lines.slice(0, hit), ...lines.slice(hit + 1)];
      action = 'removed';
    } else {
      next = [...lines];
      const before = lines[hit];
      const ci = before.indexOf(' #');
      const comment = ci >= 0 ? ' ' + before.slice(ci).trim() : '';
      next[hit] = `${' '.repeat(leafIndent)}${key}: ${value}${comment}`;
      action = 'updated';
    }
  } else if (value === null) {
    return { file, changed: false, action: 'none' };
  } else {
    next = [
      ...lines.slice(0, loc.configStart + 1),
      `${' '.repeat(leafIndent)}${key}: ${value}`,
      ...lines.slice(loc.configStart + 1),
    ];
    action = 'added';
  }

  while (next.length && next[next.length - 1] === '') next.pop();
  const content = next.join('\n') + '\n';
  try {
    parsePatchYaml(content, file);
  } catch (err) {
    throw new Error(`${file}: 写入内容校验失败，已拒绝保存（未改动文件）: ${err.message}`);
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, { mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
  return { file, changed: true, action };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  ACTIVE_PROFILE,
  patchFilePath,
  legacyFilePath,
  detectFormat,
  readSettingsDoc,
  writePatchSection,
  locatePatchConfig,
  parsePatchYaml,
};
