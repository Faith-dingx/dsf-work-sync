// 分类器（安检员）管理回归测试（server.js GET/PUT /api/classifiers）
// 运行: node tests/classifier.test.mjs（无外部依赖，仅 node 内置模块 + 仓库内 js-yaml）
// 应用说明: 本文件为实施包副本，应用时拷贝为 tests/classifier.test.mjs（去掉 .txt 后缀）。
//
// 覆盖（2026-09-09 需求验收）:
//  A) 契约: getClassifiers/putClassifierFields 已导出、routes 已注册、dispatch PUT 路由存在
//  B) GET 返回结构: 两插件块齐全、值与来源行号正确（skill-router 与 guard 的 model 值本就不同，以文件为准）
//  C) PUT 回读一致: surgical 替换（行数不变、仅目标行差异、行尾注释保留）、备份文件生成且内容=写前、YAML 合法
//  D) 非法值 400: 空 model / 空 endpoint / 非 http(s) endpoint / 非字符串 / 空 body / 未知字段 422 / 未知插件 404；非法调用不落盘
//  E) 双字段 PUT / 缺失键新增 / 行尾注释保留（改 endpoint 行）
//  F) 文件不可读 → 404
//
// 受控写: 通过 FULL_PRESETS_FILE 指向 tests/.tmp-classifier-*/ 下的 fixture 副本，
// 绝不触碰真实 ~/.dsh 文件；测试结束自清理该目录。
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(TESTS_DIR, '..', 'server.js')

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

/* 受控写目录：tests/.tmp-classifier-<rand>/（测试结束自清理；不写系统 /tmp） */
const tmpDir = path.join(TESTS_DIR, `.tmp-classifier-${Date.now().toString(36)}`)
mkdirSync(tmpDir, { recursive: true })

// 模板 A：guard 块含 endpoint(带行尾注释)+model；skill-router 块齐全；末尾含无关块
const TEMPLATE_A = `# fixture A：config-ui 分类器管理受控写测试
version: 1

agents:
  tools:
    - id: skill-router
      name: '@deepseek-ai/dsh-skill-router'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
        classifierModel: 'agnes-2.5-flash'
        fallback: 'close'
    # skill-router 与 guard 之间的注释行（验证不被破坏）
    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions' # 行尾注释保留测试
        classifierModel: 'agnes/agnes-2.5-flash'
        fallback: 'close'
        timeoutMs: 10000

    - id: dsh-dep-align-guard
      name: '@deepseek-ai/dsh-dep-align-guard'
      config:
        mode: 'observe'
`

// 模板 B：guard 块缺 classifierEndpoint（验证 PUT 新增键）
const TEMPLATE_B = `# fixture B：缺失键新增测试
agents:
  tools:
    - id: guard-main-agent
      name: '@deepseek-ai/dsh-guard-main-agent'
      config:
        classifierModel: 'agnes/agnes-2.5-flash'
        fallback: 'close'
`

function loadServer(presetFile) {
  process.env.FULL_PRESETS_FILE = presetFile
  process.env.CONFIG_DIR = tmpDir
  delete require.cache[SERVER]
  return require(SERVER)
}

function freshFile(template) {
  const p = path.join(tmpDir, `preset-${Math.random().toString(36).slice(2, 8)}.yml`)
  writeFileSync(p, template)
  return p
}

const yaml = (() => {
  try {
    return require('/home/dingx/deepseek-harness/node_modules/js-yaml')
  } catch {
    return null
  }
})()
function assertYaml(text, label) {
  if (!yaml) return true
  try {
    yaml.load(text)
    return true
  } catch (e) {
    assert(`${label} YAML 合法`, false, e.message)
    return false
  }
}

/* ═══════════ A) 契约 ═══════════ */
console.log('— 契约 —')
const workFile = freshFile(TEMPLATE_A)
const s = loadServer(workFile)
{
  assert('A1 getClassifiers 已导出', typeof s.getClassifiers === 'function')
  assert('A2 putClassifierFields 已导出', typeof s.putClassifierFields === 'function')
  assert(
    'A3 routes[/api/classifiers].GET 已注册',
    typeof s.routes['/api/classifiers']?.GET === 'function',
  )
  const src = readFileSync(SERVER, 'utf8')
  assert('A4 dispatch 含 classifiers PUT 路由', src.includes('/api/classifiers/') && src.includes('putClassifierFields(decodeURIComponent'))
}

