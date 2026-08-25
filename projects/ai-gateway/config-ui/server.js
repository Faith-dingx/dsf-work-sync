#!/usr/bin/env node
/**
 * AI 网关配置 Web 界面 — T1 后端 API（Node 原生 http，无框架）
 *
 * 接口：
 *   GET  /api/status                   运行状态/端口/DSH_TRUSTED_HOSTS
 *   GET  /api/boot                     首启 token（仅首次创建时回显明文）
 *   GET  /api/providers                读 ${CONFIG_DIR}/settings.yaml 的 llm-pi-ai.providers
 *   PUT  /api/providers                整体替换 providers 段（保留文件其他段；备份+原子写）
 *   GET  /api/keys                     全应用密钥目录（模型/搜索/GitHub/其他）多源枚举：settings apiKeyEnv ∪
 *                                     应用声明键 ∪ .credentials.yaml refs ∪ dsh.env 键；标注 category 与来源
 *                                     (env/credentials.yaml/dsh.env/bashrc/gh)与 configured（真实凭据文档对齐）
 *   POST /api/keys                     写 KEY=VALUE 到 .credentials.yaml（v1 布局；扁平迁移 v1；备份+原子写 chmod 600）
 *   DELETE /api/keys                   删 KEY：从 .credentials.yaml（v1/扁平行级删除，只删首个命中）与
 *                                      dsh.env（name= 行）移除；备份+原子写（600）；不删 process.env
 *   GET  /api/subagents                扫描 ${PRESETS_DIR} 下各 agent.cordis.yml 列出模型标注字段；
 *                                     模型多源解析（modelSource）：① full/agent.cordis.yml 挂载块
 *                                     tool-subagent-<id>.config.agentOptions('mount') → ② preset 文件标注('preset')
 *                                     → ③ settings.yaml agent-default-model('default'，inherited)
 *   POST /api/subagents                新建子代理（template 复制模板 / blank 空白），写 .config-ui-created 标记
 *   PUT  /api/subagents/:id            编辑走挂载层：改 FULL_PRESETS_FILE 中 tool-subagent-<id> 块的
 *                                     config.agentOptions 的 model/provider/reasoningEffort（无键则新增，
 *                                     无 agentOptions 则新增块），备份+原子写+YAML 校验；无挂载块 → 404+提示
 *   GET  /api/models                   聚合 ${CONFIG_DIR}/settings.yaml 所有 provider 的模型 id → [{provider, model}]
 *                                      （含 modelEfforts：provider → modelId → 该模型支持的思考级别数组或 null）
 *   POST /api/dsh/restart              重启 dsh 主服务（systemd 用户服务）；spawn 后立即返回，不等待完成
 *   GET  /api/boot-error               dsh 启动失败原因（systemctl show Result + journalctl 错误行；仅未运行时有用）
 *   GET  /api/rollback                 回滚状态（当前版本 / 备份数 / 最近日志）
 *   GET  /api/rollback/backups         可用备份（cordis/凭据/记忆/git 提交/git 回滚安全引用）
 *
 * 认证：首启生成 randomBytes(32).hex 写入 ${CONFIG_DIR}/.config-ui-token（600）；
 *       除 /api/boot 外，其余 API 要求 `Authorization: Bearer <token>`。
 * 默认端口 3083，可用环境变量 PORT 覆盖；默认绑定 127.0.0.1（HOST 可覆盖）。
 * dsh 308x 段规划：3080=受限对外面，3081=dsh 完整主入口，3083=配置界面（避让 3081）。
 * （旧默认 8093 来历：本机 8090 被 hermes system_monitor_web.py 占用，故当时定 8093；现已统一入 308x 段。）
 *
 * 依赖：优先 require 仓库 node_modules 的 js-yaml（仅读解析用），
 *       不可用时内部回退为轻量行解析（只覆盖本文件用到的扁平 YAML 形态）。
 *       写路径全部走"行级定位/段级替换"，不依赖 YAML 序列化，天然保留注释。
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync, execFile } = require('node:child_process');

/* ───────────────────────── 环境与路径 ───────────────────────── */

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(process.env.HOME || '.', '.dsh');
const PRESETS_DIR = process.env.PRESETS_DIR || path.join(CONFIG_DIR, '.agent-presets');
const PORT = Number(process.env.PORT) || 3083;
const HOST = process.env.HOST || '127.0.0.1';
// dsh web 端口（status 探测目标）；默认 :3080
const DSH_PORT = Number(process.env.DSH_PORT) || 3080;
// 重启 dsh 主服务的命令（测试注入 DSH_RESTART_CMD=/bin/true 空跑；生产默认 systemctl --user restart）
const DSH_RESTART_CMD = process.env.DSH_RESTART_CMD || 'systemctl';
let DSH_RESTART_ARGS = ['--user', 'restart', 'dsh-web.service'];
try {
  if (process.env.DSH_RESTART_ARGS) DSH_RESTART_ARGS = JSON.parse(process.env.DSH_RESTART_ARGS);
} catch {
  /* 非法 JSON → 保留默认参数 */
}
// 启动错误诊断命令（测试注入 DSH_SHOW_CMD/DSH_JOURNAL_CMD 假命令；生产默认 systemctl/journalctl）
const DSH_SHOW_CMD = process.env.DSH_SHOW_CMD || 'systemctl';
let DSH_SHOW_ARGS = [
  '--user',
  'show',
  'dsh-web.service',
  '--property=Result,FailureReason,ExecMainStatus',
];
try {
  if (process.env.DSH_SHOW_ARGS) DSH_SHOW_ARGS = JSON.parse(process.env.DSH_SHOW_ARGS);
} catch {
  /* 非法 JSON → 保留默认参数 */
}
const DSH_JOURNAL_CMD = process.env.DSH_JOURNAL_CMD || 'journalctl';
let DSH_JOURNAL_ARGS = [
  '--user',
  '-u',
  'dsh-web.service',
  '-n',
  '10',
  '--no-pager',
  '--output=short',
];
try {
  if (process.env.DSH_JOURNAL_ARGS) DSH_JOURNAL_ARGS = JSON.parse(process.env.DSH_JOURNAL_ARGS);
} catch {
  /* 非法 JSON → 保留默认参数 */
}

const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.yaml');
const ENV_FILE = path.join(CONFIG_DIR, 'dsh.env');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, '.credentials.yaml');
// 回滚审计面（对应 rollback.sh）：备份一律位于 $CONFIG_DIR（生产即 ~/.dsh：
// .agent-presets/full/*.bak-*、.credentials.yaml.bak-*、memory-backup/latest/）；
// harness 仓库默认 /home/dingx/deepseek-harness，可用 ROLLBACK_HARNESS_DIR / HARNESS_DIR 覆盖
// （受控测试注入 dummy 仓库，绝不触碰真实仓库）。
const HARNESS_DIR =
  process.env.ROLLBACK_HARNESS_DIR || process.env.HARNESS_DIR || '/home/dingx/deepseek-harness';
// 原厂凭据文档：dsh-credentials-local 读写的 $DSH_HOME/.credentials.yaml。
// 真实机制：dsh 凭据解析顺序 = 继承环境 → $DSH_HOME/.credentials.yaml
//           → 调用目录 .env → $DSH_HOME/.env（低优先级后备；受管文档不物化进 process.env）。
// 本文件 dsh.env 非原厂层：软路由部署专用键文件（本机无此文件）；apiKeyEnv 实际取自进程继承环境。
const TOKEN_FILE = path.join(CONFIG_DIR, '.config-ui-token');
const PRESET_FILE = 'agent.cordis.yml';
const PRESET_META = 'preset.yml';
// 挂载层：子代理真实 provider/model/reasoningEffort 的权威来源 —
// full/agent.cordis.yml 的 tool-subagent-<id> 块 config.agentOptions。
// 可用环境变量 FULL_PRESETS_FILE 指向副本（受控写测试用；默认真实文件）。
const FULL_PRESETS_FILE =
  process.env.FULL_PRESETS_FILE || path.join(PRESETS_DIR, 'full', PRESET_FILE);

const MASK = '****';
// 血清 provider 值（工具行 config.provider: spawn/fork 之类，非模型 provider）
const NON_MODEL_PROVIDERS = new Set(['spawn', 'fork', 'in-process', 'process']);

/* ─────────────── YAML 读取：js-yaml → 轻量回退 ─────────────── */

let jsYaml = null;
try {
  // 允许通过 npm_config 或绝对路径拿到仓库内 js-yaml
  const candidates = [
    process.env.JS_YAML_PATH,
    '/home/dingx/deepseek-harness/node_modules/js-yaml',
    '/srv/dsh/node/node_modules/js-yaml',
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

/** 解析 YAML；js-yaml 不可用时回退为扁平 key: value 行解析（够用即可）。 */
function parseYaml(text, fileLabel) {
  if (jsYaml) {
    try {
      return jsYaml.load(text);
    } catch (err) {
      throw new Error(`${fileLabel}: YAML 解析失败: ${err.message}`);
    }
  }
  const out = {};
  for (const raw of text.split('\n')) {
    const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(raw);
    if (m) out[m[1]] = m[2] === '' ? null : unquote(m[2]);
  }
  return out;
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

/* ───────────────────────── 小工具 ───────────────────────── */

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 行级备份（忽略失败——尽力而为，不阻断主流程）。 */
async function backup(file) {
  try {
    const dest = `${file}.bak-config-ui-${nowStamp()}-${crypto.randomBytes(2).toString('hex')}`;
    await fsp.copyFile(file, dest);
    return dest;
  } catch {
    return null;
  }
}

/** 原子写：临时文件 + rename。可选 chmod。 */
async function atomicWrite(file, content, mode) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, content);
  if (mode !== undefined) await fsp.chmod(tmp, mode);
  await fsp.rename(tmp, file);
}

/** 值是否需要 YAML 单引号包裹。 */
function needsQuote(v) {
  // 前导零数字（如 007）：YAML 按 number 解析会丢前导零/改语义，保留引号
  if (/^-?0\d/.test(v)) return true;
  // 纯数字：按数字写出（contextWindow/maxTokens 等字段要求数字），前导零除外；
  // 超 JS 安全整数范围会丢精度，保留引号更安全
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    if (Number(v) > Number.MAX_SAFE_INTEGER || Number(v) < Number.MIN_SAFE_INTEGER) return true;
    return false;
  }
  return (
    v.length === 0 ||
    /:\s/.test(v) || // ": " 会被解析为映射分隔
    /(^|\s)#/.test(v) || // 注释起始
    v.trim() !== v ||
    /^[!&*%\-?|>@`"[\]{},\s]/.test(v) ||
    /^(null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|~)$/.test(
      v,
    )
  );
}

/** YAML 标量值渲染（含单引号转义）。 */
function renderScalar(v) {
  const s = String(v);
  if (needsQuote(s)) return `'${s.replace(/'/g, "''")}'`;
  return s;
}

/* ─────────────── providers: settings.yaml 段读写 ─────────────── */

/**
 * 定位 llm-pi-ai.providers 段：
 * 返回 { start } = providers 行的下标（含），或 { start, end } 其中 end 为段尾
 * （下一顶格非空非注释行下标，或行数）。文件内不存在时返回 null。
 */
function locateProvidersSegment(lines) {
  let llmIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^llm-pi-ai\s*:/.test(lines[i])) {
      llmIdx = i;
      break;
    }
  }
  if (llmIdx === -1) return null;
  let start = -1;
  for (let i = llmIdx + 1; i < lines.length; i++) {
    if (/^\s*providers\s*:/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** 递归把 providers JSON 渲染成缩进 YAML 文本段（映射 +2 列，列表项键 +4 列）。 */
function emitProviderBlock(providers, indent) {
  const out = [];
  const walkKeys = (obj, col) => {
    const p = ' '.repeat(col);
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) {
        out.push(`${p}${k}:`);
      } else if (Array.isArray(v)) {
        out.push(`${p}${k}:`);
        for (const item of v) {
          if (item && typeof item === 'object') {
            out.push(`${p}  -`);
            walkKeys(item, col + 4);
          } else {
            out.push(`${p}  - ${renderScalar(item)}`);
          }
        }
      } else if (typeof v === 'object') {
        out.push(`${p}${k}:`);
        walkKeys(v, col + 2);
      } else {
        out.push(`${p}${k}: ${renderScalar(v)}`);
      }
    }
  };
  walkKeys(providers, indent);
  return out.join('\n');
}

/** 读 providers（js-yaml 优先；失败时返回裸段文本+错误说明）。 */
async function getProviders() {
  const text = await fsp.readFile(SETTINGS_FILE, 'utf8');
  const lines = text.split('\n');
  const seg = locateProvidersSegment(lines);
  if (!seg) return { providers: null, source: 'not-found' };
  if (jsYaml) {
    try {
      const doc = jsYaml.load(text);
      const providers = doc && doc['llm-pi-ai'] ? (doc['llm-pi-ai'].providers ?? null) : null;
      return { providers, source: 'yaml' };
    } catch (err) {
      return {
        providers: null,
        source: 'yaml-error',
        error: err.message,
        raw: lines.slice(seg.start, seg.end).join('\n'),
      };
    }
  }
  return {
    providers: null,
    source: 'fallback-parse',
    raw: lines.slice(seg.start, seg.end).join('\n'),
  };
}

