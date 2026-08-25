// 思考级别纠正回归测试（server.js THOUGHT_CORRECTIONS + correctThinkingLevelMap 路径）
// 运行: node tests/thought-corrections.test.mjs（无外部依赖，仅 node 内置模块）
//
// 覆盖:
//  A) 契约: THOUGHT_CORRECTIONS 定义存在、correctThinkingLevelMap 引用它；
//     opencode-go 目录确实含 6 个目标模型（目录漂移时本测试即预警）。
//  B) 6 个目标模型（glm-5.2/hy3/kimi-k2.6/kimi-k3/minimax-m3/qwen3.7-max）:
//     correctThinkingLevelMap 纠正后 map、getSupportedThinkingLevelsShim 级别列表、
//     builtinModelEffortLevels 取值三者一致（原厂语义: 键缺失=支持、显式 null=剔除、
//     xhigh/max 需映射存在）。
//  C) 回归: DeepSeek 家族（deepseek-v4-flash/pro）仍走原 api+id 规则 → 全部 7 级；
//     未命中表的模型不受影响（glm-5.1 无 map→null；grok-4.5 目录 map 原样透传）。
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js')
const PIAI_ALL = '/home/dingx/deepseek-harness/node_modules/.pnpm/@earendil-works+pi-ai@0.82.1_@modelcontextprotocol+sdk@1.29.0_zod@4.4.3__ws@8.21.0_zod@4.4.3/node_modules/@earendil-works/pi-ai/dist/providers/all.js'

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const s = require(SERVER)
const { THOUGHT_CORRECTIONS, correctThinkingLevelMap, getSupportedThinkingLevelsShim, builtinModelEffortLevels } = s
const piAi = require(PIAI_ALL)

/** 取 pi-ai 目录指定 provider 下指定 id 的原始模型对象（无则 null）。 */
function catalogModel(provider, id) {
  for (const m of piAi.getBuiltinModels(provider) || []) {
    const o = m && typeof m === 'object' ? m : { id: m }
    if (o.id === id) return o
  }
  return null
}

/* ═══════════ A) 契约断言 ═══════════ */
console.log('— 契约 —')
{
  const src = readFileSync(SERVER, 'utf8')
  assert('A1 THOUGHT_CORRECTIONS 定义存在', Object.keys(THOUGHT_CORRECTIONS).length === 6, THOUGHT_CORRECTIONS)
  assert('A2 correctThinkingLevelMap 引用纠正表', src.includes('THOUGHT_CORRECTIONS[id]'))
  assert('A3 opencode-go 目录含 6 个目标模型', ['glm-5.2', 'hy3', 'kimi-k2.6', 'kimi-k3', 'minimax-m3', 'qwen3.7-max'].every((id) => catalogModel('opencode-go', id) !== null))
}

/* ═══════════ B) 6 个目标模型三条路径一致 ═══════════ */
console.log('— 目标模型纠正 —')
// 期望值按 getSupportedThinkingLevels 原厂语义由纠正后 map 推得
const CASES = [
  {
    id: 'glm-5.2',
    map: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'hy3',
    map: { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  },
  {
    id: 'kimi-k2.6',
    map: { minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'kimi-k3',
    map: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'minimax-m3',
    map: { xhigh: 'xhigh', max: 'max' },
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'qwen3.7-max',
    map: { minimal: 'minimal', low: 'low', medium: 'medium', xhigh: 'xhigh' },
    levels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  },
]
for (const c of CASES) {
  const m = catalogModel('opencode-go', c.id)
  assert(`B ${c.id} 目录模型存在且 reasoning`, m && m.reasoning === true)
  const corrected = correctThinkingLevelMap(m, m.thinkingLevelMap)
  assert(`B ${c.id} 纠正后 map`, eq(corrected, c.map), corrected)
  const levels = getSupportedThinkingLevelsShim(m)
  assert(`B ${c.id} shim 级别列表`, eq(levels, c.levels), levels)
  const effort = builtinModelEffortLevels(m)
  assert(`B ${c.id} builtinModelEffortLevels`, eq(effort, c.levels), effort)
}

/* ═══════════ C) 回归：DeepSeek 规则不变 + 未命中表模型不受影响 ═══════════ */
console.log('— 回归 —')
{
  const all7 = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
  for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    const m = catalogModel('opencode-go', id)
    assert(`C ${id} DeepSeek 家族仍全 7 级`, eq(getSupportedThinkingLevelsShim(m), all7), getSupportedThinkingLevelsShim(m))
    assert(`C ${id} builtinModelEffortLevels 同`, eq(builtinModelEffortLevels(m), all7))
  }
  const glm51 = catalogModel('opencode-go', 'glm-5.1') // 未命中表、无 map
  assert('C glm-5.1（表外无 map）→ null', builtinModelEffortLevels(glm51) === null)
  const grok = catalogModel('opencode-go', 'grok-4.5') // 未命中表、有 map、api 非 openai-completions
  const grokOut = getSupportedThinkingLevelsShim(grok)
  assert('C grok-4.5（表外）目录 map 原样透传', eq(grokOut, ['low', 'medium', 'high']), grokOut)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)