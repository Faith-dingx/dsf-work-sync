# dsh 0.2.2 升级评估（P2-5 定稿）

> 基于：`~/dsh-022-pretest` @ 分支 `dsh-v0.2.2-lan-access`，预演实测全部通过（P2-1 到 P2-4 全绿）
> 评估：Hermes
> 结论：**可切换**，回滚锚点保留在 `~/deepseek-harness` @ `lan-access-0.1.5-merged`

## 0. 切换后 dsh-web.service 指向

```
WorkingDirectory: /home/dingx/dsh-022-pretest
分支: dsh-v0.2.2-lan-access（HEAD 含 P0+P2 全部改动）
```

## 1. 预演仓本地改动（59 文件，相对 0.2.2 纯上游 tag f3803c9697）

### 1.1 P0-1 guard 授权改造（代码，已落库）

| 文件                                                     | 改动                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/extensions/guard-main-agent/src/types.ts`      | 新增 `codeClassFallback` 配置字段                                                                                                                                                             |
| `packages/extensions/guard-main-agent/src/index.ts`      | 分类器不可用时 bash/shell/edit 族按 `codeClassFallback` 放行（默认 `close` 保旧行为）；0.2.2 注入源改模块增强声明 `kind:'guard-main-agent'`+`form:'notice'`（去掉 catch-all `kind:'plugin'`） |
| `packages/extensions/guard-main-agent/src/policy.ts`     | `codeClassFallback` 判定逻辑；rm 规则放宽（工作区内放行，越出工作区/家目录根//`cd` 后删除/`git rm`/`docker rm` 仍硬禁并转 code-agent；realpath 二次校验防软链逃逸）                           |
| `packages/extensions/guard-main-agent/src/filePolicy.ts` | 判定顺序改为：黑名单命中即拒 → 白名单命中（含扩展名门）→ 临时例外 → `defaultPolicy: allow` 放行 → 兜底拒绝                                                                                    |
| `packages/extensions/guard-main-agent/src/delegate.ts`   | 适配 0.2.2 `ToolsService.execute` 的 batch 形态返回值（`results[0].result`）与单结果形态双兼容                                                                                                |
| `packages/extensions/guard-main-agent/src/messages.ts`   | 0.2.2 消息类型适配                                                                                                                                                                            |

### 1.2 P0-2 预设置（l2 沙箱 + 生产 preset 副本，不进 git）

- `~/.dsh-pretest-l2/.agent-presets/full/agent.cordis.yml`（及 `full-hub/`）
  - `fallback: 'open'`、`diagnosticFallback: 'open'`、`codeClassFallback: 'open'`
  - `filePolicyPath: 'docs/主agent可改写文件清单.yaml'`（v3.0：defaultPolicy: allow + 20 条黑名单）
  - P2-2 修复：删 `tool-subagent-control/list-agents` 独立行（0.2.2 上游并入本体）、`workflow-worker-thread` 换 `dsh-workflow-ptc`（provider: spawn）
  - 备份：`agent.cordis.yml.bak-p22fix-20261030`
- 生产 `~/.dsh/.agent-presets/full/` 与 `full-hub/` 需同步改（P2-5 切换前必做，否则 3080 用 0.2.2 时 preset 仍引已删包）

### 1.3 P2-3 guard 集成测试移植（28 场景）

- `packages/extensions/guard-main-agent/tests/guard-main-agent.spec.ts`
  - 解除整体 skip（`describe.skip` → `describe`）
  - import 改从 `@deepseek-ai/dsh-tool-testkit`
  - `Agent` mock 补 0.2.2 必填 `model`/`inbox` 字段
  - `Session.create` 第三参改显式 `SessionHeader`（version 4）
  - 新增 `createStubExecutor`（0.2.2 executor 外置，`ctx.tools.setExecutor`）
  - Context 装配补 `SessionProjectionRegistry`
  - 断言语义 28 场景全部不变
- 测试全绿：`npx vitest run packages/extensions/guard-main-agent/tests/` → 160 passed / 0 failed

### 1.4 P2-4 terminal service 挂载

- `packages/bundle/web-app/cordis.patch.yml`
  - 末尾新增 `- insert:` 块，平铺挂载 `@deepseek-ai/dsh-terminal`（提供 `terminals` service）+ `@deepseek-ai/dsh-terminal-bash`（win32 禁用）+ `@deepseek-ai/dsh-terminal-bash`（POSIX 禁用，pwsh）
  - 挂法依据 0.1.5 生产仓 `sdk-minimal/cordis.patch.yml` 的平铺 host 行
  - diff 快照：`.temp/dsh-022-pretest/cordis.patch.yml.diff`
- 验证：3092 重启后 11 个 preset 的 broken 字段全部清空，code-agent session/create `ok: true`

### 1.5 agent-presets 恢复（0.2.2 上游删除的包）

- `packages/preset/agent-presets/`（src/discovery/preset/metadata/specifier + tests）
  - 从 0.1.5 仓 git archive 选择性恢复可复用文件
  - 重写 `index.ts` 为 discovery → `agentPresets.register()` 注册插件
  - `USER_PRESET_DIR` 扫描机制重建
  - 接入 `packages/bundle/web-app/cordis.patch.yml` 的 `agent-preset-discovery` 行
  - 测试 56 passed（discovery 35 + metadata 16 + mount 5）

### 1.6 其他适配（merge 期间修复）

- `packages/client/connection/src/index.ts` + `tests/browser-auth.host.spec.ts` — 0.2.2 认证协议适配
- `packages/extensions/dsh-dep-align-guard/src/index.ts` — 0.2.2 机制适配
- `packages/extensions/dsh-subagent-guard/src/index.ts` — 0.2.2 机制适配
- `packages/extensions/skill-router/src/injector.ts` — 0.2.2 注入管线 form/section 重构适配
- `packages/subagent/subagent/src/continuation.ts` + `continuation-activation.ts` — 0.2.2 continuation 机制重写适配
- `packages/subagent/tool-subagent/tests/tool-subagent.spec.ts` — 测试适配
- `packages/typert/generator/tests/tools-catalog.spec.ts` — 测试适配
- `packages/preset/agent-presets/src/index.ts` — 858 行（完整恢复）
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.host.json`、`apps/cli/package.json` — 依赖与构建配置同步
- `scripts/validate-inject.mjs` + `spec.ts` — 新增注入验证脚本
- `packages/extensions/tool-cordis/src/inspect.ts` — 0.2.2 tool-cordis 适配