/** pi-ai 内置目录候选（ESM 包，Node ≥22.12 支持 require(ESM)；前两位失败则依次兜底，fail-open）。 */
const PIAI_CANDIDATES = [
  '/home/dingx/deepseek-harness/node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_@modelcontextprotocol+sdk@1.29.0_zod@4.4.3__ws@8.21.0_zod@4.4.3/node_modules/@earendil-works/pi-ai/dist/providers/all.js',
  process.env.PIAI_ALL_PATH,
  '/home/dingx/deepseek-harness/node_modules/@earendil-works/pi-ai/dist/providers/all.js',
].filter(Boolean);

let piAiCatalogCache = null;

// 原厂思考级别全集（与 @earendil-works/pi-ai dist/models.js 的 EXTENDED_THINKING_LEVELS 一致）
const EXTENDED_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * 模型级思考级别纠正表（modelId → 纠正后的 thinkingLevelMap 键值，只覆盖需要纠正的键）：
 * 这些模型的 pi-ai 目录 thinkingLevelMap 与实测 API 不符（opencode-go provider 直接读目录，
 * /api/models 不修正则 UI 显示错误）。键值按 getSupportedThinkingLevels 语义填写——
 * 原厂语义：键缺失=支持（透传）、显式 null=不支持（剔除）、xhigh/max 需映射存在。
 */
