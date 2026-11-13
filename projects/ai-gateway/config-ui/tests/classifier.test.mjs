// 分类器模型（classifierModel）管理回归测试（server.js GET/POST /api/guard/classifier）
// 运行: node tests/classifier.test.mjs（无外部依赖，仅 node 内置模块 + 仓库内 js-yaml）
//
// 契约（2026-11-14 校准后）：
//  GET  /api/guard/classifier → { ok, presets[], models, activePreset, note }
//       presets[i] = { id: 'full'|'full-hub', file, hasBlock,
//                      models: { 'guard-main-agent': {value,line}|null, 'skill-router': {value,line}|null },
//                      endpoint: {value,line}|null }
//  POST /api/guard/classifier body { model, preset? } → { ok, model, preset, models, changed[], backup, note }
//
// 受控写：PRESETS_DIR / CONFIG_DIR 全部指向受控副本目录（工作区 .temp/ 下），
//          绝不触碰真实 ~/.dsh；测试前后对真实 ~/.dsh/.agent-presets 做 mtime+哈希比对。
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import path from 'node:path'

const require = createRequire(import.meta.url)
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url))
// 默认测工作区副本；CONFIG_UI_SERVER_PATH 可指向生产 server.js（/home/dingx/config-ui-3083/server.js）
const SERVER = process.env.CONFIG_UI_SERVER_PATH || path.resolve(TESTS_DIR, '..', 'server.js')

let pass = 0
let fail = 0
function assert(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗ FAIL:', name, extra !== undefined ? `→ ${JSON.stringify(extra)}` : '')
  }
}

/* ── 受控副本目录（工作区 .temp/ 下，绝不写系统 /tmp） ── */
const WORKSPACE_TEMP =
  process.env.CONFIG_UI_TEST_TEMP || path.resolve(TESTS_DIR, '..', '..', '..', '..', '.temp')