/* ═══════════ B) GET 返回结构 ═══════════ */
console.log('— GET /api/classifiers —')
{
  const r = await s.getClassifiers()
  assert('B1 ok:true 且 file 指向受控文件', r.ok === true && r.file === workFile)
  assert('B2 返回两个插件卡', Array.isArray(r.classifiers) && r.classifiers.length === 2)
  const guard = r.classifiers.find((c) => c.pluginId === 'guard-main-agent')
  const router = r.classifiers.find((c) => c.pluginId === 'skill-router')
  assert('B3 guard-main-agent 块存在', Boolean(guard) && guard.found === true)
  assert('B4 skill-router 块存在', Boolean(router) && router.found === true)
  assert(
    'B5 guard endpoint 值正确',
    guard.classifierEndpoint?.value === 'http://10.10.10.2:9888/v1/chat/completions',
  )
  assert(
    'B6 guard model 值正确（含 provider 前缀）',
    guard.classifierModel?.value === 'agnes/agnes-2.5-flash',
  )
  assert(
    'B7 skill-router model 值正确（无前缀，以文件为准）',
    router.classifierModel?.value === 'agnes-2.5-flash',
  )
  const lines = TEMPLATE_A.split('\n')
  const guardEpLine = lines.findIndex((l) => l.includes('行尾注释保留测试')) + 1
  const routerModelLine = lines.findIndex((l) => l.trim().startsWith('classifierModel')) + 1
  assert('B8 guard endpoint 来源行号正确', guard.classifierEndpoint?.line === guardEpLine, {
    got: guard.classifierEndpoint?.line,
    want: guardEpLine,
  })
  assert('B9 skill-router model 来源行号正确', router.classifierModel?.line === routerModelLine, {
    got: router.classifierModel?.line,
    want: routerModelLine,
  })
  assert('B10 configLine/blockLine 均为 1-based 正数', guard.configLine > 0 && guard.blockLine > 0)
}

/* ═══════════ C) PUT 回读一致 + 备份 ═══════════ */
console.log('— PUT /api/classifiers/guard-main-agent（model） —')
{
  const before = readFileSync(workFile, 'utf8')
  const beforeLines = before.split('\n')
  const r = await s.putClassifierFields('guard-main-agent', {
    classifierModel: 'agnes_cn/agnes-3.0-flash',
  })
  assert('C1 ok:true + verified:true', r.ok === true && r.verified === true)
  assert(
    'C2 changed 恰 1 行且 old/new 正确',
    r.changed.length === 1 &&
      r.changed[0].old === 'agnes/agnes-2.5-flash' &&
      r.changed[0].new === 'agnes_cn/agnes-3.0-flash',
  )
  const after = readFileSync(workFile, 'utf8')
  const afterLines = after.split('\n')
  assert('C3 行数不变（surgical）', beforeLines.length === afterLines.length)
  const diffIdx = []
  for (let i = 0; i < Math.max(beforeLines.length, afterLines.length); i++) {
    if (beforeLines[i] !== afterLines[i]) diffIdx.push(i)
  }
  assert(
    'C4 仅 classifierModel 一行有差异',
    diffIdx.length === 1 && afterLines[diffIdx[0]].includes('classifierModel'),
  )
  assert('C5 行尾注释保留（endpoint 行未动）', after.includes('# 行尾注释保留测试'))
  assert(
    'C6 其余行字节不变（头注释/块间注释/无关块）',
    after.includes('# fixture A：config-ui 分类器管理受控写测试') &&
      after.includes('# skill-router 与 guard 之间的注释行') &&
      after.includes("mode: 'observe'"),
  )
  assertYaml(after, 'C7 写后文件')
  const g = await s.getClassifiers()
  const guard = g.classifiers.find((c) => c.pluginId === 'guard-main-agent')
  assert('C8 GET 回读到新 model', guard.classifierModel?.value === 'agnes_cn/agnes-3.0-flash')
  assert(
    'C9 返回 backup 路径（.bak-config-ui- 命名）',
    typeof r.backup === 'string' && r.backup.startsWith(workFile + '.bak-config-ui-'),
  )
  assert('C10 备份文件真实存在', existsSync(r.backup))
  assert('C11 备份内容 === 写前内容', readFileSync(r.backup, 'utf8') === before)
}

/* ═══════════ D) 非法值 400 / 404 / 422 ═══════════ */
console.log('— PUT 非法值 —')
{
  const snapshot = readFileSync(workFile, 'utf8')
  const cases = [
    ['D1 空 model → 400', 'guard-main-agent', { classifierModel: '   ' }, 400],
    ['D2 空 endpoint → 400', 'guard-main-agent', { classifierEndpoint: '' }, 400],
    ['D3 endpoint 非 http(s) → 400', 'guard-main-agent', { classifierEndpoint: 'ftp://10.10.10.2:9888/x' }, 400],
    ['D4 model 非字符串 → 400', 'guard-main-agent', { classifierModel: 123 }, 400],
    ['D5 endpoint 非字符串(null) → 400', 'guard-main-agent', { classifierEndpoint: null }, 400],
    ['D6 空 body → 400', 'guard-main-agent', {}, 400],
    ['D7 未知插件 → 404', 'compaction', { classifierModel: 'x/y' }, 404],
    [
      'D8 未知字段 → 422',
      'guard-main-agent',
      { classifierModel: 'x/y', classifierEndpoint: 'http://x', bogus: 1 },
      422,
    ],
  ]
  for (const [name, pluginId, body, wantStatus] of cases) {
    try {
      await s.putClassifierFields(pluginId, body)
      assert(name, false, '未抛错')
    } catch (e) {
      assert(name, e.status === wantStatus, { status: e.status, msg: e.message })
    }
  }
  try {
    await s.putClassifierFields('guard-main-agent', null)
    assert('D9 body=null → 400', false, '未抛错')
  } catch (e) {
    assert('D9 body=null → 400', e.status === 400)
  }
  assert('D10 非法调用后文件未被改动', readFileSync(workFile, 'utf8') === snapshot)
}