const THOUGHT_CORRECTIONS = {
  // modelId -> 纠正后的 thinkingLevelMap（只覆盖需要纠正的键）
  'glm-5.2': { minimal: 'minimal', low: 'low', medium: 'medium', xhigh: 'xhigh', max: 'max' },
  hy3: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' },
  'kimi-k2.6': {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  'kimi-k3': {
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  'minimax-m3': { xhigh: 'xhigh', max: 'max' },
  'qwen3.7-max': { minimal: 'minimal', low: 'low', medium: 'medium', xhigh: 'xhigh' },
};

/**
 * 纠正 pi-ai 目录对思考级别的误标，两条规则：
 * 1. 模型级：model.id 命中 THOUGHT_CORRECTIONS → 合并纠正值到 map（只覆盖表中有值的键，
 *    其余键保留原值；map 缺失时以纠正表为基底）。表条目为实测 API 支持级，不限定 api
 *    （覆盖 opencode-go 的 anthropic-messages 模型 minimax-m3/qwen3.7-max）。
 * 2. DeepSeek 家族（保留原规则）：pi-ai 将 minimal/low/medium 标为 null，但实际 API 支持全部 7 级。
 *    限定 model.api === 'openai-completions'（DeepSeek 专用 API 格式）与模型 id 属 DeepSeek 家族
 *    —— openai-completions 是多数 OpenAI 兼容厂商的通行格式，仅凭 api 会把 glm/kimi/qwen 等
 *    其他厂商的 null（真实表示不支持）一并改写；双重限定保证其他模型的 null 语义不受影响。
 */
function correctThinkingLevelMap(model, map) {
  const id = String((model && model.id) || '');
  const correction = THOUGHT_CORRECTIONS[id];
  if (correction) {
    // 合并纠正值（只覆盖表中有值的键），无 map 时以纠正表为基底
    const merged = { ...map };
    for (const [level, value] of Object.entries(correction)) merged[level] = value;
    return merged;
  }
  if (!map || model.api !== 'openai-completions') return map;
  if (!id.toLowerCase().includes('deepseek')) return map;
  // minimal/low/medium 为 null → 视为"目录未标注"，修正为对应级别名（通过过滤）
  const corrected = { ...map };
  for (const level of ['minimal', 'low', 'medium']) {
    if (corrected[level] === null) corrected[level] = level;
  }
  // xhigh 键缺失（deepseek/opencode-go 目录）或为 null（opencode 目录）同为目录未标注：
  // 实际 DeepSeek API 支持 xhigh。
  if (corrected.xhigh === null || corrected.xhigh === undefined) corrected.xhigh = 'xhigh';
  return corrected;
}

// 与原厂 dist/models.js getSupportedThinkingLevels 完全同逻辑的兜底（dist/models.js 不可 require 时使用）：
// 非 reasoning 模型 → ['off']；reasoning 模型 → 按 thinkingLevelMap 过滤（值===null 剔除；xhigh/max 要求映射存在；其余透传）。
// 注：DeepSeek 模型（api==='openai-completions'）先经 correctThinkingLevelMap 纠正 —— pi-ai 目录将
// minimal/low/medium 误标为 null，实际 API 支持全部 7 级；纠正后 null 只剩"真正不支持"语义。
function shimSupportedThinkingLevels(model) {
  if (!model || model.reasoning !== true) return ['off'];
  const map = correctThinkingLevelMap(model, model.thinkingLevelMap);
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = map && map[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}

let piAiThinkingLevelsFn = null;
/** 优先取原厂 dist/models.js 的 getSupportedThinkingLevels（与运行时 resolveReasoningLevel 同源）；
 *  找不到时退回 shimSupportedThinkingLevels（同逻辑）。
 *  DeepSeek 思考级别纠正（correctThinkingLevelMap）两条路径都生效：
 *  原厂函数只读 model.thinkingLevelMap，故以克隆模型注入纠正后的 map，不改动原厂函数本身。 */
function getSupportedThinkingLevelsShim(model) {
  if (typeof piAiThinkingLevelsFn !== 'function') {
    for (const c of PIAI_CANDIDATES) {
      const modelsPath = String(c).replace(/\/providers\/all\.js$/, '/models.js');
      if (modelsPath === String(c)) continue;
      try {
        const m = require(modelsPath);
        if (m && typeof m.getSupportedThinkingLevels === 'function') {
          piAiThinkingLevelsFn = m.getSupportedThinkingLevels;
          break;
        }
      } catch {
        /* 该候选无 models.js → 尝试下一候选 */
      }
    }
  }
  if (!piAiThinkingLevelsFn) return shimSupportedThinkingLevels(model);
  const corrected = correctThinkingLevelMap(model, model.thinkingLevelMap);
  if (corrected === model.thinkingLevelMap) return piAiThinkingLevelsFn(model);
  return piAiThinkingLevelsFn({ ...model, thinkingLevelMap: corrected });
}

/**
 * 单个内置模型 → modelEfforts 取值（null=未声明，前端给默认全集+提示）：
 *  - reasoning:false → null：原厂 reasoningInfo 对非 reasoning 模型不暴露 reasoning 段
 *    （off 对这类模型无意义——选中 off 与不设 effort 请求字节相同），null+前端提示更准确。
 *  - reasoning:true 但纠正后 map 为空 → null（未声明能力）。
 *  - 其余 → getSupportedThinkingLevels 真实输出（判定用纠正后的 map：
 *    THOUGHT_CORRECTIONS 覆盖的模型即使目录无 thinkingLevelMap（如 minimax-m3/qwen3.7-max）
 *    也按纠正表声明级别；运行时 resolveReasoningLevel 依此判定 UNSUPPORTED_REASONING_EFFORT，
 *    getSupportedThinkingLevelsShim 内部同样先经 correctThinkingLevelMap，两处必须一致）。
 */
function builtinModelEffortLevels(model) {
  if (!model || typeof model !== 'object' || model.reasoning !== true) return null;
  const correctedMap = correctThinkingLevelMap(model, model.thinkingLevelMap);
  if (!correctedMap || !Object.keys(correctedMap).length) return null;
  const sup = getSupportedThinkingLevelsShim(model);
  return Array.isArray(sup) ? sup : null;
}

/**
 * 加载原厂 pi-ai 内置"全部厂商及模型"目录（@earendil-works/pi-ai/providers/all）。
 * 返回 { providers: [厂商id...], modelsByProvider: {厂商id: [modelId...]},
 *        modelEfforts: {厂商id: {modelId: [思考级别...]|null}}, loaded: boolean }；
 * require 失败返回 null（不阻断）。getBuiltinModels 异常时该厂商记空数组。
 */
function loadPiAiCatalog() {
  if (piAiCatalogCache) return piAiCatalogCache;
  let mod = null;
  for (const c of PIAI_CANDIDATES) {
    try {
      mod = require(c);
      if (
        mod &&
        typeof mod.getBuiltinProviders === 'function' &&
        typeof mod.getBuiltinModels === 'function'
      )
        break;
      mod = null;
    } catch {
      mod = null; /* 尝试下一候选 */
    }
  }
  if (!mod) return null;
  const providers = [];
  const modelsByProvider = {};
  const modelEfforts = {};
  try {
    for (const id of mod.getBuiltinProviders()) {
      providers.push(id);
      const list = [];
      const efforts = {};
      try {
        for (const m of mod.getBuiltinModels(id) || []) {
          const mid = m && typeof m === 'object' ? m.id : m;
          if (typeof mid === 'string' && mid && !list.includes(mid)) {
            list.push(mid);
            if (m && typeof m === 'object') efforts[mid] = builtinModelEffortLevels(m);
          }
        }
      } catch {
        /* 该厂商模型枚举失败 → 记空数组 */
      }
      modelsByProvider[id] = list;
      modelEfforts[id] = efforts;
    }
  } catch (err) {
    piAiCatalogCache = { providers: [], modelsByProvider: {}, modelEfforts: {}, loaded: false };
    return piAiCatalogCache;
  }
  piAiCatalogCache = { providers, modelsByProvider, modelEfforts, loaded: true };
  return piAiCatalogCache;
}

/**
 * 聚合模型目录（真实机制对齐）→ [{ provider, model, source }]（同 provider 内去重）：
 *  - builtin：pi-ai 内置目录 getBuiltinProviders()/getBuiltinModels()（原厂 37 厂商全部模型）
 *  - settings：${CONFIG_DIR}/settings.yaml 的 llm-pi-ai.providers 自定义 provider 模型（含 router-9888 等自定 id）
 *  排序：provider 字母序 + model 字母序。pi-ai 不可用 → catalogLoaded=false 且仅返回 settings 源（不报错）。
 */
async function getModelList() {
  const catalog = loadPiAiCatalog();
  const catalogLoaded = !!(catalog && catalog.loaded);
  const seen = new Set();
  const out = [];
  let builtinCount = 0;
  let settingsCount = 0;
  if (catalogLoaded) {
    for (const prov of catalog.providers) {
      for (const mid of catalog.modelsByProvider[prov] || []) {
        const key = `${prov}\u0000${mid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ provider: prov, model: mid, source: 'builtin' });
        builtinCount++;
      }
    }
  }
  let providers = null;
  try {
    const data = await getProviders();
    providers = data.providers;
  } catch {
    providers = null;
  }
  if (providers && typeof providers === 'object') {
    for (const [pname, p] of Object.entries(providers)) {
      if (!p || typeof p !== 'object' || !Array.isArray(p.models)) continue;
      for (const m of p.models) {
        const id = m && typeof m === 'object' ? m.id : m;
        if (typeof id !== 'string' || !id) continue;
        const key = `${pname}\u0000${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ provider: pname, model: id, source: 'settings' });
        settingsCount++;
      }
    }
  }
  out.sort((a, b) =>
    a.provider === b.provider
      ? a.model.localeCompare(b.model)
      : a.provider.localeCompare(b.provider),
  );

  // ── providers / modelsByProvider（前端厂商↔模型联动用；不改动上方计数逻辑）──
  // providers：settings 的自定 provider 在前、内置厂商在后；同 id 去重且 settings 优先；
  // displayName 取 settings 配置的 displayName（无则回退 provider id）。
  // modelsByProvider：每个 provider 的模型 id 数组 = settings.models（保序）+ 内置模型（去重补集）。
  const pOrder = [];
  const pSource = {}; // provider → 'settings' | 'builtin'
  const pDisplay = {}; // provider → displayName
  const mbp = {}; // provider → [模型id...]
  if (providers && typeof providers === 'object') {
    for (const [pname, p] of Object.entries(providers)) {
      if (!p || typeof p !== 'object') continue;
      pOrder.push(pname);
      pSource[pname] = 'settings';
      if (typeof p.displayName === 'string' && p.displayName) pDisplay[pname] = p.displayName;
      const ids = [];
      if (Array.isArray(p.models)) {
        for (const m of p.models) {
          const id = m && typeof m === 'object' ? m.id : m;
          if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
        }
      }
      mbp[pname] = ids;
    }
  }
  if (catalogLoaded) {
    for (const prov of catalog.providers) {
      const base = mbp[prov] || [];
      const extra = [];
      for (const mid of catalog.modelsByProvider[prov] || []) {
        if (!base.includes(mid) && !extra.includes(mid)) extra.push(mid);
      }
      if (!(prov in pSource)) {
        pOrder.push(prov);
        pSource[prov] = 'builtin';
      }
      mbp[prov] = base.concat(extra);
    }
  }
  const providerMeta = pOrder.map((id) => ({
    provider: id,
    displayName: pDisplay[id] || id,
    source: pSource[id] === 'settings' ? 'settings' : 'builtin',
  }));

  // ── modelEfforts：provider → modelId → 思考级别数组 | null（D 项，前端 effort select 联动依据）──
  // 内置模型取 loadPiAiCatalog 已算好的真实支持级（与运行时 resolveReasoningLevel 同源）；
  // settings 自定义模型一律 null（未声明；含"内置目录之外的自定义 provider/id 形态"，如 router-9888）。
  // 边界：settings 模型 id 与内置目录同 provider 下同 id 重合时（如按内置 id 自建 endpoint），
  //       保留内置目录支持级（id 相同视为同名模型能力共享）。
  const me = {};
  if (catalogLoaded) {
    for (const prov of catalog.providers) {
      me[prov] = { ...(catalog.modelEfforts && catalog.modelEfforts[prov]) };
    }
  }
  if (providers && typeof providers === 'object') {
    const builtinIdsPerProvider = {};
    if (catalogLoaded) {
      for (const prov of catalog.providers) {
        builtinIdsPerProvider[prov] = new Set(catalog.modelsByProvider[prov] || []);
      }
    }
    for (const [pname, p] of Object.entries(providers)) {
      if (!p || typeof p !== 'object' || !Array.isArray(p.models)) continue;
      if (!me[pname]) me[pname] = {};
      const builtinIds = builtinIdsPerProvider[pname] || new Set();
      for (const m of p.models) {
        const id = m && typeof m === 'object' ? m.id : m;
        if (typeof id !== 'string' || !id) continue;
        if (!builtinIds.has(id)) {
          // 从 settings.yaml 的 reasoningEfforts 推导支持级别（与 catalog 同级语义）
          const re = m && typeof m === 'object' ? m.reasoningEfforts : null;
          if (re && typeof re === 'object') {
            me[pname][id] = Object.entries(re)
              .filter(([, v]) => v !== null)
              .map(([k]) => k);
          } else {
            me[pname][id] = null;
          }
        }
      }
    }
  }
  return {
    count: out.length,
    builtinCount,
    settingsCount,
    catalogLoaded,
    models: out,
    providers: providerMeta,
    modelsByProvider: mbp,
    modelEfforts: me,
  };
}

/** llm-pi-ai 要求为正整数的模型数字字段（保存前防御：字符串可转数字则转 Number）。 */
const NUMERIC_MODEL_FIELDS = ['contextWindow', 'maxTokens'];

/**
 * 保存前规范化 providers 的数字字段（把"原厂 resolveProfiles 校验"变成保存硬前提）：
 * 遍历每个 provider 的 models，对 NUMERIC_MODEL_FIELDS 已知数字字段：
 *   - 值为纯数字字符串（/^\d+$/）→ 转 Number（即便前端传来字符串也修正）；
 *   - 值为不可转数字的字符串 → 拒绝保存（抛 400 说明 provider/模型/字段）；
 *   - 其余情况（非字符串、缺失）→ 保留原样。
 * 原地修改入参对象并返回，供 emitProviderBlock 直接使用。
 */
function normalizeNumericFields(providers) {
  const bad = [];
  for (const [pname, prov] of Object.entries(providers)) {
    if (!prov || typeof prov !== 'object' || !Array.isArray(prov.models)) continue;
    for (const m of prov.models) {
      if (!m || typeof m !== 'object') continue;
      for (const key of NUMERIC_MODEL_FIELDS) {
        if (typeof m[key] !== 'string') continue;
        if (/^\d+$/.test(m[key])) {
          m[key] = Number(m[key]);
        } else {
          const mid = typeof m.id === 'string' ? m.id : '(未命名)';
          bad.push(
            `provider ${JSON.stringify(pname)} 模型 ${JSON.stringify(mid)} 的 ${key}=${JSON.stringify(m[key])} 不是正整数`,
          );
        }
      }
    }
  }
  if (bad.length) throw httpError(400, bad.join('；'));
  return providers;
}

/** 原厂 llm-pi-ai 受支持 wire 协议（provider.ts PROTOCOLS 表键；buildProvider 对表外值直接抛错 → 全或零）。
 *  注意：config-ui 表单第二选项 "anthropic-completions" 不在原厂表内（表为 openai-completions/openai-responses/
 *  anthropic-messages），放行会在"写入→重启"后静默全挂（与 SuanLi 数字污染同机制），故按原厂受支持集校验并拒绝之，
 *  提示改用 anthropic-messages。 */
const SUPPORTED_WIRE_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages'];

/** provider 级已移除字段（原厂 config.ts rejectRemovedFields，键存在即拒，含显式 undefined）。 */
const REMOVED_PROVIDER_FIELDS = ['provider', 'maxRetries', 'maxRetryDelayMs'];

/**
 * 保存前语义校验（把原厂 llm-pi-ai resolveProfiles/config.ts + catalog.ts resolveRouteModels 的
 * 硬拒绝项前置到写盘之前）：原厂对 providers 段的校验是"全部或零"且失败时静默禁用全部路由，
 * 任何一项不过都会在下次重启时把全部 provider 打掉（SuanLi 事故机制），故这里逐项 400 拒绝落盘。
 * 在 normalizeNumericFields 之后调用（数字字段已转 Number，只查非数字语义）。
 * @param providers 已通过外层对象校验的 providers 字典
 * @param catalogRouteCheck 可选：判断 provider 名是否由内置 pi-ai 目录描述（默认走 loadPiAiCatalog；
 *   目录不可加载时按未知路由处理，保证空 models 不会放行进原厂拒绝区，fail-closed）。
 */
function validateProvidersSemantics(providers, catalogRouteCheck) {
  const knownRoute =
    typeof catalogRouteCheck === 'function'
      ? catalogRouteCheck
      : (pname) => {
          try {
            const cat = loadPiAiCatalog();
            return !!(
              cat &&
              cat.loaded &&
              Array.isArray(cat.providers) &&
              cat.providers.includes(pname)
            );
          } catch {
            return false;
          }
        };
  const bad = [];
  for (const [pname, prov] of Object.entries(providers)) {
    if (typeof pname !== 'string' || pname.length === 0) {
      bad.push(`provider 名必须为非空字符串（实际 ${JSON.stringify(pname)}）`);
      continue;
    }
    if (!prov || typeof prov !== 'object' || Array.isArray(prov)) {
      bad.push(`provider ${JSON.stringify(pname)} 必须是对象（实际 ${JSON.stringify(prov)}）`);
      continue;
    }
    // 1) 已移除字段（config.ts L360-368 rejectRemovedFields：键存在即拒绝）
    for (const f of REMOVED_PROVIDER_FIELDS) {
      if (f in prov) {
        bad.push(
          f === 'provider'
            ? `provider ${JSON.stringify(pname)} 设置了 "provider" 字段，它已移到 providers 字典键（请删除该字段）`
            : `provider ${JSON.stringify(pname)} 设置了已移除字段 "${f}"（请删除；agent 重试恢复请用 dsh-llm-retry 编排）`,
        );
      }
    }
    // 2) baseURL：存在则必须是非空字符串（config.ts L390-392 空 baseURL 拒绝；不校验 URL 格式）
    if ('baseURL' in prov && (typeof prov.baseURL !== 'string' || prov.baseURL.length === 0)) {
      bad.push(
        `provider ${JSON.stringify(pname)} 的 baseURL 必须是非空字符串（实际 ${JSON.stringify(prov.baseURL)}）`,
      );
    }
    // 3) displayName：存在则必须是非空字符串（config.ts L393-395 空 displayName 拒绝；表单可直接产生空值）
    if (
      'displayName' in prov &&
      (typeof prov.displayName !== 'string' || prov.displayName.length === 0)
    ) {
      bad.push(
        `provider ${JSON.stringify(pname)} 的 displayName 必须是非空字符串（实际 ${JSON.stringify(prov.displayName)}）`,
      );
    }
    // 4) api：存在则必须是原厂受支持协议（config.ts L310 z.union(supportedProtocols())；provider.ts L177-183 表外值抛错）
    if ('api' in prov && !SUPPORTED_WIRE_PROTOCOLS.includes(prov.api)) {
      bad.push(
        prov.api === 'anthropic-completions'
          ? `provider ${JSON.stringify(pname)} 的 api="anthropic-completions" 不在原厂受支持协议内（原厂: ${SUPPORTED_WIRE_PROTOCOLS.join(', ')}）；如需 Anthropic 兼容端点请改用 anthropic-messages`
          : `provider ${JSON.stringify(pname)} 的 api=${JSON.stringify(prov.api)} 不是受支持协议（原厂: ${SUPPORTED_WIRE_PROTOCOLS.join(', ')}）`,
      );
    }
    // 5) apiKeyEnv：存在则必须是非空字符串（缺失允许：无 key 的 provider 合法）
    if (
      'apiKeyEnv' in prov &&
      (typeof prov.apiKeyEnv !== 'string' || prov.apiKeyEnv.length === 0)
    ) {
      bad.push(
        `provider ${JSON.stringify(pname)} 的 apiKeyEnv 必须是非空字符串（实际 ${JSON.stringify(prov.apiKeyEnv)}）`,
      );
    }
    // 6) models：缺失或空数组 → 内置目录已知路由允许（catalog.ts L786-789：空=缺失=服务内置目录）；
    //    目录未知路由拒绝（catalog.ts L819-822：'resolves no models; must be listed' → 全或零）。
    const models = prov.models;
    if (models === undefined || (Array.isArray(models) && models.length === 0)) {
      if (!knownRoute(pname)) {
        bad.push(
          `provider ${JSON.stringify(pname)} 必须有 models（缺失或空数组；内置目录未描述该路由，原厂会拒绝整个 providers 段）`,
        );
      }
    } else if (!Array.isArray(models)) {
      bad.push(
        `provider ${JSON.stringify(pname)} 的 models 必须是数组（实际 ${JSON.stringify(models)}）`,
      );
    } else {
      const seenIds = new Set();
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (!m || typeof m !== 'object' || Array.isArray(m)) {
          bad.push(
            `provider ${JSON.stringify(pname)} 模型 #${i + 1} 必须是对象（实际 ${JSON.stringify(m)}）`,
          );
          continue;
        }
        const mid = m.id;
        if (typeof mid !== 'string' || mid.length === 0) {
          bad.push(
            `provider ${JSON.stringify(pname)} 模型 #${i + 1} 的 id 必须是非空字符串（实际 ${JSON.stringify(mid)}）`,
          );
        } else if (seenIds.has(mid)) {
          // catalog.ts L835：any model listed more than once → 拒绝
          bad.push(
            `provider ${JSON.stringify(pname)} 模型 ${JSON.stringify(mid)} 重复（原厂拒绝重复 id）`,
          );
        }
        seenIds.add(mid);
      }
    }
  }
  if (bad.length) throw httpError(400, `provider 校验失败：${bad.join('；')}`);
  return providers;
}

/** PUT providers：规范化数字字段 → 语义校验 → 读全文件 → 替换 providers 段 → js-yaml 验证 → 备份 → 原子写。 */
async function putProviders(providers) {
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    throw httpError(400, 'body 需为 providers 对象（形如 {"providers": {...}} 或直接 {...}）');
  }
  // 写前规范化：contextWindow/maxTokens 字符串数字转 Number（不可转 → 400 拒绝保存）
  normalizeNumericFields(providers);
  // 写前语义校验：原厂 resolveProfiles 硬拒绝项前置（已移除字段/baseURL/api/models 等），
  // 400 拒绝落盘，绝不让"写入→重启→静默全挂"再现（normalize 之后调用：数字已转 Number）
  validateProvidersSemantics(providers);
  let text;
  try {
    text = await fsp.readFile(SETTINGS_FILE, 'utf8');
  } catch {
    text = '';
  }
  const lines = text.split('\n');
  const seg = locateProvidersSegment(lines);
  const blockLines = [`  providers:`, ...emitProviderBlock(providers, 4).split('\n')];
  let next;
  if (seg) {
    next = [...lines.slice(0, seg.start), ...blockLines, ...lines.slice(seg.end)];
  } else {
    const idx = lines.findIndex((l) => /^llm-pi-ai\s*:/.test(l));
    if (idx >= 0) {
      next = [...lines.slice(0, idx + 1), ...blockLines, ...lines.slice(idx + 1)];
    } else {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      next = [...lines, 'llm-pi-ai:', ...blockLines];
    }
  }
  // 去尾部多余空行，保留一个换行结束
  while (next.length && next[next.length - 1] === '') next.pop();
  const content = next.join('\n') + '\n';
  // 写前用 js-yaml 验证新内容可解析（可用时；不可用则跳过，行级写路径本身不依赖 YAML）
  if (jsYaml) {
    try {
      jsYaml.load(content);
    } catch (err) {
      throw httpError(500, `生成的 YAML 无法解析，已拒绝保存（未改动文件）: ${err.message}`);
    }
  }
  const bakSource = await backup(SETTINGS_FILE);
  await atomicWrite(SETTINGS_FILE, content, 0o644);
  return { ok: true, backup: bakSource, bytes: Buffer.byteLength(content) };
}

/* ─────────────── keys: .credentials.yaml / dsh.env 掩码读写 ─────────────── */

/** 掩码规则：sk- 前缀保留并加 ****，其余值前 4 字符替换为 ****；尾部保留 4 位。 */
function maskSecret(value) {
  const s = String(value);
  const tail = s.length > 4 ? s.slice(-4) : s;
  if (s.startsWith('sk-')) return `sk-${MASK}${s.length > 4 ? tail : ''}`;
  return `${MASK}${s.length > 4 ? tail : ''}`;
}

function parseEnv(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) entries.push({ name, value });
  }
  return entries;
}