const RUN_DIR = path.join(WORKSPACE_TEMP, `classifier-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
const PRESETS_ROOT = path.join(RUN_DIR, 'presets')
mkdirSync(PRESETS_ROOT, { recursive: true })

/* 真实 ~/.dsh/.agent-presets 零污染取证 */
const REAL_PRESETS = '/home/dingx/.dsh/.agent-presets'
function snapshotReal(dir) {
  const out = []
  const walk = (d, rel) => {
    let entries = []
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = path.join(d, e.name)
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) { walk(abs, r); continue }
      try {
        const st = statSync(abs)
        const h = createHash('sha256').update(readFileSync(abs)).digest('hex')
        out.push(`${r}|${st.mtimeMs}|${st.size}|${h}`)
      } catch { /* 读不到就跳过 */ }
    }
  }
  walk(dir, '')
  return out.sort().join('\n')
}
const REAL_BEFORE = snapshotReal(REAL_PRESETS)

/* ── fixtures（结构对齐真实 .agent-presets/<preset>/agent.cordis.yml：delegation 组内两个插件块） ── */
const FIXTURE_FULL = `# fixture：config-ui 分类器受控写测试（full）
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: skill-router
      name: '@deepseek-ai/dsh-skill-router'
      config:
        # 分类器端点（只读展示，本接口不开放修改）
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        classifierModel: 'modelscope/Qwen/Qwen3.8-Flash-Next'
        fallback: 'close'
        timeoutMs: 30000

    # skill-router 与 guard 之间的注释行（验证不被破坏）
    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions' # 行尾注释保留测试
        classifierModel: 'modelscope/Qwen/Qwen3.8-Flash-Next'
        fallback: 'open'
        timeoutMs: 30000

- id: dsh-dep-align-guard
  name: '@deepseek-ai/dsh-dep-align-guard'
  config:
    mode: 'observe'
`

const FIXTURE_HUB = `# fixture：config-ui 分类器受控写测试（full-hub）
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: skill-router
      name: '@deepseek-ai/dsh-skill-router'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        classifierModel: 'agnes_cn/agnes-3.0-flash'
        timeoutMs: 30000
        fallback: 'close'

    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        classifierModel: 'agnes_cn/agnes-3.0-flash'
        fallback: 'open'
        diagnosticFallback: 'open'
        codeClassFallback: 'open'
        timeoutMs: 30000
        presetId: 'main-agent'
`

// 无 guard 块
const FIXTURE_NO_GUARD = `# fixture：没有 guard-main-agent 块
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: skill-router
      name: '@deepseek-ai/dsh-skill-router'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        classifierModel: 'agnes_cn/agnes-3.0-flash'
`

// 两个 guard 块
const FIXTURE_DUP_GUARD = `# fixture：两个 guard-main-agent 块
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierModel: 'agnes_cn/agnes-3.0-flash'

    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierModel: 'agnes_cn/agnes-2.5-flash'
`

// guard 块存在但没有 classifierModel 键（可新增）
const FIXTURE_NO_MODEL_KEY = `# fixture：guard 块存在但缺 classifierModel 键
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: skill-router
      name: '@deepseek-ai/dsh-skill-router'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        fallback: 'close'

    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        fallback: 'open'
`

// 双引号原值 + 行尾注释
const FIXTURE_DQUOTE = `# fixture：双引号原值
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: skill-router
      name: '@deepseek-ai/dsh-skill-router'
      config:
        classifierModel: "agnes_cn/agnes-3.0-flash"   # 双引号原值 + 行尾注释

    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierModel: "agnes_cn/agnes-3.0-flash"   # 双引号原值 + 行尾注释
`

// config 层末尾是折叠块标量 → 新增键会落进标量内部 → 写后回读校验失败 → 回滚
const FIXTURE_BLOCK_SCALAR = `# fixture：config 层末尾是折叠块标量（新增键会落进标量内部）
- id: delegation
  name: 'cordis:group'
  group: true
  config:
    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        note: >
          这是一段折叠文本
`

/* ── 受控写入工具 ── */
function presetFile(presetId) {
  return path.join(PRESETS_ROOT, presetId, 'agent.cordis.yml')
}
function writePreset(presetId, content) {
  const dir = path.join(PRESETS_ROOT, presetId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'agent.cordis.yml'), content)
  return presetFile(presetId)
}
function resetFixtures(full = FIXTURE_FULL, hub = FIXTURE_HUB) {
  writePreset('full', full)
  writePreset('full-hub', hub)
}

process.env.PRESETS_DIR = PRESETS_ROOT
process.env.CONFIG_DIR = RUN_DIR
process.env.FULL_PRESETS_FILE = presetFile('full-hub')
process.env.JS_YAML_PATH = process.env.JS_YAML_PATH || '/home/dingx/dsh/node_modules/js-yaml'
// 9888 目录校验：默认指向不可达端口（离线、瞬时失败、不阻断写入）；L 组用本地 mock
process.env.MODEL_ROUTER_URL = 'http://127.0.0.1:9'

function loadServer() {
  delete require.cache[SERVER]
  return require(SERVER)
}

/* ── YAML 校验（loader 同款方言：JSON_SCHEMA + !!js） ── */
const yaml = (() => {
  try { return require(process.env.JS_YAML_PATH) } catch { return null }
})()
let entrySchema = null
if (yaml) {
  const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    resolve: (d) => typeof d === 'string',
    construct: (d) => ({ __jsExpr: d }),
    predicate: (d) => Boolean(d) && typeof d === 'object' && '__jsExpr' in d,
    represent: (d) => d['__jsExpr'],
  })
  entrySchema = yaml.JSON_SCHEMA.extend(JsExpr)
}
function assertYaml(text, label) {
  if (!yaml) return true
  try {
    yaml.load(text, entrySchema ? { schema: entrySchema } : undefined)
    return true
  } catch (e) {
    assert(`${label} YAML 合法`, false, e.message)
    return false
  }
}
function diffLines(a, b) {
  const la = a.split('\n')
  const lb = b.split('\n')
  const idx = []
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) idx.push(i)
  return idx
}

resetFixtures()
let s = loadServer()

/* ═══════════ A) 契约 ═══════════ */
console.log('— A) 契约 —')
{
  assert('A1 getClassifier 已导出', typeof s.getClassifier === 'function')
  assert('A2 putClassifier 已导出', typeof s.putClassifier === 'function')
  const src = readFileSync(SERVER, 'utf8')
  assert(
    'A3 dispatch 含 /api/guard/classifier 的 GET/POST 路由',
    src.includes("/api/guard/classifier' && method === 'GET'") &&
      src.includes("/api/guard/classifier' && method === 'POST'"),
  )
  assert(
    'A4 不再有分类器 410 Gone 硬编码',
    !src.includes('分类器模型（classifierModel）在 DSH 0.2.0 已不存在') &&
      !src.includes('分类器模型在 DSH 0.2.0 已不存在，写入不再生效'),
  )
  assert(
    'A5 存在按文件路径的进程内互斥（与 PUT /api/subagents/:id 共用）',
    src.includes('function withFileLock') && src.includes('withFileLock(FULL_PRESETS_FILE'),
  )
}

/* ═══════════ B) GET 返回结构 ═══════════ */
console.log('— B) GET /api/guard/classifier —')
{
  const g = await s.getClassifier()
  assert('B1 ok:true', g.ok === true)
  assert('B2 presets 恰 2 项', Array.isArray(g.presets) && g.presets.length === 2, {
    len: g.presets && g.presets.length,
  })
  const ids = g.presets.map((p) => p.id)
  assert('B3 preset id = full / full-hub', ids.includes('full') && ids.includes('full-hub'), ids)
  const full = g.presets.find((p) => p.id === 'full')
  const hub = g.presets.find((p) => p.id === 'full-hub')
  assert('B4 每项含 file/hasBlock/models/endpoint',
    ['file', 'hasBlock', 'models', 'endpoint'].every((k) => k in full))
  assert('B5 file 是受控副本的绝对路径', full.file === presetFile('full') && path.isAbsolute(full.file), full.file)
  assert('B6 full 有 guard 块', full.hasBlock === true)
  assert(
    'B7 models[guard-main-agent] 含 value 与 1-based line',
    full.models['guard-main-agent'] && typeof full.models['guard-main-agent'].value === 'string' &&
      full.models['guard-main-agent'].line > 0,
    full.models['guard-main-agent'],
  )
  assert(
    'B8 models[skill-router] 含 value 与 1-based line',
    full.models['skill-router'] && typeof full.models['skill-router'].value === 'string' &&
      full.models['skill-router'].line > 0,
    full.models['skill-router'],
  )
  assert(
    'B9 endpoint 含 value 与 line',
    full.endpoint && typeof full.endpoint.value === 'string' && full.endpoint.line > 0,
    full.endpoint,
  )
  assert(
    'B10 兼容字段 models.full = full 预设 guard 的 classifierModel',
    g.models && g.models.full === full.models['guard-main-agent'].value,
    { models: g.models },
  )
  assert('B11 兼容字段 models[full-hub] 同样给出', g.models && g.models['full-hub'] === hub.models['guard-main-agent'].value)
  assert('B12 activePreset 字段存在（取不到时为 null，不得报错）', 'activePreset' in g)
  assert('B13 note 为中文且含关键要点',
    typeof g.note === 'string' && g.note.includes('写入落点') === false &&
      g.note.includes('classifierModel') && g.note.includes('重启 dsh-web') &&
      g.note.includes('守卫分类器') && g.note.includes('skill-router'),
    g.note)
  assert('B14 note 说明一次写入同步两个实例',
    g.note.includes('skill-router') && g.note.includes('guard-main-agent'))
}

/* ═══════════ C) POST 正常写入（替换） ═══════════ */
console.log('— C) POST 正常写入 —')
{
  const target = presetFile('full')
  const before = readFileSync(target, 'utf8')
  const beforeLines = before.split('\n')
  const r = await s.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
  assert('C1 ok:true + model + preset=full（缺省）',
    r.ok === true && r.model === 'agnes_cn/agnes-3.0-flash' && r.preset === 'full',
    { ok: r.ok, model: r.model, preset: r.preset })
  assert('C2 changed 恰 2 项（guard-main-agent + skill-router）',
    r.changed.length === 2 && r.changed.map((c) => c.plugin).sort().join(',') === 'guard-main-agent,skill-router',
    r.changed)
  assert('C3 changed 每项含 plugin/file/line/oldValue/newValue',
    r.changed.every((c) => c.plugin && c.file === target && c.line > 0 && 'oldValue' in c && c.newValue === 'agnes_cn/agnes-3.0-flash'),
    r.changed)
  assert('C4 changed 的旧值正确（两实例同值约定）',
    r.changed.every((c) => c.oldValue === 'modelscope/Qwen/Qwen3.8-Flash-Next'),
    r.changed.map((c) => c.oldValue))
  const after = readFileSync(target, 'utf8')
  assert('C5 行数不变（surgical）', beforeLines.length === after.split('\n').length,
    { before: beforeLines.length, after: after.split('\n').length })
  const d = diffLines(before, after)
  assert('C6 仅两行有差异（两个 classifierModel 行）',
    d.length === 2 && d.every((i) => after.split('\n')[i].includes('classifierModel')), d)
  assert('C7 行尾注释保留', after.includes('# 行尾注释保留测试'))
  assert('C8 其余字节不变（头注释/块间注释/无关块/引号风格）',
    after.includes('# fixture：config-ui 分类器受控写测试（full）') &&
      after.includes('# skill-router 与 guard 之间的注释行') &&
      after.includes("mode: 'observe'") &&
      after.includes("classifierModel: 'agnes_cn/agnes-3.0-flash'"))
  assertYaml(after, 'C9 写后')
  const g2 = await s.getClassifier()
  const full2 = g2.presets.find((p) => p.id === 'full')
  assert('C10 GET 回读到新值（两实例）',
    full2.models['guard-main-agent'].value === 'agnes_cn/agnes-3.0-flash' &&
      full2.models['skill-router'].value === 'agnes_cn/agnes-3.0-flash',
    full2.models)
  assert('C11 backup 路径为 .bak-config-ui- 命名族',
    typeof r.backup === 'string' && r.backup.startsWith(target + '.bak-config-ui-'),
    r.backup)
  assert('C12 备份文件真实存在', existsSync(r.backup))
  assert('C13 备份内容 === 写前内容', readFileSync(r.backup, 'utf8') === before)
  assert('C14 响应 models.full 已回填新值', r.models && r.models.full === 'agnes_cn/agnes-3.0-flash')
  assert('C15 note 含生效条件（重启 dsh-web）', r.note.includes('重启 dsh-web') && r.note.includes('新会话生效'))
  assert('C16 note 说明同步两个实例', r.note.includes('skill-router') && r.note.includes('guard-main-agent'))
}

/* ═══════════ D) 非法 model → 400 且不落盘 ═══════════ */
console.log('— D) 非法 model → 400 —')
{
  const target = presetFile('full')
  const snapshot = readFileSync(target, 'utf8')
  const long = 'a'.repeat(101)
  const cases = [
    ['D1 空字符串 → 400', ''],
    ['D2 纯空白 → 400', '   '],
    ['D3 非字符串（数字）→ 400', 123],
    ['D4 非字符串（null）→ 400', null],
    ['D5 长度 101 超限 → 400', long],
    ['D6 含内部空格 → 400', 'agnes cn/flash'],
    ['D7 含单引号 → 400', "agnes'cn/flash"],
    ['D8 含双引号 → 400', 'agnes"cn/flash'],
    ['D9 含 # → 400', 'agnes#cn'],
    ['D10 含控制字符 → 400', 'agnescn'],
    ['D11 含非法字符 $ → 400', 'agnes$cn'],
  ]
  for (const [name, model] of cases) {
    try {
      await s.putClassifier({ model })
      assert(name, false, '未抛错')
    } catch (e) {
      assert(name, e.status === 400, { status: e.status, msg: e.message })
    }
  }
  try {
    await s.putClassifier(null)
    assert('D12 body=null → 400', false, '未抛错')
  } catch (e) {
    assert('D12 body=null → 400', e.status === 400, { status: e.status })
  }
  assert('D13 非法调用后文件未被改动', readFileSync(target, 'utf8') === snapshot)
  assert('D14 非法调用未产生新备份', readdirSync(path.dirname(target)).filter((n) => n.includes('.bak-config-ui-')).length <= 1)
}

/* ═══════════ E) 未知 preset → 404 且不落盘 ═══════════ */
console.log('— E) 未知 preset —')
{
  const fullBefore = readFileSync(presetFile('full'), 'utf8')
  const hubBefore = readFileSync(presetFile('full-hub'), 'utf8')
  try {
    await s.putClassifier({ model: 'agnes_cn/agnes-3.0-flash', preset: 'nope' })
    assert('E1 未知 preset → 404', false, '未抛错')
  } catch (e) {
    assert('E1 未知 preset → 404', e.status === 404, { status: e.status, msg: e.message })
  }
  assert('E2 full 预设未被改动', readFileSync(presetFile('full'), 'utf8') === fullBefore)
  assert('E3 full-hub 预设未被连带修改', readFileSync(presetFile('full-hub'), 'utf8') === hubBefore)
}

/* ═══════════ F) guard 块缺失 → 404 且不落盘 ═══════════ */
console.log('— F) guard 块缺失 —')
{
  resetFixtures(FIXTURE_NO_GUARD, FIXTURE_HUB)
  const s2 = loadServer()
  const target = presetFile('full')
  const before = readFileSync(target, 'utf8')
  try {
    await s2.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
    assert('F1 guard 块缺失 → 404', false, '未抛错')
  } catch (e) {
    assert('F1 guard 块缺失 → 404', e.status === 404, { status: e.status, msg: e.message })
    assert('F2 错误信息为中文且说明未做修改', /未做任何修改/.test(e.message), e.message)
  }
  assert('F3 文件未被改动', readFileSync(target, 'utf8') === before)
  const g = await s2.getClassifier()
  const full = g.presets.find((p) => p.id === 'full')
  assert('F4 GET 不抛错，hasBlock=false', full.hasBlock === false)
  assert('F5 GET 的 models[guard-main-agent] 为 null', full.models['guard-main-agent'] === null)
  assert('F6 GET 的 models.full 为 null（缺块不抛错）', g.models.full === null)
}

/* ═══════════ G) 多个 guard 块 → 409 且不落盘 ═══════════ */
console.log('— G) 多个 guard 块 —')
{
  resetFixtures(FIXTURE_DUP_GUARD, FIXTURE_HUB)
  const s3 = loadServer()
  const target = presetFile('full')
  const before = readFileSync(target, 'utf8')
  try {
    await s3.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
    assert('G1 多个 guard 块 → 409', false, '未抛错')
  } catch (e) {
    assert('G1 多个 guard 块 → 409', e.status === 409, { status: e.status, msg: e.message })
    assert('G2 错误信息列出各行号', /\d+、\d+/.test(e.message) && /\d+ 行/.test(e.message), e.message)
    assert('G3 错误信息说明未做修改', /未做任何修改/.test(e.message), e.message)
  }
  assert('G4 文件未被改动', readFileSync(target, 'utf8') === before)
}

/* ═══════════ H) classifierModel 键缺失 → 可新增 ═══════════ */
console.log('— H) classifierModel 键缺失 → 新增 —')
{
  resetFixtures(FIXTURE_NO_MODEL_KEY, FIXTURE_HUB)
  const s4 = loadServer()
  const target = presetFile('full')
  const before = readFileSync(target, 'utf8')
  const beforeLines = before.split('\n')
  const r = await s4.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
  assert('H1 新增键写入成功', r.ok === true, r)
  assert('H2 changed 恰 2 项（两实例各新增一行）', r.changed.length === 2, r.changed)
  assert('H3 两处 oldValue 均为 null', r.changed.every((c) => c.oldValue === null), r.changed.map((c) => c.oldValue))
  const after = readFileSync(target, 'utf8')
  const afterLines = after.split('\n')
  assert('H4 行数 +2（两实例各新增一行）', afterLines.length === beforeLines.length + 2,
    { before: beforeLines.length, after: afterLines.length })
  assert('H5 新增键缩进沿用相邻子键（8 空格）',
    afterLines.some((l) => /^ {8}classifierModel: 'agnes_cn\/agnes-3\.0-flash'$/.test(l)),
    afterLines.filter((l) => l.includes('classifierModel')))
  assert('H6 引号风格沿用相邻键（单引号，同 classifierEndpoint）',
    afterLines.filter((l) => /^\s*classifierModel\s*:/.test(l)).every((l) => l.includes("'")))
  assert('H7 原有行未被破坏', after.includes("fallback: 'open'") && after.includes("fallback: 'close'"))
  assertYaml(after, 'H8 新增后')
  const g = await s4.getClassifier()
  const full = g.presets.find((p) => p.id === 'full')
  assert('H9 GET 回读到新增键',
    full.models['guard-main-agent'].value === 'agnes_cn/agnes-3.0-flash' &&
      full.models['skill-router'].value === 'agnes_cn/agnes-3.0-flash',
    full.models)
  assert('H10 备份内容 === 写前内容', readFileSync(r.backup, 'utf8') === before)
}

/* ═══════════ I) 引号风格与行尾注释保留 ═══════════ */
console.log('— I) 引号风格 / 行尾注释 —')
{
  resetFixtures(FIXTURE_DQUOTE, FIXTURE_HUB)
  const s5 = loadServer()
  const target = presetFile('full')
  const r = await s5.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
  const after = readFileSync(target, 'utf8')
  const modelLines = after.split('\n').filter((l) => l.includes('classifierModel'))
  assert('I1 双引号原值 → 写后仍为双引号', modelLines.every((l) => l.includes('"')), modelLines)
  assert('I2 行尾注释保留', modelLines.every((l) => l.includes('# 双引号原值 + 行尾注释')), modelLines)
  assert('I3 新值正确', modelLines.every((l) => l.includes('agnes_cn/agnes-3.0-flash')), modelLines)
  assert('I4 行数不变', after.split('\n').length === FIXTURE_DQUOTE.split('\n').length)
  assert('I5 备份存在且内容为写前', existsSync(r.backup) && readFileSync(r.backup, 'utf8') === FIXTURE_DQUOTE)
}

/* ═══════════ J) 写后校验失败 → 回滚 ═══════════ */
console.log('— J) 写后校验失败 → 回滚 —')
{
  resetFixtures(FIXTURE_BLOCK_SCALAR, FIXTURE_HUB)
  const s6 = loadServer()
  const target = presetFile('full')
  const before = readFileSync(target, 'utf8')
  try {
    await s6.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
    assert('J1 写后校验失败 → 500', false, '未抛错')
  } catch (e) {
    assert('J1 写后校验失败 → 500', e.status === 500, { status: e.status, msg: e.message })
    assert('J2 错误信息说明已回滚', /回滚/.test(e.message), e.message)
  }
  assert('J3 文件已回滚（内容 === 写前）', readFileSync(target, 'utf8') === before)
}

/* ═══════════ K) 备份失败 → 不写入（fail-closed） ═══════════ */
console.log('— K) 备份失败 → 不写入 —')
{
  resetFixtures(FIXTURE_FULL, FIXTURE_HUB)
  const s7 = loadServer()
  const target = presetFile('full')
  const before = readFileSync(target, 'utf8')
  const dir = path.dirname(target)
  let blocked = false
  try {
    chmodSync(dir, 0o555)
    try {
      writeFileSync(path.join(dir, '.write-probe'), 'x')
    } catch {
      blocked = true
    }
    if (blocked) {
      try {
        await s7.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
        assert('K1 备份失败 → 500', false, '未抛错')
      } catch (e) {
        assert('K1 备份失败 → 500', e.status === 500, { status: e.status, msg: e.message })
        assert('K2 错误信息说明未生成备份、未写入', /未生成备份/.test(e.message) && /未写入/.test(e.message), e.message)
      }
      assert('K3 备份失败后文件未被改动', readFileSync(target, 'utf8') === before)
    } else {
      console.log('  – 跳过 K 组：当前用户可绕过目录权限（root），无法模拟备份失败')
    }
  } finally {
    chmodSync(dir, 0o755)
  }
}

/* ═══════════ L) 9888 在册校验（本地 mock，仅提示不阻断） ═══════════ */
console.log('— L) 9888 在册校验 —')
{
  const mock = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { id: 'agnes_cn/agnes-3.0-flash', chat_capable: true },
          { id: 'agnes/agnes-3.0-flash', chat_capable: true },
          { id: 'modelscope/Qwen/Qwen3.8-Flash-Next', chat_capable: true },
        ],
      }))
      return
    }
    res.writeHead(404)
    res.end('{}')
  })
  await new Promise((r) => mock.listen(0, '127.0.0.1', r))
  const port = mock.address().port
  try {
    // L1 在册
    resetFixtures(FIXTURE_FULL, FIXTURE_HUB)
    process.env.MODEL_ROUTER_URL = `http://127.0.0.1:${port}`
    const s8 = loadServer()
    const r1 = await s8.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
    assert('L1 在册模型写入成功', r1.ok === true)
    assert('L2 note 提示已在 9888 目录中', /已在 9888 当前目录中/.test(r1.note), r1.note)
    assert('L3 在册时 note 不说不在册', !/不在 9888 当前目录中/.test(r1.note))

    // L4 不在册
    resetFixtures(FIXTURE_FULL, FIXTURE_HUB)
    const s9 = loadServer()
    const r2 = await s9.putClassifier({ model: 'some-vendor/not-in-catalog' })
    assert('L4 不在册模型仍允许写入', r2.ok === true, r2)
    assert('L5 note 提示不在 9888 目录中', /不在 9888 当前目录中/.test(r2.note), r2.note)
    assert('L6 note 列出在册候选 id', /可选候选/.test(r2.note) && /agnes_cn\/agnes-3\.0-flash/.test(r2.note), r2.note)

    // L7 网关不可达
    resetFixtures(FIXTURE_FULL, FIXTURE_HUB)
    process.env.MODEL_ROUTER_URL = 'http://127.0.0.1:9'
    const s10 = loadServer()
    const r3 = await s10.putClassifier({ model: 'agnes_cn/agnes-3.0-flash' })
    assert('L7 网关不可达仍允许写入', r3.ok === true, r3)
    assert('L8 note 提示未能校验 9888 目录', /未能校验 9888 目录/.test(r3.note), r3.note)
  } finally {
    await new Promise((r) => mock.close(r))
    process.env.MODEL_ROUTER_URL = 'http://127.0.0.1:9'
  }
}

/* ═══════════ M) 真实 ~/.dsh/.agent-presets 零污染 ═══════════ */
console.log('— M) 真实 ~/.dsh 零污染 —')
{
  const REAL_AFTER = snapshotReal(REAL_PRESETS)
  assert('M1 真实 .agent-presets 全树 mtime+大小+哈希与测试前完全一致', REAL_AFTER === REAL_BEFORE,
    REAL_AFTER === REAL_BEFORE ? undefined : '内容有变化')
}

/* ── 清理受控目录（只删本次自建的受控副本） ── */
try {
  if (RUN_DIR.startsWith(WORKSPACE_TEMP + path.sep) && path.basename(RUN_DIR).startsWith('classifier-test-')) {
    rmSync(RUN_DIR, { recursive: true, force: true })
  }
} catch {
  /* 尽力清理 */
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