/* ═══════════ E) 双字段 / 缺失键新增 / 行尾注释保留 ═══════════ */
console.log('— PUT 双字段 / 缺失键新增 / 注释保留 —')
{
  // 双字段：skill-router 同时改 endpoint+model
  const f2 = freshFile(TEMPLATE_A)
  const s2 = loadServer(f2)
  const r = await s2.putClassifierFields('skill-router', {
    classifierEndpoint: 'https://gateway.example.local:9888/v1/chat/completions',
    classifierModel: 'agnes/agnes-3.0-flash',
  })
  assert('E1 双字段 changed 恰 2 行', r.ok === true && r.changed.length === 2)
  const after2 = readFileSync(f2, 'utf8')
  assertYaml(after2, 'E2 双字段写后')
  const g2 = await s2.getClassifiers()
  const router = g2.classifiers.find((c) => c.pluginId === 'skill-router')
  assert(
    'E3 endpoint 新值读回',
    router.classifierEndpoint?.value === 'https://gateway.example.local:9888/v1/chat/completions',
  )
  assert('E4 model 新值读回', router.classifierModel?.value === 'agnes/agnes-3.0-flash')
  assert(
    'E5 guard 块未受影响',
    g2.classifiers.find((c) => c.pluginId === 'guard-main-agent').classifierModel?.value ===
      'agnes/agnes-2.5-flash',
  )

  // 缺失键新增：模板 B 的 guard 无 classifierEndpoint
  const f3 = freshFile(TEMPLATE_B)
  const s3 = loadServer(f3)
  const g0 = await s3.getClassifiers()
  const gBefore = g0.classifiers.find((c) => c.pluginId === 'guard-main-agent')
  assert('E6 初始 GET：endpoint 为 null', gBefore.found === true && gBefore.classifierEndpoint === null)
  const r3 = await s3.putClassifierFields('guard-main-agent', {
    classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions',
  })
  assert('E7 新增键 ok+verified 且 changed 恰 1', r3.ok === true && r3.verified === true && r3.changed.length === 1)
  const after3 = readFileSync(f3, 'utf8')
  assertYaml(after3, 'E8 新增键后')
  const g1 = await s3.getClassifiers()
  const gAfter = g1.classifiers.find((c) => c.pluginId === 'guard-main-agent')
  assert(
    'E9 新增 endpoint 读回一致（含行号）',
    gAfter.classifierEndpoint?.value === 'http://10.10.10.2:9888/v1/chat/completions' &&
      typeof gAfter.classifierEndpoint.line === 'number',
  )
  assert('E10 原有 model 行不受影响', gAfter.classifierModel?.value === 'agnes/agnes-2.5-flash')

  // 行尾注释保留：改 endpoint（原行带 # 注释）后注释仍在、新值合法渲染
  const f4 = freshFile(TEMPLATE_A)
  const sc = loadServer(f4)
  await sc.putClassifierFields('guard-main-agent', {
    classifierEndpoint: 'https://new-gw:9888/v1/chat/completions',
  })
  const ep4 = readFileSync(f4, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('classifierEndpoint:') && l.includes('new-gw'))
  assert('E11 endpoint 行已更新（新值无引号渲染）', Boolean(ep4) && !ep4.includes("'"))
  assert('E12 endpoint 行尾注释保留', Boolean(ep4) && ep4.includes('# 行尾注释保留测试'))
}

/* ═══════════ F) 文件不可读 → 404 ═══════════ */
console.log('— 文件不可读 —')
{
  const su = loadServer(path.join(tmpDir, 'no-such-file.yml'))
  try {
    await su.getClassifiers()
    assert('F1 GET 不可读 → 404', false, '未抛错')
  } catch (e) {
    assert('F1 GET 不可读 → 404', e.status === 404)
  }
  try {
    await su.putClassifierFields('guard-main-agent', { classifierModel: 'x/y' })
    assert('F2 PUT 不可读 → 404', false, '未抛错')
  } catch (e) {
    assert('F2 PUT 不可读 → 404', e.status === 404)
  }
}

/* 清理受控目录 */
try {
  rmSync(tmpDir, { recursive: true, force: true })
} catch {
  /* 尽力清理 */
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