/**
 * 解析原厂凭据文档 ${CONFIG_DIR}/.credentials.yaml → { refs: {KEY→VALUE}, version: number|null, error? }。
 * 兼容两种布局（fail-open，解析失败不抛异常）：
 *   a. v1 布局（version: 1 + refs: 段）：取 root.refs 映射、version 取 root.version，忽略 records 私有段；
 *   b. 扁平预发布布局（无 version 头）：顶层所有 KEY: VALUE 均视为 refs。
 */
function parseCredentialsFile(text) {
  const out = { refs: {}, version: null };
  if (typeof text !== 'string' || text.trim() === '') return out;
  try {
    if (!jsYaml) return parseCredentialsFileLight(text);
    const doc = jsYaml.load(text);
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      out.error = '凭据文件顶层不是对象';
      return out;
    }
    const hasVersion = Object.prototype.hasOwnProperty.call(doc, 'version');
    const refsNode = doc.refs;
    if (refsNode && typeof refsNode === 'object' && !Array.isArray(refsNode)) {
      // v1 布局：root.refs（records 私有段天然忽略）
      for (const [k, v] of Object.entries(refsNode)) {
        if (v === null || v === undefined) continue;
        out.refs[k] = typeof v === 'string' ? v : String(v);
      }
      out.version = typeof doc.version === 'number' ? doc.version : null;
      return out;
    }
    if (!hasVersion) {
      // 扁平布局：顶层所有标量键视为 refs
      for (const [k, v] of Object.entries(doc)) {
        if (k === 'version' || k === 'refs' || k === 'records') continue;
        if (v === null || v === undefined || typeof v === 'object') continue;
        out.refs[k] = typeof v === 'string' ? v : String(v);
      }
      return out;
    }
    out.version = typeof doc.version === 'number' ? doc.version : null;
    return out;
  } catch (err) {
    out.error = `凭据文件解析失败: ${err.message}`;
    return out;
  }
}

/** js-yaml 不可用时的轻量行解析：v1（version/refs/records 头）与扁平布局均可。 */
function parseCredentialsFileLight(text) {
  const refs = {};
  let version = null;
  let sawRefs = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const indent = /^(\s*)/.exec(line)[1].length;
    const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(t);
    if (!m) continue;
    const key = m[1];
    const valRaw = m[2];
    const val = valRaw === '' ? '' : unquote(valRaw);
    if (indent === 0) {
      if (key === 'refs' && valRaw === '') {
        sawRefs = true;
        continue;
      }
      if (key === 'version') {
        version = /^\d+$/.test(val) ? Number(val) : null;
        continue;
      }
      if (key === 'records' && valRaw === '') {
        sawRefs = false;
        continue;
      } // records 私有段跳过
      if (!sawRefs) refs[key] = val; // 扁平布局
    } else if (sawRefs && indent === 2) {
      refs[key] = val;
    }
  }
  return { refs, version };
}

/** 行级判定 .credentials.yaml 布局：首个非空非注释行是 version/refs 头（v1）还是 KEY: VALUE（扁平）。 */
function hasCredentialsVersionHeader(lines) {
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (/^version\s*:/.test(t) || /^refs\s*:/.test(t)) return true;
    return false;
  }
  return false;
}

/** 收集 settings.yaml llm-pi-ai.providers[*].apiKeyEnv 全部变量名（去重、保序）。 */
async function listApiKeyEnvNames() {
  let text = '';
  try {
    text = await fsp.readFile(SETTINGS_FILE, 'utf8');
  } catch {
    return [];
  }
  const names = [];
  try {
    const doc = parseYaml(text, SETTINGS_FILE);
    const providers = doc && doc['llm-pi-ai'] && doc['llm-pi-ai'].providers;
    if (providers && typeof providers === 'object') {
      for (const p of Object.values(providers)) {
        if (p && typeof p === 'object' && typeof p.apiKeyEnv === 'string') {
          if (!names.includes(p.apiKeyEnv)) names.push(p.apiKeyEnv);
        }
      }
    }
  } catch {
    /* settings 解析失败 → 无 env 名 */
  }
  return names;
}

// 全应用密钥目录：settings apiKeyEnv 动态追加，其余为已知应用声明的 key 变量名。
// 分类顺序即展示顺序；首键命中优先（DEEPSEEK_API_KEY 同时被模型 provider 与搜索用到 → 归网络搜索）。
const APP_KEY_CATEGORIES = {
  网络搜索: [
    'EXA_API_KEY',
    'TAVILY_API_KEY',
    'KEENABLE_API_KEY',
    'PERPLEXITY_API_KEY',
    'DEEPSEEK_API_KEY',
  ],
  GitHub: ['GITHUB_TOKEN', 'GH_TOKEN'],
  其他: ['GOOGLE_API_KEY', 'OPENAI_API_KEY'],
};
const CATEGORY_OF_KEY = {};
for (const [cat, names] of Object.entries(APP_KEY_CATEGORIES)) {
  for (const n of names) if (!(n in CATEGORY_OF_KEY)) CATEGORY_OF_KEY[n] = cat;
}

/**
 * 只读解析 shell 启动环境文件（~/.bashrc、~/.profile、~/.zshrc，存在才读）中的 export KEY=... 行。
 *  - 行级正则：export 前缀行与裸 `NAME=VALUE` 行；value 复用 unquote 去引号并剥离行尾注释
 *  - 只收 KEY/TOKEN/SECRET/API 结尾、或名字含 KEY/TOKEN 的变量（避免展示无关变量）
 *  - 返回 Map name → {value, file}，首个命中文件优先（.bashrc → .profile → .zshrc）
 *  - 只读展示，绝不写这些文件；解析失败/无文件 → 空 Map
 */
function readShellRcKeys() {
  const out = new Map();
  const home = process.env.HOME || '.';
  for (const base of ['.bashrc', '.profile', '.zshrc']) {
    const file = path.join(home, base);
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; /* 文件不存在/不可读 → 跳过 */
    }
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!m) continue;
      let name = m[1];
      if (!/(KEY|TOKEN|SECRET|API)$/.test(name) && !/(KEY|TOKEN)/.test(name)) continue;
      let value = unquote(m[2]);
      value = value.replace(/\s+#.*$/, ''); // 行尾注释剥离（仅在引号外出现 # 的场景；值本身含 # 罕见）
      if (!out.has(name)) out.set(name, { value, file: base });
    }
  }
  return out;
}

/**
 * 只读解析 gh CLI 系统凭据 ~/.config/gh/hosts.yml 中 github.com 段的 oauth_token。
 *  - 行级匹配：顶层 host 段为 github.com 时，收集首个 oauth_token 行与 user 行
 *  - 返回 { host:'github.com', user?, token } 或 null（无文件/无 token）
 *  - 只读展示，绝不写该文件
 */
function readGhToken() {
  const file = path.join(process.env.HOME || '.', '.config', 'gh', 'hosts.yml');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let inSection = false;
  let token = null;
  let user = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      // 顶层键 = host 段名
      inSection = /^github\.com\s*:?\s*$/.test(t);
      continue;
    }
    if (!inSection) continue;
    const mTok = /^oauth_token\s*:\s*(.*)$/.exec(t);
    if (mTok && token === null) token = unquote(mTok[1].split(' #')[0]);
    const mUsr = /^user\s*:\s*(.*)$/.exec(t);
    if (mUsr && user === null) user = unquote(mUsr[1]);
    if (token !== null && user !== null) break;
  }
  if (!token) return null;
  return { host: 'github.com', user, token };
}

/** 键所属来源优先级数组（从高到低，用于判定 configured 与 source 标注）。 */
const KEY_SOURCES = [
  {
    key: 'env',
    get: (name) =>
      process.env[name] !== undefined && process.env[name] !== '' ? process.env[name] : null,
  },
  {
    key: 'credentials.yaml',
    get: (name, ctx) =>
      typeof ctx.credRefs[name] === 'string' && ctx.credRefs[name] !== ''
        ? ctx.credRefs[name]
        : null,
  },
  { key: 'dsh.env', get: (name, ctx) => (ctx.dshMap[name] ? ctx.dshMap[name] : null) },
  { key: 'bashrc', get: (name, ctx) => (ctx.rcMap.has(name) ? ctx.rcMap.get(name).value : null) },
  {
    key: 'gh',
    get: (name, ctx) =>
      ctx.ghToken && (name === 'GITHUB_TOKEN' || name === 'GH_TOKEN') ? ctx.ghToken.token : null,
  },
];

/**
 * GET /api/keys：全应用密钥目录（模型 Provider / 网络搜索 / GitHub / 其他）多源枚举（真实机制对齐）。
 *  - 枚举键（去重、保序）：settings apiKeyEnv（category '模型 Provider'）→ APP_KEY_CATEGORIES 声明键
 *    → 凭据文件 refs 键 → dsh.env 键；每键 category：settings 名 '模型 Provider'、目录命中取分类、其余 '其他'
 *  - 判定优先级（首个命中即 configured=true）：process.env → .credentials.yaml refs → dsh.env
 *    → shell rc（readShellRcKeys，source 'bashrc'）→ gh hosts.yml（仅 GITHUB_TOKEN/GH_TOKEN，source 'gh'）
 *  - masked 统一 maskSecret；'gh' 来源值形如 ghp_***（maskSecret 非 sk- 前缀取前4→**** + 尾4）
 *  - 返回附 shellRcFiles（已读取的 rc 文件名）与 ghHost（'github.com'|null）供前端提示
 *  - ignoredDsh = 凭据文件与 dsh.env 中重复 settings apiKeyEnv 名而未被单独列出的数量
 */
async function getKeys() {
  let credText = '';
  try {
    credText = await fsp.readFile(CREDENTIALS_FILE, 'utf8');
  } catch {
    /* 凭据文件不存在 → 无 refs */
  }
  let dshText = '';
  try {
    dshText = await fsp.readFile(ENV_FILE, 'utf8');
  } catch {
    /* dsh.env 不存在 → 无条目 */
  }
  const envNames = await listApiKeyEnvNames();
  const cred = parseCredentialsFile(credText);
  const credRefs = cred.refs || {};
  const dshMap = {};
  for (const { name, value } of parseEnv(dshText)) dshMap[name] = value;
  const rcMap = readShellRcKeys();
  const ghToken = readGhToken();
  // 实际存在的 shell rc 文件（只读探测，供前端提示显示来源）
  const homeDir = process.env.HOME || '.';
  const shellRcFiles = ['.bashrc', '.profile', '.zshrc'].filter((b) => {
    try {
      fs.accessSync(path.join(homeDir, b));
      return true;
    } catch {
      return false;
    }
  });

  // 枚举键：settings apiKeyEnv → APP_KEY_CATEGORIES 声明键 → 凭据 refs 键 → dsh.env 键（去重、保序）
  const order = [];
  const categoryOf = {};
  for (const n of envNames) {
    if (!order.includes(n)) {
      order.push(n);
      categoryOf[n] = '模型 Provider';
    }
  }
  for (const names of Object.values(APP_KEY_CATEGORIES)) {
    for (const n of names) {
      if (!order.includes(n)) {
        order.push(n);
        categoryOf[n] = CATEGORY_OF_KEY[n] || '其他';
      }
    }
  }
  for (const n of Object.keys(credRefs)) {
    if (!order.includes(n)) {
      order.push(n);
      categoryOf[n] = CATEGORY_OF_KEY[n] || '其他';
    }
  }
  for (const n of Object.keys(dshMap)) {
    if (!order.includes(n)) {
      order.push(n);
      categoryOf[n] = CATEGORY_OF_KEY[n] || '其他';
    }
  }

  const envSet = new Set(envNames);
  let ignoredDsh = 0;
  for (const n of Object.keys(credRefs)) if (envSet.has(n)) ignoredDsh++;
  for (const n of Object.keys(dshMap)) if (envSet.has(n)) ignoredDsh++;

  const items = [];
  for (const name of order) {
    const ctx = { credRefs, dshMap, rcMap, ghToken };
    let source = null; // 未命中任何源 → null（前端显示 '—'，避免误标"环境变量"）
    let value = null;
    let hit = false;
    for (const src of KEY_SOURCES) {
      const v = src.get(name, ctx);
      if (v !== null && v !== undefined && v !== '') {
        source = src.key;
        value = v;
        hit = true;
        break;
      }
    }
    const item = {
      name,
      category: categoryOf[name] || '其他',
      source,
      configured: hit,
      set: hit,
      masked: hit ? maskSecret(value) : '—',
    };
    if (source === 'bashrc' && rcMap.has(name)) item.file = rcMap.get(name).file;
    items.push(item);
  }
  items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    keys: items,
    count: items.length,
    credentialFile: CREDENTIALS_FILE,
    credentialFileExists: credText !== '',
    credentialFileVersion: cred.version,
    dshEnv: ENV_FILE,
    dshEnvExists: dshText !== '',
    ignoredDsh,
    shellRcFiles,
    ghHost: ghToken ? 'github.com' : null,
    ghUser: ghToken && ghToken.user ? ghToken.user : null,
  };
}

/**
 * POST /api/keys：写 KEY=VALUE 到原厂凭据文档 ${CONFIG_DIR}/.credentials.yaml（受管 v1/扁平兼容）。
 *  - 文件不存在 → 新建 v1 布局（version: 1 + refs:）
 *  - 既有扁平布局 → 迁移为 v1：保留原行，顶层 KEY 行缩进 2 空格移入 refs: 段
 *  - 既有 v1 → refs: 段内行级覆写/追加（无 refs 段则新增）
 *  - 备份 + 原子写 + chmod 600；写失败抛 500 带原因，绝不写 dsh.env。
 */
