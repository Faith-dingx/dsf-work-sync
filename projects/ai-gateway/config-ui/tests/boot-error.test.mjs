// boot-error 回归测试（server.js GET /api/boot-error 路径）
// 运行: node tests/boot-error.test.mjs（无外部依赖，仅 node 内置模块）
//
// 覆盖:
//  A) 字段名契约（2026-08-24 修复）: systemctl show 请求 ExecMainStatus（合法属性）
//     —— 而非不存在的 ExecStartPostStatus；解析器只认 ExecMainStatus。
//  B) getBootError 行为: Result=success→{hasError:false} 且不调 journalctl；
//     Result=failed→错误行+lastStart + 调用 journalctl；show 不可用→降级；
//     FailureReason 为空时回退到 ExecMainStatus；超长错误行→≤500 字符；
//     routes 已注册 /api/boot-error。
import { createRequire } from 'node:module'
import { readFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const setupDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js')
const MARKER = path.join(setupDir, '.journal-called.marker')

let pass = 0
let fail = 0
function assert(name, cond) {
  if (cond) {
    pass++
    console.log('  ✓', name)
  } else {
    fail++
    console.log('  ✗ FAIL:', name)
  }
}
const sh = (s) => path.join(setupDir, s)

/* ═══════════ A) 字段名契约（ExecMainStatus 修复锁定） ═══════════ */

// A1: 默认 show 属性请求必须包含 ExecMainStatus、不得包含 ExecStartPostStatus
{
  const src = readFileSync(SERVER, 'utf8')
  assert('A1 show 请求含 ExecMainStatus', /ExecMainStatus/.test(src))
  assert('A2 show 请求不含 ExecStartPostStatus', !/ExecStartPostStatus/.test(src))
}

function loadServer(env) {
  process.env.DSH_SHOW_CMD = env.showCmd
  process.env.DSH_SHOW_ARGS = JSON.stringify(env.showArgs || [])
  process.env.DSH_JOURNAL_CMD = env.journalCmd
  process.env.DSH_JOURNAL_ARGS = JSON.stringify(env.journalArgs || [])
  process.env.JOURNAL_MARKER = MARKER
  delete require.cache[SERVER]
  return require(SERVER)
}

/* ═══════════ B) getBootError 行为 ═══════════ */

console.log('— getBootError —')

// B1: Result=success → hasError:false 且不调 journalctl
{
  rmSync(MARKER, { force: true })
  const s = loadServer({ showCmd: 'sh', showArgs: [sh('fake-show-ok.sh')], journalCmd: 'sh', journalArgs: [sh('fake-journal-errors.sh')] })
  const r = await s.getBootError()
  assert('B1 Result=success → hasError:false', r && r.hasError === false)
  assert('B2 Result=success 不调用 journalctl', !existsSync(MARKER))
}

// B2: Result=failed + journal 错误行 → hasError + 错误行 + lastStart=FailureReason + 调用了 journalctl
{
  rmSync(MARKER, { force: true })
  const s = loadServer({ showCmd: 'sh', showArgs: [sh('fake-show-fail.sh')], journalCmd: 'sh', journalArgs: [sh('fake-journal-errors.sh')] })
  const r = await s.getBootError()
  assert('B3 Result=failed → hasError:true', r && r.hasError === true)
  assert('B4 error 含 ERR_MODULE_NOT_FOUND', !!(r && r.error && r.error.includes('ERR_MODULE_NOT_FOUND')))
  assert('B5 error 含 Crash 行', !!(r && r.error && r.error.includes('Crash')))
  assert('B6 lastStart=FailureReason', r && r.lastStart === 'exec of pnpm postinstall failed: ERR_MODULE_NOT_FOUND')
  assert('B7 调用了 journalctl', existsSync(MARKER))
}

// B3: FailureReason 为空、journal 无错误 → 回退到 ExecMainStatus（修复后字段生效）
{
  rmSync(MARKER, { force: true })
  const s = loadServer({ showCmd: 'sh', showArgs: [sh('fake-show-main-status.sh')], journalCmd: 'sh', journalArgs: [sh('fake-journal-fail.sh')] })
  const r = await s.getBootError()
  assert('B8 FailureReason 空 → error 回退 ExecMainStatus=1', r && r.error === '1')
  assert('B9 lastStart 为 null（无 FailureReason）', r && r.lastStart === null)
}

// B4: show 命令不可用（退出 1、无 stdout）→ 降级为简单提示
{
  const s = loadServer({ showCmd: 'sh', showArgs: [sh('fake-show-unavail.sh')], journalCmd: 'sh', journalArgs: [sh('fake-journal-fail.sh')] })
  const r = await s.getBootError()
  assert('B10 show 不可用 → hasError:true', r && r.hasError === true)
  assert('B11 降级为非空错误提示', typeof r.error === 'string' && r.error.length > 0)
  assert('B12 降级文案含"启动失败"', typeof r.error === 'string' && r.error.includes('启动失败'))
}

// B5: journal 超长错误行 → 截断到 ≤500 字符
{
  const s = loadServer({ showCmd: 'sh', showArgs: [sh('fake-show-fail.sh')], journalCmd: 'sh', journalArgs: [sh('fake-journal-long.sh')] })
  const r = await s.getBootError()
  assert('B13 超长错误截断 ≤500', typeof r.error === 'string' && r.error.length === 500)
}

// B6: routes 已注册 /api/boot-error
{
  const s = loadServer({ showCmd: 'sh', showArgs: [sh('fake-show-ok.sh')], journalCmd: 'sh', journalArgs: [sh('fake-journal-fail.sh')] })
  assert('B14 routes[/api/boot-error] 存在', typeof s.routes['/api/boot-error'] === 'function')
  assert('B15 module.exports 暴露 getBootError', typeof s.getBootError === 'function')
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)