## 2. 验收清单（预演实测）

| P2 项                                                                          | 结果              |
| ------------------------------------------------------------------------------ | ----------------- |
| P2-1 局域网可用性（401→认证→PRIVILEGED_METHODS 403→trustedHosts）              | ✅                |
| P2-2 长期记忆（broken 行清空 + dsh-injection-manager/dsh-memory-manager 激活） | ✅                |
| P2-3 guard 集成测试（28 场景 + 160 全量）                                      | ✅ 160/160 passed |
| P2-4 七探针（guard 行为 + terminal + 子代理 preset）                           | ✅ 全部通过       |
| build gate                                                                     | ✅ 10/10 全绿     |

## 3. 切换前必做

1. **同步生产 preset**：`~/.dsh/.agent-presets/full/agent.cordis.yml` 与 `full-hub/agent.cordis.yml` 需做与 l2 沙箱相同的 P2-2 修复（删 list-agents 行、换 workflow-ptc），否则 3080 切 0.2.2 后 preset broken。
2. **备份**：`cp ~/.dsh/.agent-presets/full/agent.cordis.yml ~/.dsh/.agent-presets/full/agent.cordis.yml.bak-022-$(date +%Y%m%d%H%M)`（full-hub 同）。
3. **systemd service 切换**：
   ```
   # 用户手动执行（Agent 不得重启 dsh-web）
   systemctl --user stop dsh-web
   # 编辑 ~/.config/systemd/user/dsh-web.service：WorkingDirectory=/home/dingx/dsh-022-pretest
   systemctl --user start dsh-web
   ```
4. **冒烟**：3080 401→登录→任务→记忆→LAN 客户端（10.10.10.x）；全绿后 M1 归档。
5. **回滚（30 秒）**：`WorkingDirectory` 指回 `/home/dingx/deepseek-harness`，用户重启；0.1.5 分支未动。

## 4. 遗留问题（不阻塞切换）

| 项                                                         | 说明                                                                     | 处置                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------ |
| `dsh-tool-testkit` 未列入 guard-main-agent devDependencies | 经根仓 tsconfig paths 解析可运行，build gate 不受影响；测试文件不入 lib  | 后续补声明，需走 P1 评审 |
| delegate.ts batch+单结果双形态兼容                         | 为守住 delegate.spec.ts 既有断言；未来 executor 契约收敛后可删单结果分支 | 记录，不紧急             |
| `tool-bash-persistent` 在 0.1.5 生产仓 terminal 挂法对照   | 0.2.2 web bundle 未挂 terminal 是上游结构性差异，已补挂                  | 已处理（P2-4）           |
| 0.2.2 `continuation.ts` 被上游删除                         | 28 个 guard 集成场景无一依赖该机制，无需适配                             | 已确认                   |

## 5. 可回滚点

| 项                       | 回滚方式                                                                |
| ------------------------ | ----------------------------------------------------------------------- |
| 预演仓全部改动           | `git -C ~/dsh-022-pretest checkout dsh-v0.2.2-lan-access`（分支保留）   |
| 生产 preset（P2-2 修复） | 改回 `agent.cordis.yml.bak-022-<timestamp>`                             |
| guard 代码               | `git -C ~/deepseek-harness revert <P0 commit>`                          |
| 文件清单 YAML            | `~/DSF-work/docs/主agent可改写文件清单.yaml` 改回 v2.1 即恢复白名单模式 |