async function postKey({ name, value }) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw httpError(400, `name 非法（需 ^[A-Za-z_][A-Za-z0-9_]*$）: ${String(name)}`);
  }
  if (typeof value !== 'string' || value.includes('\n')) {
    throw httpError(400, 'value 必须为非空单行字符串');
  }
  const rendered = renderScalar(value);

  let existing = '';
  try {
    existing = await fsp.readFile(CREDENTIALS_FILE, 'utf8');
  } catch {
    existing = ''; /* 文件不存在 → 按 v1 新建 */
  }

  let content;
  let replaced = false;
  if (existing === '') {
    content = `version: 1\nrefs:\n  ${name}: ${rendered}\n`;
  } else {
    const lines = existing.split('\n');
    if (!hasCredentialsVersionHeader(lines)) {
      // 扁平布局 → 迁移 v1：version + refs，原顶层 KEY 行缩进 2 空格移入 refs:（保留注释/未知行）
      const out = ['version: 1', 'refs:'];
      const seen = new Set();
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        const t = line.trim();
        if (!t || t.startsWith('#')) {
          out.push(line);
          continue;
        }
        const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(t);
        if (!m) {
          out.push(line);
          continue;
        }
        if (seen.has(m[1])) continue; // 同名去重
        seen.add(m[1]);
        if (m[1] === name) {
          out.push(`  ${m[1]}: ${rendered}`);
          replaced = true;
        } else {
          out.push(`  ${m[1]}: ${m[2]}`);
        }
      }
      if (!replaced) out.push(`  ${name}: ${rendered}`); // 新键追加到 refs 末尾
      content = out.join('\n') + '\n';
    } else {
      // v1：refs 段行级覆写/追加（无 refs 段 → 文件尾部新增）
      const refsIdx = lines.findIndex((l) => /^refs\s*:\s*$/.test(l.replace(/\r$/, '').trim()));
      if (refsIdx === -1) {
        if (lines.length && lines[lines.length - 1] !== '') lines.push('');
        lines.push('refs:', `  ${name}: ${rendered}`);
      } else {
        let refsEnd = lines.length;
        for (let i = refsIdx + 1; i < lines.length; i++) {
          const t = lines[i].replace(/\r$/, '').trim();
          if (!t || t.startsWith('#')) continue;
          if (!/^\s/.test(lines[i])) {
            refsEnd = i;
            break;
          }
        }
        const pat = new RegExp(`^\\s{2}${name}\\s*:`);
        let found = -1;
        for (let i = refsIdx + 1; i < refsEnd; i++) {
          if (pat.test(lines[i])) {
            found = i;
            break;
          }
        }
        if (found >= 0) {
          lines[found] = replaceValueInLine(lines[found], value); // 保留行尾注释
          replaced = true;
        } else {
          lines.splice(refsEnd, 0, `  ${name}: ${rendered}`);
        }
      }
      content = lines.join('\n') + '\n';
    }
  }

  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  let bak = null;
  try {
    bak = await backup(CREDENTIALS_FILE);
    await atomicWrite(CREDENTIALS_FILE, content, 0o600);
  } catch (err) {
    throw httpError(500, `写入凭据文件失败（${CREDENTIALS_FILE}）: ${err.message}`);
  }
  return {
    ok: true,
    name,
    target: 'credentials.yaml',
    file: CREDENTIALS_FILE,
    backup: bak,
    replaced,
  };
}

/**
 * DELETE /api/keys：从 ${CONFIG_DIR}/.credentials.yaml 与 ${CONFIG_DIR}/dsh.env 行级删除 KEY。
 *  - name 校验同 postKey（^[A-Za-z_][A-Za-z0-9_]*$，非法 400）
 *  - 凭据文件：v1 布局删 refs: 段内缩进 2 空格键行；扁平布局删顶层 name: value 行；只删首个命中
 *  - dsh.env：存在且含 `name=` 行 → 行级删除（`name=` 前缀行，只删首个命中）
 *  - 两处都无该键 → 不写文件，返回 removed:false + 环境变量说明（不删 process.env）
 *  - 有实际改动 → backup() + atomicWrite（凭据文件 0o600、dsh.env 0o600）
 */
async function deleteKey({ name }) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw httpError(400, `name 非法（需 ^[A-Za-z_][A-Za-z0-9_]*$）: ${String(name)}`);
  }

  let credText = '';
  try {
    credText = await fsp.readFile(CREDENTIALS_FILE, 'utf8');
  } catch {
    /* 凭据文件不存在 → 无 refs */
  }
  let dshText = '';
  try {
    dshText = await fsp.readFile(ENV_FILE, 'utf8');
  } catch {
    /* dsh.env 不存在 → 无条目 */
  }

  const credRefs = parseCredentialsFile(credText).refs || {};
  const credHas = typeof credRefs[name] === 'string' && credRefs[name] !== '';
  const dshHas = parseEnv(dshText).some((e) => e.name === name);
  if (!credHas && !dshHas) {
    return {
      ok: true,
      name,
      removed: false,
      from: [],
      note: '凭据文件与 dsh.env 均无此键，密钥可能仅存在于环境变量（config-ui 无法删除进程环境变量，请清理 dsh 启动脚本或 systemd 环境）',
    };
  }

  const from = [];
  let credContent = null;
  let dshContent = null;

  if (credHas && credText !== '') {
    const lines = credText.split('\n');
    if (hasCredentialsVersionHeader(lines)) {
      // v1 布局：refs: 段内缩进 2 空格且键名等于 name 的行（只删首个命中；refs 段删空时 refs: 头行保留）
      const refsIdx = lines.findIndex((l) => /^refs\s*:\s*$/.test(l.replace(/\r$/, '').trim()));
      if (refsIdx !== -1) {
        let refsEnd = lines.length;
        for (let i = refsIdx + 1; i < lines.length; i++) {
          const t = lines[i].replace(/\r$/, '').trim();
          if (!t || t.startsWith('#')) continue;
          if (!/^\s/.test(lines[i])) {
            refsEnd = i;
            break;
          }
        }
        const pat = new RegExp(`^\\s{2}${name}\\s*:`);
        for (let i = refsIdx + 1; i < refsEnd; i++) {
          if (pat.test(lines[i])) {
            lines.splice(i, 1);
            break;
          }
        }
      }
    } else {
      // 扁平布局：删除顶层（缩进 0）等于 name 的 `name: value` 行（只删首个命中）
      const pat = new RegExp(`^${name}\\s*:`);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (!line.trim() || line.trimStart().startsWith('#')) continue;
        if (/^\s/.test(lines[i])) continue;
        if (pat.test(lines[i])) {
          lines.splice(i, 1);
          break;
        }
      }
    }
    credContent = lines.join('\n') + '\n';
    from.push('credentials.yaml');
  }

  if (dshHas && dshText !== '') {
    const lines = dshText.split('\n');
    const pat = new RegExp(`^\\s*${name}\\s*=`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      if (pat.test(lines[i])) {
        lines.splice(i, 1);
        break;
      }
    }
    dshContent = lines.join('\n') + '\n';
    from.push('dsh.env');
  }

  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  const baks = {};
  try {
    if (credContent !== null) {
      baks.credentials = await backup(CREDENTIALS_FILE);
      await atomicWrite(CREDENTIALS_FILE, credContent, 0o600);
    }
    if (dshContent !== null) {
      baks['dsh.env'] = await backup(ENV_FILE);
      await atomicWrite(ENV_FILE, dshContent, 0o600);
    }
  } catch (err) {
    throw httpError(500, `删除密钥写入失败: ${err.message}`);
  }
  return {
    ok: true,
    name,
    removed: true,
    from,
    backup: baks,
    note: '已从凭据文件中删除（环境变量中的同名值不受影响，如来自启动环境）',
  };
}

/* ─────────────── subagents: agent.cordis.yml 字段读写 ─────────────── */

// PUT 可编辑字段 → 归一为挂载层 agentOptions 键（model/provider/reasoningEffort）。
// 真实机制：子代理的独立模型配置在挂载层 full/agent.cordis.yml 的
// tool-subagent-<id>.config.agentOptions，preset 文件本身无 model 字段。
const MOUNT_FIELD_MAP = {
  model: 'model',
  provider: 'provider',
  reasoningEffort: 'reasoningEffort',
  'agentOptions.model': 'model',
  'agentOptions.provider': 'provider',
};

/** 从 YAML 文档树收集 model/provider/思考级别相关字段（带点分路径）。 */
function collectModelFields(doc) {
  const hits = [];
  const walk = (node, prefix) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${prefix}[${i}]`));
      return;
    }
    if (typeof node !== 'object') return;
    const entries = Object.entries(node);
    const hasModelSibling = entries.some(([k]) => k === 'model');
    for (const [k, v] of entries) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `${p}[${i}]`));
      } else if (v && typeof v === 'object') {
        walk(v, p);
      } else if (
        k === 'model' ||
        k === 'reasoningEffort' ||
        k === 'effort' ||
        (k === 'reasoning' && typeof v === 'string') ||
        (k === 'provider' && hasModelSibling && !NON_MODEL_PROVIDERS.has(String(v)))
      ) {
        hits.push({ path: p, key: k, value: v === null ? null : String(v) });
      }
    }
  };
  walk(doc, '');
  return hits;
}

/** 行级定位：返回 key 链命中行。单键匹配任意缩进；多段路径逐段收窄子树。 */
function findKeyLines(lines, segments) {
  const hits = [];
  if (segments.length === 1) {
    const re = new RegExp(`^\\s*${escapeRe(segments[0])}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) hits.push({ line: i, indent: /^(\s*)/.exec(lines[i])[1].length });
    }
    return hits;
  }
  let scope = lines.map((l, i) => ({ i, text: l }));
  // 非末段用于逐级收窄子树；末段在收窄后的 scope 内匹配
  for (const seg of segments.slice(0, -1)) {
    const re = new RegExp(`^\\s*${escapeRe(seg)}\\s*:`);
    const matched = scope.filter(({ text }) => re.test(text));
    const next = [];
    for (const m of matched) {
      // 该 key 行之后、缩进更大的块即为下一段的搜索范围
      const baseIndent = /^(\s*)/.exec(m.text)[1].length;
      for (let j = m.i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '' || lines[j].trimStart().startsWith('#')) continue;
        const ind = /^(\s*)/.exec(lines[j])[1].length;
        if (ind <= baseIndent) break;
        next.push({ i: j, text: lines[j] });
      }
    }
    scope = next;
    if (!scope.length) break;
  }
  const finalRe = new RegExp(`^\\s*${escapeRe(segments[segments.length - 1])}\\s*:`);
  for (const s of scope) {
    if (finalRe.test(s.text)) hits.push({ line: s.i, indent: /^(\s*)/.exec(s.text)[1].length });
  }
  return hits;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ─────────────── 挂载层（full/agent.cordis.yml 的 tool-subagent-<id> 块） ─────────────── */

const MOUNT_TOOL_PREFIX = 'tool-subagent-';

/** 定位挂载文件中所有 `- id: tool-subagent-<id>` 块，返回 [{start, end, blockIndent}]。
 *  end = 块后首个缩进 <= 块缩进 的非空非注释行下标（或行数）。 */
function findMountBlocks(lines, id) {
  const idRe = new RegExp(`^(\\s*)-\\s*id:\\s*${escapeRe(MOUNT_TOOL_PREFIX + id)}\\s*$`);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = idRe.exec(lines[i]);
    if (!m) continue;
    const blockIndent = m[1].length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j];
      if (t.trim() === '' || t.trimStart().startsWith('#')) continue;
      if (/^(\s*)/.exec(t)[1].length <= blockIndent) {
        end = j;
        break;
      }
    }
    blocks.push({ start: i, end, blockIndent });
  }
  return blocks;
}

/** 在 [start,end) 内找缩进恰为 wantIndent 的 `key:` 行，返回行下标或 -1。 */
function findKeyAtIndent(lines, start, end, key, wantIndent) {
  const re = new RegExp(`^\\s*${escapeRe(key)}\\s*:`);
  for (let i = start; i < end; i++) {
    if (!re.test(lines[i])) continue;
    if (/^(\s*)/.exec(lines[i])[1].length === wantIndent) return i;
  }
  return -1;
}

/** 在 [start,end) 内找首个缩进 > minIndent 的非空非注释行，返回 {line, indent} 或 null。 */
function findSubtreeStart(lines, start, end, minIndent) {
  for (let i = start; i < end; i++) {
    const t = lines[i];
    if (t.trim() === '' || t.trimStart().startsWith('#')) continue;
    const ind = /^(\s*)/.exec(t)[1].length;
    if (ind > minIndent) return { line: i, indent: ind };
  }
  return null;
}

/** 子树结束位：在 [start,end) 内首个缩进 <= minIndent 的非空非注释行下标（无则 end）。 */
function subtreeEnd(lines, start, end, minIndent) {
  for (let i = start; i < end; i++) {
    const t = lines[i];
    if (t.trim() === '' || t.trimStart().startsWith('#')) continue;
    if (/^(\s*)/.exec(t)[1].length <= minIndent) return i;
  }
  return end;
}

