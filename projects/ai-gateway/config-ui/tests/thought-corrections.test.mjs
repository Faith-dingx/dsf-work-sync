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
const PIAI_ALL = '/home/dingx/dsh/node_modules/.pnpm/@earendil-works+pi-ai@1.3.0_patch_hash=4e1c90fd00aea42989664504668633033c1962e53c078609_43f55fd5cdebc7965cd56b71408d4583/node_modules/@earendil-works/pi-ai/dist/providers/all.js'

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

/**
 * 当前 pi-ai 目录（opencode-go）实况快照。
 * 上游目录随 pi-ai 版本增删模型（如 kimi-k2.6→kimi-k2.7-code、qwen3.7-max→qwen3.8-max），
 * 故断言以「纠正表 ∩ 当前目录」为准，不再硬编码某版本的模型快照。
 */
const CATALOG = piAi.getBuiltinModels('opencode-go') || []
const catalogIds = CATALOG.map(x => x.id)
/** 纠正表已声明、但当前目录已下线（条目保留待其回归，不判失败）。 */
const offlineModels = Object.keys(THOUGHT_CORRECTIONS).filter(id => !catalogIds.includes(id))

/* ═══════════ A) 契约断言 ═══════════ */
console.log('— 契约 —')
{
  const src = readFileSync(SERVER, 'utf8')
  assert('A1 THOUGHT_CORRECTIONS 定义存在', Object.keys(THOUGHT_CORRECTIONS).length === 6, THOUGHT_CORRECTIONS)
  assert('A2 correctThinkingLevelMap 引用纠正表', src.includes('THOUGHT_CORRECTIONS[id]'))
  assert('A3 纠正表在目录内的模型均可查', Object.keys(THOUGHT_CORRECTIONS).filter((id) => catalogIds.includes(id)).every((id) => catalogModel('opencode-go', id) !== null))
  if (offlineModels.length) console.log('  ⚠ 上游已下线（纠正表条目保留待其回归，不判失败）:', offlineModels.join(', '))
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
  if (!m) {
    console.log('  · 跳过（上游目录已下线该模型）:', c.id)
    continue
  }
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
  // DeepSeek 家族（表外、openai 协议）：原厂语义 = 全 7 档，唯 map.off===null 时不含 off
  const dsFamily = CATALOG.filter((x) => /^deepseek-/.test(x.id) && x.reasoning === true && x.api === 'openai-completions' && !THOUGHT_CORRECTIONS[x.id])
  assert('C 目录存在表外 DeepSeek 家族模型', dsFamily.length > 0, dsFamily.map((x) => x.id))
  for (const m of dsFamily.slice(0, 2)) {
    const expected = all7.filter((k) => !('off' === k && m.thinkingLevelMap && m.thinkingLevelMap.off === null))
    assert(`C ${m.id} DeepSeek 家族档位符合原厂语义`, eq(getSupportedThinkingLevelsShim(m), expected), getSupportedThinkingLevelsShim(m))
    assert(`C ${m.id} builtinModelEffortLevels 同`, eq(builtinModelEffortLevels(m), expected))
  }
  // 表外且无 thinkingLevelMap → effort levels 为 null
  const noMap = CATALOG.find((x) => !THOUGHT_CORRECTIONS[x.id] && !x.thinkingLevelMap && x.reasoning === true)
  if (noMap) {
    assert(`C ${noMap.id}（表外无 map）→ null`, builtinModelEffortLevels(noMap) === null)
  } else {
    console.log('  · 跳过（目录中暂无「表外且无 map」的 reasoning 模型）')
  }
  // 表外、openai-responses 协议、有 map → map 原样透传（按非 null 档位）
  const other = CATALOG.find((x) => !THOUGHT_CORRECTIONS[x.id] && x.thinkingLevelMap && x.api === 'openai-responses')
  if (other) {
    const expected = Object.keys(other.thinkingLevelMap).filter((k) => other.thinkingLevelMap[k] != null)
    const out = getSupportedThinkingLevelsShim(other)
    assert(`C ${other.id}（表外/openai-responses）目录 map 原样透传`, eq(out, expected), out)
  } else {
    console.log('  · 跳过（目录中暂无「表外且协议为 openai-responses」的模型）')
  }
  // 表外、anthropic 协议 → 原厂语义全 7 档（不按 map 裁剪）
  const anth = CATALOG.find((x) => !THOUGHT_CORRECTIONS[x.id] && x.api === 'anthropic-messages')
  if (anth) {
    assert(`C ${anth.id}（表外/anthropic）全 7 档`, eq(getSupportedThinkingLevelsShim(anth), all7), getSupportedThinkingLevelsShim(anth))
  } else {
    console.log('  · 跳过（目录中暂无「表外且协议为 anthropic-messages」的模型）')
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)