# dsh-subagent-guard 插件挂入方案（修订版 v2）

> 响应 plan-reviewer 第一次评审的 10 项缺陷（H1-H5, M1-M3, L1-L2）逐条修复

## 一、插件职责

在 dsh host 层约束子代理并发行为，防止系统过载和僵尸子代理占位：

1. **并发限制**：同一时间最多 N 个子代理同时运行（默认 2），超限立即拒绝报中文
2. **空闲超时强杀**：子代理卡住不动（session 事件日志停摆）超过设定时间默认 10min 自动释放
3. **正常运行的子代理不误杀**：有 localAgent 且 session events 正在推进视为正常工作，不杀
4. **结束事件兜底**：`subagent/end` 事件释放槽位，异常结束的不会永久泄漏

## 二、拦截机制（回应 H4：拦截点定义）

守卫通过 wrap `ctx.subagents` 服务的 `start` 方法拦截子代理创建。注册于 host 层所有 subagent 后端之后：

```typescript
// 挂住 subagents.start，在真正创建前检查并发预算
const originalStart = ctx.subagents.start;
ctx.subagents.start = async (name, request) => {
  if (currentActive >= maxConcurrent) {
    throw new Error(`当前活跃子代理已达上限（${maxConcurrent}），子代理并发已满`);
  }
  currentActive++;
  const run = await originalStart.call(ctx.subagents, name, request);
  // 监听 end 事件释放槽位
  const disposable = ctx.on('subagent/end', (info) => {
    if (info.runId === run.id) {
      currentActive--;
      disposable(); // 一次性，用完取消
    }
  });
  return run;
};
```

## 三、配置项

```typescript
interface Config {
  maxConcurrent: number; // 默认 2，最小值 1，超界回退默认并告警
  idleTimeoutMs: number; // 默认 600000 (10min)，最小值 1000
  idlePollMs: number; // 默认 30000 (30s)，空闲检查粒度
  enabled: boolean; // 默认 true，运行时开关
}
```

边界校验（回应 L1）：`maxConcurrent` ∈ [1, N]，`idleTimeoutMs` ≥ 1000，`idlePollMs` ≥ 1000，越界回退默认并告警。

## 四、空闲检测机制（回应 H5：run 对象契约 + 不误杀）

监听 `subagent/end` 事件释放。空闲检测器独立运行，按 `idlePollMs` 节拍检查：

**关键契约**（回应 H5）：守卫不直接读 `localAgent.session.events`。改为：

- **存活检测**：检查 run 是否已结束（通过 `subagent/end` 事件）
- **空闲判定**：如果 run 有 `localAgent`，通过 `ctx.sessions` 检查 session 最后一条事件的时间戳——如果最后一条事件距今超过 `idleTimeoutMs` 且无新事件，判定为空闲
- 无 `localAgent` 的 run（远程模式）：直接用 `idleTimeoutMs` 纯超时，事件停摆才杀

**轮询定义**（回应 L2）：独立的定时器按 `idlePollMs`（默认 30s）轮询活跃 run 列表。

## 五、漏发 end 事件兜底（回应 H2：永远不泄漏槽位）

1. 正常路径：`subagent/end` 事件释放槽位（一次有效，重复幂等）
2. 异常路径：空闲检测器发现 run 死亡但未收到 `subagent/end` → 强制释放槽位
3. 双重保障：`ctx.effect` 注册的 fiber disposer 在插件卸载时清空所有槽位

## 六、fail-open 策略（回应 H3：两条链明确）

| 状态                                                              | 行为                                       | 日志                       |
| ----------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| **正常运行，并发满**                                              | 拒绝第 N+1 个（fail-closed 限流）          | 记录"拒绝：并发已达上限"   |
| **守卫自身异常**（wrap 注入失败/start 失败/subagents 服务不可用） | 放行请求（fail-open 防止系统全卡死）       | 告警"守卫异常，子代理穿透" |
| **空闲检测器故障**                                                | 静默跳过本轮检查，不杀（宁可多等也不误杀） | 告警"空闲检测异常"         |

## 七、可观测性与熔断开关（回应 M3）

- 关键操作日志：拒绝/超时释放/异常放行/配置越界均有日志
- 配置项 `enabled: boolean`（默认 true）：设为 false 后守卫放行所有请求不做任何拦截

## 八、与 guard-main-agent 共存约定（回应 M2）

- **加载顺序**：guard-main-agent 先加载（`tools/pre-execute` 拦截），subagent-guard 后加载
- **超时职责切分**：guard 管工具调用级别的超时（10s），subagent-guard 管子代理生命周期的空闲超时（10min），互不叠套
- **职责分离**：guard-main-agent 已回答"该不该做"，subagent-guard 回答"能不能做"

## 九、重启语义（回应 M1）

- 重启后槽位计数归零 → 不会因历史数据永久阻塞
- 重启间隙已启动的子代理不计数 → 承认此窗口期（同其他类似守卫模式）
- 子代理自然的 `subagent/end` 仍能释放槽位（如果进程重启时清掉了，冷启动 0 计数）

## 十、文件清单

```
packages/extensions/dsh-subagent-guard/
├── package.json
├── tsconfig.json
├── core.cordis.yml
├── src/
│   ├── index.ts          # 主入口：wrap subagents.start + 空闲检测器
│   ├── config.ts         # 配置定义 + 边界校验
│   ├── invariant.ts      # 断言
│   └── types.ts          # 类型
├── lib/                  # 编译产物
│   └── index.js
└── tests/
    ├── smoke.mjs         # 冒烟测试（真实 cordis context）
    └── smoke-progress.mjs # 空闲检测冒烟
```

## 十一、挂载方式

通过 `~/.dsh/profiles/web/cordis.patch.yml` insert 到 host 层：

```yaml
- insert:
    - id: dsh-subagent-guard
      name: '@deepseek-ai/dsh-subagent-guard'
```

无需额外配置：默认值即可运行，生产可调 `maxConcurrent`/`idleTimeoutMs`。

## 十二、验证标准

1. **冒烟测试**（真实 cordis context，伪造 Subagents service）：
   - 配置默认值正确
   - 并发满时第 3 个报中文拒绝
   - `subagent/end` 事件释放槽位
   - 重复/未知 end 事件不泄漏
   - 空闲超时释放僵尸无 localAgent 的 run
   - 有 localAgent 且 session 仍在推进的不误杀
   - 守卫自身异常时 fail-open 放行
   - enabled=false 时所有拦截失效
2. **tsc typecheck** 0 错误
3. **oxlint** 0 告警
4. **多包测试不影响现有功能**：全量 530 测试不变绿