/** 子树插入位：子树内最后一个非空非注释内容行的下一行。 */
function subtreeInsertPos(lines, start, end, minIndent) {
  let anchor = start;
  for (let i = start; i < end; i++) {
    const t = lines[i];
    if (t.trim() === '' || t.trimStart().startsWith('#')) continue;
    if (/^(\s*)/.exec(t)[1].length > minIndent) anchor = i;
  }
  return anchor + 1;
}

/** 读挂载块 config.agentOptions 的 provider/model/reasoningEffort（首个命中块）。无块/无 agentOptions → null。 */
function readMountAgentOptions(text, id) {
  const lines = text.split('\n');
  const blocks = findMountBlocks(lines, id);
  if (!blocks.length) return null;
  const b = blocks[0];
  const configIndent = b.blockIndent + 2;
  const configLine = findKeyAtIndent(lines, b.start, b.end, 'config', configIndent);
  if (configLine < 0) return null;
  const cfgSub = findSubtreeStart(lines, configLine + 1, b.end, configIndent);
  if (!cfgSub) return null;
  const aoLine = findKeyAtIndent(lines, cfgSub.line, b.end, 'agentOptions', cfgSub.indent);
  if (aoLine < 0) return null;
  const aoEnd = subtreeEnd(lines, aoLine + 1, b.end, cfgSub.indent);
  const out = {};
  for (const key of ['provider', 'model', 'reasoningEffort']) {
    const kl = findKeyAtIndent(lines, aoLine + 1, aoEnd, key, cfgSub.indent + 2);
    if (kl >= 0) {
      const m = new RegExp(`^\\s*${escapeRe(key)}\\s*:\\s*(.*)$`).exec(lines[kl]);
      out[key] = m ? unquote(m[1].split(' #')[0]) : null;
    } else {
      out[key] = null;
    }
  }
  return out;
}

/** 行级覆写/新增挂载块 agentOptions 字段（新增 agentOptions 块时含传入键；provider 缺省回退 settings 默认）。
 *  返回 { changed: [{key,line,old,new}], blocks }. */
function editMountAgentOptions(lines, id, values, defaultProvider) {
  const changed = [];
  const blocks = findMountBlocks(lines, id);
  if (!blocks.length) return { changed, blocks: 0 };
  for (const b of blocks) {
    const configIndent = b.blockIndent + 2;
    const configLine = findKeyAtIndent(lines, b.start, b.end, 'config', configIndent);
    if (configLine < 0) continue;
    const cfgSub = findSubtreeStart(lines, configLine + 1, b.end, configIndent);
    const childIndent = cfgSub ? cfgSub.indent : configIndent + 2;
    const aoLine = cfgSub
      ? findKeyAtIndent(lines, cfgSub.line, b.end, 'agentOptions', childIndent)
      : -1;
    const oldVal = (line) => {
      const m = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
      return m ? unquote(m[3].split(' #')[0]) : null;
    };
    if (aoLine >= 0) {
      const aoEnd = subtreeEnd(lines, aoLine + 1, b.end, childIndent);
      for (const [key, val] of Object.entries(values)) {
        const kl = findKeyAtIndent(lines, aoLine + 1, aoEnd, key, childIndent + 2);
        if (kl >= 0) {
          const before = lines[kl];
          lines[kl] = replaceValueInLine(before, val);
          changed.push({ key, line: kl + 1, old: oldVal(before), new: val });
        } else {
          const pos = subtreeInsertPos(lines, aoLine + 1, aoEnd, childIndent);
          lines.splice(pos, 0, `${' '.repeat(childIndent + 2)}${key}: ${renderScalar(val)}`);
          changed.push({ key, line: pos + 1, old: null, new: val });
        }
      }
    } else {
      // config 下无 agentOptions → 新增块（含传入键；provider 缺省用 settings 默认）
      const cfgEnd = subtreeEnd(lines, configLine + 1, b.end, configIndent);
      const pos = subtreeInsertPos(lines, configLine + 1, cfgEnd, configIndent);
      const entries = [];
      const prov = values.provider !== undefined ? values.provider : defaultProvider;
      if (prov) entries.push(['provider', prov]);
      for (const key of ['model', 'reasoningEffort']) {
        if (values[key] !== undefined) entries.push([key, values[key]]);
      }
      if (!entries.length) continue;
      const insert = [`${' '.repeat(childIndent)}agentOptions:`];
      for (const [key, val] of entries) {
        insert.push(`${' '.repeat(childIndent + 2)}${key}: ${renderScalar(val)}`);
      }
      lines.splice(pos, 0, ...insert);
      changed.push({
        key: 'agentOptions',
        line: pos + 1,
        old: null,
        new: `新增 agentOptions（${entries.map((e) => e[0]).join('/')}）`,
      });
    }
  }
  return { changed, blocks: blocks.length };
}

/** 整文件 YAML 校验（宽容 schema：!!js 标签按标量处理，兼容挂载层 disabled: !!js process.platform ...）。 */
let yamlValidateSchema = null;
function validateYamlText(text, label) {
  if (!jsYaml) {
    for (const raw of text.split('\n')) {
      const t = raw.trim();
      if (!t || t.startsWith('#') || t.startsWith('-') || /^[A-Za-z0-9_.-]+\s*:/.test(t)) continue;
      throw new Error(`${label}: 出现无法识别的行: ${t.slice(0, 60)}`);
    }
    return true;
  }
  if (!yamlValidateSchema) {
    const jsType = new jsYaml.Type('tag:yaml.org,2002:js', {
      kind: 'scalar',
      construct: (d) => String(d),
    });
    yamlValidateSchema = jsYaml.DEFAULT_SCHEMA.extend([jsType]);
  }
  try {
    jsYaml.load(text, { schema: yamlValidateSchema });
    return true;
  } catch (err) {
    throw new Error(`${label}: YAML 解析失败: ${err.message}`);
  }
}

/**
 * 读单个 preset：id + preset.yml 元信息 + agent.cordis.yml 的模型标注字段
 * + 生效模型（settings.yaml agent-default-model）。
 */
async function readPreset(id) {
  const dir = path.join(PRESETS_DIR, id);
  const cordisPath = path.join(dir, PRESET_FILE);
  const metaPath = path.join(dir, PRESET_META);

  let meta = {};
  try {
    const metaText = await fsp.readFile(metaPath, 'utf8');
    meta = parseYaml(metaText, metaPath);
  } catch {
    /* 无 preset.yml 或解析失败 */
  }

  let fields = [];
  let fileText = '';
  let cordisError = null;
  try {
    fileText = await fsp.readFile(cordisPath, 'utf8');
    const lines = fileText.split('\n');
    const doc = parseYaml(fileText, cordisPath);
    const hits = collectModelFields(doc);
    // 行号补全：去掉 [n] 数组下标段 → key 链定位；再按值二次确认
    const lineOf = (pathStr, value) => {
      const segs = pathStr.split('.').filter((s) => !/^\[\d+\]$/.test(s));
      const found = findKeyLines(lines, segs);
      const key = segs[segs.length - 1];
      for (const f of found) {
        const m = new RegExp(`^\\s*${escapeRe(key)}\\s*:\\s*(.*)$`).exec(lines[f.line]);
        if (m && unquote(m[1].split(' #')[0]) === String(value)) {
          return f.line + 1;
        }
      }
      return null;
    };
    fields = hits.map((h) => ({ ...h, line: lineOf(h.path, h.value) }));
  } catch (err) {
    cordisError = err.message;
  }

  // 生效模型多源解析（真实机制对齐，优先级）：
  //   ① 挂载层 full/agent.cordis.yml 的 tool-subagent-<id>.config.agentOptions → modelSource 'mount'
  //   ② preset 文件内 agentOptions 标注行                       → modelSource 'preset'
  //   ③ settings.yaml agent-default-model（inherited）        → modelSource 'default'
  let mountModel = null;
  try {
    const mountText = await fsp.readFile(FULL_PRESETS_FILE, 'utf8');
    mountModel = readMountAgentOptions(mountText, id);
  } catch {
    /* 挂载文件不存在/不可读 → mountModel 留 null（fail-open 下沉 preset/default） */
  }
  const ao = fields.find((f) => f.path.endsWith('agentOptions.model'));
  const presetModel = ao ? { provider: null, model: ao.value } : null;
  if (presetModel) {
    const aoP = fields.find((f) => f.path.endsWith('agentOptions.provider'));
    if (aoP) presetModel.provider = aoP.value;
  }
  let defaultModel = null;
  try {
    const doc = parseYaml(await fsp.readFile(SETTINGS_FILE, 'utf8'), SETTINGS_FILE);
    if (doc && doc['agent-default-model']) {
      defaultModel = {
        provider: doc['agent-default-model'].provider ?? null,
        model: doc['agent-default-model'].model ?? null,
      };
    }
  } catch {
    /* settings.yaml 不可读 → defaultModel 留 null */
  }

  let modelSource = 'none';
  let effective = { provider: null, model: null, source: '未配置' };
  if (mountModel && mountModel.model) {
    modelSource = 'mount';
    effective = {
      provider: mountModel.provider ?? null,
      model: mountModel.model,
      source: `full 挂载块 tool-subagent-${id}（agentOptions）`,
    };
  } else if (presetModel && presetModel.model) {
    modelSource = 'preset';
    effective = { ...presetModel, source: 'preset 文件标注（agentOptions）' };
  } else if (defaultModel && defaultModel.model) {
    modelSource = 'default';
    effective = { ...defaultModel, source: 'settings agent-default-model（inherited）' };
  }

  return {
    id,
    dir: id,
    name: meta.name ?? null,
    description: typeof meta.description === 'string' ? meta.description : null,
    effectiveModel: effective,
    modelSource,
    mountModel,
    fields,
    cordisError,
  };
}

/** 行内替换：仅改 value 部分，保留缩进与行尾注释。 */
function replaceValueInLine(line, newValue) {
  const m = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
  if (!m) return line;
  const [_, indent, key, rest] = m;
  // 注释（出现在值之后的 ` #`）
  let comment = '';
  let valuePart = rest;
  const ci = rest.indexOf(' #');
  if (ci >= 0) {
    comment = rest.slice(ci);
    valuePart = rest.slice(0, ci);
  }
  return `${indent}${key}: ${renderScalar(newValue)}${comment}`;
}

/** PUT 子代理：编辑走挂载层（FULL_PRESETS_FILE 的 tool-subagent-<id>.config.agentOptions），
 *  仅改指定字段，保留其余行/注释；备份 + 原子写 + YAML 校验（失败回滚）。 */
async function putSubagentFields(id, fields) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw httpError(400, `id 非法: ${id}`);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw httpError(
      400,
      'body 需为字段对象，如 {"model":"deepseek-v4-pro","reasoningEffort":"max"}',
    );
  }
  // 子代理 preset 目录必须存在
  try {
    await fsp.stat(path.join(PRESETS_DIR, id, PRESET_FILE));
  } catch {
    throw httpError(404, `子代理 ${id} 不存在（无 ${PRESET_FILE}）`);
  }
  const rejected = Object.keys(fields).filter((k) => !MOUNT_FIELD_MAP[k]);
  if (rejected.length) {
    throw httpError(
      422,
      `不支持的字段: ${rejected.join(', ')}（可编辑: model / provider / reasoningEffort，写入挂载层 agentOptions）`,
    );
  }
  const values = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
      throw httpError(400, `字段 ${k} 的值必须是标量`);
    }
    values[MOUNT_FIELD_MAP[k]] = String(v);
  }
  if (!Object.values(values).length) throw httpError(400, '没有可编辑字段');

  // settings 默认 provider（新增 agentOptions 块时回退用）
  let defaultProvider = null;
  try {
    const doc = parseYaml(await fsp.readFile(SETTINGS_FILE, 'utf8'), SETTINGS_FILE);
    if (doc && doc['agent-default-model'] && doc['agent-default-model'].provider) {
      defaultProvider = String(doc['agent-default-model'].provider);
    }
  } catch {
    /* 读不到 →默认 provider 留 null */
  }

  let fileText;
  try {
    fileText = await fsp.readFile(FULL_PRESETS_FILE, 'utf8');
  } catch {
    throw httpError(404, `full 挂载文件不可读：${FULL_PRESETS_FILE}`);
  }
  const lines = fileText.split('\n');
  const { changed, blocks } = editMountAgentOptions(lines, id, values, defaultProvider);
  if (!blocks) {
    throw httpError(
      404,
      `该子代理在 full 挂载中无 tool-subagent 块（${FULL_PRESETS_FILE}），默认走 settings；如需独立模型请用『＋添加』创建自定义`,
    );
  }
  if (!changed.length) {
    throw httpError(422, `挂载块 tool-subagent-${id} 无可写字段（agentOptions 更新未命中）`);
  }

  const content = lines.join('\n');
  // 写前校验：编辑结果必须仍是合法 YAML
  validateYamlText(content, FULL_PRESETS_FILE);
  const bak = await backup(FULL_PRESETS_FILE);
  await atomicWrite(FULL_PRESETS_FILE, content);
  try {
    // 写后回读校验；失败则用备份回滚，决不留下坏文件
    const after = await fsp.readFile(FULL_PRESETS_FILE, 'utf8');
    validateYamlText(after, FULL_PRESETS_FILE);
  } catch (err) {
    if (bak) {
      try {
        await fsp.copyFile(bak, FULL_PRESETS_FILE);
      } catch {
        /* 回滚失败也继续报错 */
      }
    }
    throw httpError(500, `写入后 YAML 校验失败，已回滚: ${err.message}`);
  }
  return { ok: true, id, target: 'mount', file: FULL_PRESETS_FILE, changed, backup: bak };
}

