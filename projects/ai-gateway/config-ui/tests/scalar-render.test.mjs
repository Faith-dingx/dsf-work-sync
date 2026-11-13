// 厂商模型列表保存 YAML 标量渲染回归测试（server.js renderScalar / emitProviderBlock）
// 运行: node tests/scalar-render.test.mjs（无外部依赖，仅 node 内置模块 + 仓库内 js-yaml）
//
// 背景（2026-08-26 事故）: 修改厂商模型列表后 settings.yaml 出现
//   supportsDeveloperRole: 'false'（被单引号包成字符串），
// 导致 llm-pi-ai 配置校验报
//   $.providers.huoshan.compat.supportsDeveloperRole expected boolean but got false
// 根因: renderScalar 先把值 String() 再套 needsQuote，把真正的布尔 false 当成
//   "看起来像 YAML 关键字的字符串"加引号。
// 本测试锁死: 真布尔/真数字必须不带引号输出；字符串仍需按 needsQuote 转义。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js')
const JS_YAML = [
  process.env.JS_YAML_PATH,
  '/home/dingx/dsh-022-pretest/node_modules/js-yaml',
  '/srv/dsh/node/node_modules/js-yaml',
].filter(Boolean).find((c) => {
  try {
    require.resolve(c)
    return true
  } catch {
    return false
  }
})

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

const s = require(SERVER)
const { renderScalar, needsQuote, emitProviderBlock, locateProvidersSegment } = s

/* ═══════════ A) 契约: renderScalar/needsQuote 已导出 ═══════════ */
console.log('— 契约 —')
{
  const src = readFileSync(SERVER, 'utf8')
  assert('A1 server.js 含 renderScalar 定义', /function renderScalar\(/.test(src))
  assert('A2 renderScalar 已导出', typeof renderScalar === 'function', typeof renderScalar)
  assert('A3 needsQuote 已导出', typeof needsQuote === 'function', typeof needsQuote)
}

/* ═══════════ B) 真布尔必须无引号（本次事故核心） ═══════════ */
console.log('— 真布尔/数字渲染 —')
{
  assert('B1 false → false（不带引号）', renderScalar(false) === 'false', renderScalar(false))
  assert('B2 true → true（不带引号）', renderScalar(true) === 'true', renderScalar(true))
  assert('B3 数字 1000000 → 1000000', renderScalar(1000000) === '1000000', renderScalar(1000000))
  assert('B4 数字 131072 → 131072', renderScalar(131072) === '131072', renderScalar(131072))
}

/* ═══════════ C) 真字符串仍需按 YAML 关键字规则转义 ═══════════ */
console.log('— 字符串渲染（含 YAML 关键字字符串） —')
{
  assert('C1 字符串 "false" 仍需加引号', renderScalar('false') === "'false'", renderScalar('false'))
  assert('C2 字符串 "true" 仍需加引号', renderScalar('true') === "'true'", renderScalar('true'))
  assert('C3 普通字符串不带引号', renderScalar('deepseek-v4-flash') === 'deepseek-v4-flash', renderScalar('deepseek-v4-flash'))
  assert('C4 含冒号字符串需转义', renderScalar('a: b') === "'a: b'", renderScalar('a: b'))
}

/* ═══════════ D) emitProviderBlock 全量往返（真实写文件路径） ═══════════ */
console.log('— emitProviderBlock 往返 —')
{
  const providers = {
    huoshan: {
      displayName: '火山',
      apiKeyEnv: 'HUOSHAN_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      models: [
        { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
      ],
      compat: {
        supportsDeveloperRole: false,
      },
    },
    router: {
      displayName: '软路由网关',
      apiKeyEnv: 'OPENCODE_GO_API_KEY',
      baseURL: 'http://10.10.10.2:9888',
      models: [{ id: 'agnes/agnes-2.5-flash' }],
      compat: { supportsDeveloperRole: false, supportsStore: true },
    },
  }
  const text = emitProviderBlock(providers, 2)
  assert('D1 布尔 false 无引号输出', text.includes('supportsDeveloperRole: false'), text.match(/supportsDeveloperRole.*/g))
  assert('D2 布尔 true 无引号输出', text.includes('supportsStore: true'), text.match(/supportsStore.*/g))
  assert('D3 不再出现引号布尔', !text.includes("supportsDeveloperRole: 'false'"), text.match(/supportsDeveloperRole.*/g))

  if (JS_YAML) {
    const yaml = require(JS_YAML)
    const doc = yaml.load(`llm-pi-ai:\n  providers:\n${text.split('\n').map((l) => '  ' + l).join('\n')}`)
    const got = doc['llm-pi-ai'].providers
    assert(
      'D4 YAML 回读 supportsDeveloperRole 为真布尔 false',
      got.huoshan.compat.supportsDeveloperRole === false,
      got.huoshan.compat.supportsDeveloperRole,
    )
    assert(
      'D5 YAML 回读 supportsStore 为真布尔 true',
      got.router.compat.supportsStore === true,
      got.router.compat.supportsStore,
    )
    assert('D6 模型 id 仍为字符串', got.huoshan.models[0].id === 'deepseek-v4-flash', got.huoshan.models[0])
    assert('D7 中文 displayName 原样回读', got.huoshan.displayName === '火山', got.huoshan.displayName)
  } else {
    console.log('  ! js-yaml 不可用，跳过 D4–D7 回读断言')
  }
}

/* ═══════════ E) 类型保真：字符串 'false' 必须保持引号，真布尔才无引号 ═══════════ */
console.log('— 类型保真渲染 —')
{
  const withString = {
    huoshan: { displayName: '火山', compat: { supportsDeveloperRole: 'false' } },
  }
  const withBool = {
    huoshan: { displayName: '火山', compat: { supportsDeveloperRole: false } },
  }
  const strText = emitProviderBlock(withString, 2)
  const boolText = emitProviderBlock(withBool, 2)
  assert('E1 字符串 "false" 输入保持引号（不丢类型）', strText.includes("supportsDeveloperRole: 'false'"), strText.match(/supportsDeveloperRole.*/g))
  assert('E2 真布尔 false 输入无引号', boolText.includes('supportsDeveloperRole: false'), boolText.match(/supportsDeveloperRole.*/g))
  assert('E3 两种输入渲染结果不同（类型不混）', strText !== boolText)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