/** 自定义标记文件名：目录下存在即视为 config-ui 创建的自定义子代理（非原厂）。 */
const CUSTOM_FLAG = '.config-ui-created';

/** 新子代理 id 校验：小写字母/数字/短横线，长度 1..64。 */
function validateNewSubagentId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,64}$/.test(id);
}

/**
 * 行级覆写：对 (path, value) 命中行替换 value，保留缩进与注释。
 * 若文件无对应标注行则跳过（不新增行）——创建时接受模板无标注的形态。
 * 返回实际替换的 [(path, line, old, new)]。
 */
function overwriteFieldLines(lines, segments, value) {
  const changed = [];
  const targets = findKeyLines(lines, segments);
  for (const t of targets) {
    const before = lines[t.line];
    const after = replaceValueInLine(before, value);
    lines[t.line] = after;
    const m = /^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(before);
    changed.push({
      path: segments.join('.'),
      line: t.line + 1,
      old: m ? unquote(m[3].split(' #')[0]) : null,
      new: value,
    });
  }
  return changed;
}

/** 空白模式的最小 agent.cordis.yml（含可编辑标注项：agentOptions.provider/model + reasoningEffort）。 */
function blankPresetContent(id, opts) {
  const provider = opts.provider || 'opencode-go-2';
  const model = opts.model || 'deepseek-v4-flash';
  const effort = opts.reasoningEffort || 'low';
  return `# ${id}: 自定义子代理 — 由 config-ui 于 ${nowStamp()} 创建（空白模板）
# 可编辑标注项：下方 tool-subagent-self 的 agentOptions.provider / model / reasoningEffort
# （在界面子代理列表改后保存，走 PUT /api/subagents/${id}）。

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are a custom sub-agent "${id}" powered by the {{model}} model, running on the DeepSeek Harness. Working directory: {{cwd}}.

- id: tool-subagent-self
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: call_${id}
    presetId: ${id}
    agentOptions:
      provider: ${renderScalar(provider)}
      model: ${renderScalar(model)}
      reasoningEffort: ${renderScalar(effort)}
`;
}

/** POST /api/subagents：按模板复制或空白新建一个子代理 preset，写入真实 PRESETS_DIR。 */
async function createSubagent(body) {
  const id = body && body.id;
  if (!validateNewSubagentId(id)) {
    throw httpError(400, `id 非法：需为小写字母/数字/短横线（1-64 字符）：${String(id)}`);
  }
  const source = body.source === 'blank' ? 'blank' : 'template';
  const target = path.join(PRESETS_DIR, id);
  // 目标目录已存在（含 agent.cordis.yml）→ 409 不写
  try {
    const st = await fsp.stat(target);
    if (st.isDirectory()) {
      throw httpError(409, `子代理 ${id} 已存在（${target}），请换一个 id`);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    /* ENOENT → 目标不存在，可创建 */
  }

  const opts = body.agentOptions && typeof body.agentOptions === 'object' ? body.agentOptions : {};
  let changed = [];
  let copiedFrom = null;

  if (source === 'template') {
    const templateId = body.templateId;
    if (typeof templateId !== 'string' || !validateNewSubagentId(templateId)) {
      throw httpError(400, `templateId 非法：${String(templateId)}`);
    }
    const tplDir = path.join(PRESETS_DIR, templateId);
    const tplCordis = path.join(tplDir, PRESET_FILE);
    let tplText;
    try {
      tplText = await fsp.readFile(tplCordis, 'utf8');
    } catch {
      throw httpError(404, `模板子代理 ${templateId} 不存在（无 ${PRESET_FILE}）`);
    }
    copiedFrom = tplDir;

    // 复制 agent.cordis.yml + preset.yml（若有）
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, PRESET_FILE), tplText);
    try {
      const metaText = await fsp.readFile(path.join(tplDir, PRESET_META), 'utf8');
      await fsp.writeFile(path.join(target, PRESET_META), metaText);
    } catch {
      /* 模板无 preset.yml → 不复制 */
    }

    // 按 agentOptions 覆写（保留注释与其余字段；无对应标注行则跳过不增行）
    const lines = tplText.split('\n');
    const rewrites = [
      opts.provider !== undefined ? ['agentOptions', 'provider'] : null,
      opts.model !== undefined ? ['agentOptions', 'model'] : null,
      opts.reasoningEffort !== undefined ? ['reasoningEffort'] : null,
    ].filter(Boolean);
    for (const segs of rewrites) {
      const value = opts[segs[segs.length === 1 ? 0 : 1]];
      changed.push(...overwriteFieldLines(lines, segs, String(value)));
    }
    if (changed.length) {
      await fsp.writeFile(path.join(target, PRESET_FILE), lines.join('\n'));
    }
  } else {
    // blank：最小 agent.cordis.yml（含可编辑标注项）
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, PRESET_FILE), blankPresetContent(id, opts));
  }

  // config-ui 创建标记：原厂预设无此文件；有则 custom:true
  await fsp.writeFile(path.join(target, CUSTOM_FLAG), `created by config-ui ${nowStamp()}\n`);

  return { ok: true, id, source, template: copiedFrom, changed, custom: true };
}

/* ───────────────────────── HTTP 层 ───────────────────────── */

/* 静态文件：config-ui 前端单页（index.html/app.js/style.css）。
 * 白名单精确放行，绝不回显 server.js 等源码；GET 专供，无需 token（API 层另设认证）。 */
const STATIC_ALLOW = new Set(['index.html', 'app.js', 'style.css']);
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function serveStatic(pathname, method, res) {
  if (method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' });
    res.end('Method Not Allowed');
    return;
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!STATIC_ALLOW.has(rel)) {
    throw httpError(404, `未找到: ${pathname}`);
  }
  const file = path.join(__dirname, rel);
  const ext = path.extname(file).toLowerCase();
  try {
    const content = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(content);
  } catch {
    throw httpError(404, `未找到: ${pathname}`);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const httpError = (status, message) => new HttpError(status, message);

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, 'body 过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(httpError(400, 'body 不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 探测 dsh web 端口是否在跑（500ms 超时，失败按未运行处理）。 */
async function probeDsh() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 500);
    const res = await fetch(`http://127.0.0.1:${DSH_PORT}/`, { signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/* token 首启逻辑：明文仅放行一次——本次运行创建后，首次访问 /api/boot 即消费 */
let tokenCreatedThisRun = false;
let bootTokenConsumed = false;
async function ensureToken() {
  try {
    const t = await fsp.readFile(TOKEN_FILE, 'utf8');
    return { token: t.trim(), created: false };
  } catch {
    const token = crypto.randomBytes(32).toString('hex');
    await fsp.mkdir(CONFIG_DIR, { recursive: true });
    await atomicWrite(TOKEN_FILE, token + '\n', 0o600);
    tokenCreatedThisRun = true;
    return { token, created: true };
  }
}

async function handleBoot() {
  const { token, created } = await ensureToken();
  if (created) tokenCreatedThisRun = true;
  if (tokenCreatedThisRun && !bootTokenConsumed) {
    bootTokenConsumed = true;
    return { initialized: false, token };
  }
  return { initialized: true, message: 'token 已初始化，不再回显' };
}

/** POST /api/dsh/restart：重启 dsh 主服务（systemd 用户服务）。
 *  异步 spawn，不 await、不监听 exit（防请求挂起）；立即返回 ok。
 *  命令可由 DSH_RESTART_CMD / DSH_RESTART_ARGS（JSON 数组）覆盖——测试注入 /bin/true 空跑，
 *  生产默认 systemctl --user restart dsh-web.service。 */
async function restartDsh() {
  try {
    spawn(DSH_RESTART_CMD, DSH_RESTART_ARGS, { stdio: 'ignore', detached: false });
  } catch (err) {
    throw httpError(500, `重启失败：${err.message}`);
  }
  return { ok: true, action: 'restart', target: 'dsh-web.service', cmd: DSH_RESTART_CMD };
}

/* ───────────── 启动错误诊断（GET /api/boot-error）─────────────
 * 第三级报警：dsh 未运行时由 config-ui 红色横幅展示具体启动失败原因。
 * 只读诊断，任何失败静默降级为简单提示，不抛 500。
 * systemctl/journalctl 各 5s 超时；错误信息截断到 500 字符避免横幅过长。
 */

const BOOT_ERROR_LINE_RE = /error|fail|ERR_|Crash/i;
const BOOT_ERROR_MAX_LEN = 500;

/** 解析 systemctl show 输出 → { result, failureReason, execMainStatus }（仅取非空值）。 */
function parseBootShow(stdout) {
  const out = { result: null, failureReason: null, execMainStatus: null };
  for (const line of String(stdout || '').split('\n')) {
    const m = /^([A-Za-z0-9_-]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const val = m[2].trim();
    if (!val) continue;
    if (m[1] === 'Result') out.result = val;
    else if (m[1] === 'FailureReason') out.failureReason = val;
    else if (m[1] === 'ExecMainStatus') out.execMainStatus = val;
  }
  return out;
}

/** 从 journalctl 输出提取含错误关键词的行，拼接后截断到 500 字符；无命中返回 null。 */
function extractBootErrors(journalText) {
  const lines = String(journalText || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && BOOT_ERROR_LINE_RE.test(s));
  if (!lines.length) return null;
  let text = lines.join('\n');
  if (text.length > BOOT_ERROR_MAX_LEN) text = text.slice(0, BOOT_ERROR_MAX_LEN);
  return text;
}

/** 读取 dsh 最近一次启动失败原因；正常运行（Result=success）返回 { hasError:false }。 */
async function getBootError() {
  let showOut = '';
  try {
    showOut =
      spawnSync(DSH_SHOW_CMD, DSH_SHOW_ARGS, { encoding: 'utf8', timeout: 5000 }).stdout || '';
  } catch {
    showOut = '';
  }
  const st = parseBootShow(showOut);
  if (st.result === 'success') return { hasError: false };
  let journalErrors = null;
  try {
    const j = spawnSync(DSH_JOURNAL_CMD, DSH_JOURNAL_ARGS, { encoding: 'utf8', timeout: 5000 });
    journalErrors = extractBootErrors(j.stdout);
  } catch {
    journalErrors = null;
  }
  return {
    hasError: true,
    error:
      journalErrors ||
      st.failureReason ||
      st.execMainStatus ||
      `dsh 启动失败（systemctl Result=${st.result || '未知'}）`,
    lastStart: st.failureReason || null,
  };
}

/* ───────────── 回滚审计面（GET /api/rollback、GET /api/rollback/backups）─────────────
 * 只读展示 rollback.sh 的可用资产，绝不执行回滚（执行保持人工 CLI `bash rollback.sh`）。
 * 所有读取失败静默降级为空/错误标记，不抛 500。
 */

/** git 只读执行（HARNESS_DIR 内）；失败返回 null（非 git 仓库 / git 不可用）。 */
function gitRaw(args) {
  try {
    return spawnSync('git', args, { cwd: HARNESS_DIR, encoding: 'utf8', timeout: 5000 });
  } catch {
    return null;
  }
}

/** git 输出按行 trim 过滤空行；失败返回 [  ]。 */
function gitLines(args) {
  const r = gitRaw(args);
  if (!r || r.status !== 0) return [];
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 当前版本："<short-hash> <subject>"；非 git 仓库返回 null。 */
function gitHead() {
  const h = gitRaw(['rev-parse', '--short', 'HEAD']);
  const s = gitRaw(['log', '-1', '--format=%s']);
  if (!h || h.status !== 0 || !s || s.status !== 0) return null;
  const hash = h.stdout.trim();
  const subj = s.stdout.trim();
  return subj ? `${hash} ${subj}` : hash;
}

/** 列目录中满足 pred 的文件名，按 mtime 新→旧排序；目录不可读返回 [  ]。 */
async function listBackupFiles(dir, pred) {
  let names;
  try {
    names = (await fsp.readdir(dir)).filter(pred);
  } catch {
    return [];
  }
  const entries = [];
  for (const n of names) {
    try {
      const st = await fsp.stat(path.join(dir, n));
      entries.push({ n, m: st.mtimeMs });
    } catch {
      entries.push({ n, m: 0 });
    }
  }
  return entries.sort((a, b) => b.m - a.m).map((x) => x.n);
}

/** GET /api/rollback：回滚状态（当前版本 / 备份数 / 最近日志）。 */
async function getRollbackStatus() {
  const cordisDir = path.join(CONFIG_DIR, '.agent-presets', 'full');
  const memDir = path.join(CONFIG_DIR, 'memory-backup', 'latest');
  const [cordis, credentials, memory] = await Promise.all([
    listBackupFiles(cordisDir, (n) => n.includes('.bak-')),
    listBackupFiles(CONFIG_DIR, (n) => n.startsWith('.credentials.yaml.bak-')),
    listBackupFiles(memDir, () => true),
  ]);
  return {
    dshHome: CONFIG_DIR,
    harnessDir: HARNESS_DIR,
    harnessHead: gitHead(),
    backupCounts: {
      cordis: cordis.length,
      credentials: credentials.length,
      memory: memory.length,
    },
    recentCommits: gitLines(['log', '--oneline', '-10']),
    rollbackRefs: gitLines([
      'for-each-ref',
      '--format=%(refname:short)  %(objectname:short)',
      'refs/backup-rollback-*',
    ]),
  };
}

/** GET /api/rollback/backups：可用备份明细（cordis/凭据/记忆/git 提交/git 回滚安全引用）。 */
async function getRollbackBackups() {
  const cordisDir = path.join(CONFIG_DIR, '.agent-presets', 'full');
  const memDir = path.join(CONFIG_DIR, 'memory-backup', 'latest');
  let memFiles = [];
  try {
    memFiles = (await fsp.readdir(memDir)).sort();
  } catch {
    /* 无记忆备份 */
  }
  const [cordis, credentials] = await Promise.all([
    listBackupFiles(cordisDir, (n) => n.includes('.bak-')),
    listBackupFiles(CONFIG_DIR, (n) => n.startsWith('.credentials.yaml.bak-')),
  ]);
  return {
    cordis,
    credentials,
    memory: { backupDir: memDir, files: memFiles },
    commits: gitLines(['log', '--oneline', '-10']),
    rollbackRefs: gitLines([
      'for-each-ref',
      '--format=%(refname:short)  %(objectname:short)',
      'refs/backup-rollback-*',
    ]),
  };
}

/** 执行时间戳 */
function ts() {
  return new Date(Date.now()).toISOString().replace(/[:.]/g, '-');
}

/** 备份文件：复制 + 原子写 */
async function safeBackupCopy(src, dst) {
  const bak = dst + '.bak-rollback-' + ts();
  await fsp.copyFile(dst, bak);
  await fsp.copyFile(src, dst);
  return bak;
}

/** git 命令（HARNESS_DIR 内） */
function gitExec(args) {
  const r = spawnSync('git', args, { cwd: HARNESS_DIR, encoding: 'utf8', timeout: 10000 });
  if (r.status !== 0) throw new Error(r.stderr || 'git failed');
  return r.stdout.trim();
}

/** POST /api/rollback/harness */
async function rollbackHarness(body) {
  const commit = body && body.commit ? String(body.commit).trim() : 'a336607bcb';
  // 验证 commit 存在
  const check = spawnSync('git', ['cat-file', '-t', commit], {
    cwd: HARNESS_DIR,
    encoding: 'utf8',
    timeout: 5000,
  });
  if (check.status !== 0) throw new Error(`commit 不存在: ${commit}`);
  // 备份当前版本到安全引用
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: HARNESS_DIR,
    encoding: 'utf8',
    timeout: 5000,
  }).stdout.trim();
  gitExec(['update-ref', `refs/backup-rollback-${ts()}`, head]);
  // 执行回滚
  gitExec(['reset', '--hard', commit]);
  return { ok: true, action: 'harness', target: commit, headBefore: head.slice(0, 7) };
}

/** POST /api/rollback/cordis */
async function rollbackCordis(body) {
  const backupFile = body && body.backup_file ? String(body.backup_file) : null;
  const cordisDir = path.join(CONFIG_DIR, '.agent-presets', 'full');
  const target = path.join(cordisDir, PRESET_FILE);
  let src = backupFile;
  // 若只传文件名（无前缀），补全路径
  if (src && !src.startsWith('/')) src = path.join(cordisDir, src);
  if (!src) {
    // 找最新备份
    const files = await listBackupFiles(cordisDir, (n) => n.includes('.bak-'));
    if (!files.length) throw new Error('找不到 cordis 配置备份');
    src = path.join(cordisDir, files[0]);
  }
  if (
    !(await fsp
      .access(src)
      .then(() => true)
      .catch(() => false))
  )
    throw new Error(`备份文件不存在: ${src}`);
  const bak = await safeBackupCopy(src, target);
  return { ok: true, action: 'cordis', src: path.basename(src), bak };
}

/** POST /api/rollback/credentials */
async function rollbackCredentials(body) {
  const backupFile = body && body.backup_file ? String(body.backup_file) : null;
  let src = backupFile;
  // 若只传文件名（无前缀），补全路径
  if (src && !src.startsWith('/')) src = path.join(CONFIG_DIR, src);
  if (!src) {
    const files = await listBackupFiles(CONFIG_DIR, (n) => n.startsWith('.credentials.yaml.bak-'));
    if (!files.length) throw new Error('找不到凭据备份');
    src = path.join(CONFIG_DIR, files[0]);
  }
  if (
    !(await fsp
      .access(src)
      .then(() => true)
      .catch(() => false))
  )
    throw new Error(`备份文件不存在: ${src}`);
  const bak = await safeBackupCopy(src, CREDENTIALS_FILE);
  fs.chmodSync(CREDENTIALS_FILE, 0o600);
  return { ok: true, action: 'credentials', src: path.basename(src), bak };
}

/** POST /api/rollback/memory */
async function rollbackMemory() {
  const memDir = path.join(CONFIG_DIR, 'memory-backup', 'latest');
  const targetMem = path.join(CONFIG_DIR, 'memory');
  if (
    !(await fsp
      .access(memDir)
      .then(() => true)
      .catch(() => false))
  )
    throw new Error('记忆备份目录不存在');
  // 备份当前记忆
  const bakDir = path.join(CONFIG_DIR, 'memory-backup', 'rollback-' + ts());
  await fsp.mkdir(bakDir, { recursive: true });
  for (const f of ['MEMORY.md', 'USER.md']) {
    const src = path.join(targetMem, f);
    if (
      await fsp
        .access(src)
        .then(() => true)
        .catch(() => false)
    ) {
      await fsp.copyFile(src, path.join(bakDir, f));
    }
  }
  // 恢复
  await fsp.copyFile(path.join(memDir, 'MEMORY.md'), path.join(targetMem, 'MEMORY.md'));
  await fsp.copyFile(path.join(memDir, 'USER.md'), path.join(targetMem, 'USER.md'));
  const projMem = path.join(targetMem, 'workspaces', '---home-dingx-DSF-work--', 'MEMORY.md');
  const projSrc = path.join(memDir, 'projects-DSF-work.md');
  if (
    await fsp
      .access(projSrc)
      .then(() => true)
      .catch(() => false)
  ) {
    await fsp.mkdir(path.dirname(projMem), { recursive: true });
    await fsp.copyFile(projSrc, projMem);
  }
  return { ok: true, action: 'memory', bak: bakDir };
}

/** POST /api/rollback/all */
async function rollbackAll(body) {
  const commit = body && body.commit ? String(body.commit).trim() : 'a336607bcb';
  const results = [];
  try {
    results.push(await rollbackHarness({ commit }));
  } catch (e) {
    results.push({ ok: false, action: 'harness', error: e.message });
  }
  try {
    results.push(await rollbackCordis(body));
  } catch (e) {
    results.push({ ok: false, action: 'cordis', error: e.message });
  }
  try {
    results.push(await rollbackCredentials(body));
  } catch (e) {
    results.push({ ok: false, action: 'credentials', error: e.message });
  }
  try {
    results.push(await rollbackMemory());
  } catch (e) {
    results.push({ ok: false, action: 'memory', error: e.message });
  }
  const allOk = results.every((r) => r.ok);
  return { ok: allOk, results };
}
const routes = {
  '/api/status': async () => {
    const [running, tH] = await Promise.all([
      probeDsh(),
      Promise.resolve(process.env.DSH_TRUSTED_HOSTS ?? null),
    ]);
    return {
      running,
      port: PORT,
      dshPort: DSH_PORT,
      DSH_TRUSTED_HOSTS: tH,
      configDir: CONFIG_DIR,
      presetsDir: PRESETS_DIR,
    };
  },
  '/api/boot': handleBoot,
  '/api/providers': {
    GET: async () => {
      const data = await getProviders();
      return data;
    },
    PUT: async (body) => {
      const providers = body && body.providers !== undefined ? body.providers : body;
      return putProviders(providers);
    },
  },
  '/api/keys': {
    GET: () => getKeys(),
    POST: (body) => postKey(body || {}),
    DELETE: (body) => deleteKey(body || {}),
  },
  '/api/models': {
    GET: () => getModelList(),
  },
  '/api/dsh/restart': {
    POST: () => restartDsh(),
  },
  '/api/boot-error': () => getBootError(),
  '/api/rollback': {
    GET: () => getRollbackStatus(),
  },
  '/api/rollback/harness': {
    POST: (body) => rollbackHarness(body),
  },
  '/api/rollback/cordis': {
    POST: (body) => rollbackCordis(body),
  },
  '/api/rollback/credentials': {
    POST: (body) => rollbackCredentials(body),
  },
  '/api/rollback/memory': {
    POST: () => rollbackMemory(),
  },
  '/api/rollback/all': {
    POST: (body) => rollbackAll(body),
  },
  '/api/rollback/backups': {
    GET: () => getRollbackBackups(),
  },
};

/** GET 全部子代理（扫描 PRESETS_DIR 下所有含 agent.cordis.yml 的目录）。 */
async function listSubagents() {
  let entries;
  try {
    entries = await fsp.readdir(PRESETS_DIR, { withFileTypes: true });
  } catch {
    return { presetsDir: PRESETS_DIR, subagents: [], error: 'presets 目录不可读' };
  }
  const ids = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  // 过滤掉明显非 preset 的目录（无 agent.cordis.yml 的跳过 readPreset 会报 404 级错误→跳过）
  const subagents = [];
  for (const id of ids) {
    try {
      const p = await readPreset(id);
      if (p.fields.length || p.cordisError === null) {
        // 原厂/自定义标注：目录存在 .config-ui-created 标记文件 → 自定义
        let custom = false;
        try {
          await fsp.stat(path.join(PRESETS_DIR, id, CUSTOM_FLAG));
          custom = true;
        } catch {
          /* 无标记 → 原厂 */
        }
        subagents.push({ ...p, custom });
      }
    } catch {
      /* 跳过不可读目录 */
    }
  }
  return { presetsDir: PRESETS_DIR, count: subagents.length, subagents };
}

async function dispatch(req, res, pathname, method, body) {
  if (pathname === '/api/subagents' && method === 'GET') return listSubagents();
  if (pathname === '/api/subagents' && method === 'POST') return createSubagent(body);

  const subPut = /^\/api\/subagents\/([A-Za-z0-9._-]+)$/.exec(pathname);
  if (subPut && method === 'PUT') {
    return putSubagentFields(decodeURIComponent(subPut[1]), body);
  }

  const r = routes[pathname];
  if (!r) throw httpError(404, `未找到: ${pathname}`);
  if (typeof r === 'function') {
    if (method !== 'GET') throw httpError(405, `不支持 ${method}`);
    return r();
  }
  const handler = r[method];
  if (!handler) throw httpError(405, `不支持 ${method}（可选: ${Object.keys(r).join('/')}）`);
  return handler(body);
}

async function main() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      // 认证：除 /api/boot 外全部要求 Bearer token
      if (pathname.startsWith('/api/') && pathname !== '/api/boot') {
        const { token } = await ensureToken();
        const auth = req.headers.authorization || '';
        const m = /^Bearer\s+(.+)$/i.exec(auth);
        if (!m || m[1].trim() !== token) {
          return sendJson(res, 401, { error: '未授权：需要 Authorization: Bearer <token>' });
        }
      }

      // 静态前端（非 /api 路径）
      if (!pathname.startsWith('/api/')) {
        await serveStatic(pathname, req.method, res);
        return;
      }

      let body = {};
      if (req.method === 'PUT' || req.method === 'POST' || req.method === 'DELETE') {
        body = await readBody(req);
      }
      const result = await dispatch(req, res, pathname, req.method, body);
      sendJson(res, 200, result);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[config-ui] 未处理错误:', err);
      sendJson(res, status, { ok: false, error: err.message || '内部错误' });
    }
  });

  server.on('error', (err) => {
    console.error(`[config-ui] 启动失败: ${err.message}`);
    process.exit(1);
  });

  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  const { created } = await ensureToken();
  server.listen(PORT, HOST, () => {
    console.log(
      `[config-ui] 监听 http://${HOST}:${PORT} (CONFIG_DIR=${CONFIG_DIR} PRESETS_DIR=${PRESETS_DIR})`,
    );
    if (created) {
      console.log(`[config-ui] 首启：token 已生成于 ${TOKEN_FILE}（GET /api/boot 可读一次）`);
    } else {
      console.log(`[config-ui] token 已存在：${TOKEN_FILE}`);
    }
  });
}

/* 直接运行入口（require 时不执行） */
if (require.main === module) {
  main().catch((err) => {
    console.error('[config-ui] 启动失败:', err);
    process.exit(1);
  });
}

module.exports = {
  routes,
  maskSecret,
  parseEnv,
  locateProvidersSegment,
  emitProviderBlock,
  getBootError,
  // 思考级别纠正相关（供 tests/thought-corrections.test.mjs 直接调用，行为与 API 路径一致）
  THOUGHT_CORRECTIONS,
  correctThinkingLevelMap,
  getSupportedThinkingLevelsShim,
  builtinModelEffortLevels,
};
