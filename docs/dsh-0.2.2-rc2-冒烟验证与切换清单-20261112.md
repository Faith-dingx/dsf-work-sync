# dsh 0.2.2-rc.2 升级 — 冒烟验证报告与切换清单

> 执行：Hermes | 时间：2026-11-12 22:30 → 23:55
> 预演仓：`~/dsh-022-pretest` @ `dsh-v0.2.2-rc2-lan-access`（HEAD `4dd65be0bc` + 未提交的 cordis.patch.yml 改动）
> 隔离 HOME：`~/.dsh-rc2-smoke` | 冒烟端口 3092 | 生产 3080 全程未动

---

## 1. 验证结论（实测，非推断）

| 项                           | 结果                                                         | 证据                   |
| ---------------------------- | ------------------------------------------------------------ | ---------------------- |
| Build gate                   | ✅ 10/10（42.97s）                                           | `pnpm build`           |
| 定制包测试                   | ✅ 40 files / 659 tests                                      | vitest                 |
| TypeScript host+client       | ✅ 0 error                                                   | `tsc -b`               |
| 插件激活                     | ✅ 215 个插件，5 个关键守卫全部 `fiberPhase: active`         | `pluginInventory/list` |
| 预设置发现                   | ✅ 11 个全部注册                                             | `agentPresets/list`    |
| 预设置完整性                 | ✅ 11 个全部 `broken: None`                                  | `agentPresets/read`    |
| 未认证访问                   | ✅ 401                                                       | curl                   |
| 带 token 登录                | ✅ 303 + 签发 cookie                                         | curl                   |
| session/create (full preset) | ✅ 返回真实 sessionId                                        | RPC                    |
| session/prompt               | ✅ accepted                                                  | RPC                    |
| **真实模型轮次**             | ✅ 9 次 assistant/message、10 次 tool/call、9 次 tool/result | session.v4.jsonl.zstd  |
| 记忆管理器                   | ✅ 写 audit 日志                                             | `.dsh-memory/audit/`   |
| 工作目录注入                 | ✅ `Current working directory: "/home/dingx"`                | system-reminder        |

## 2. 升级过程中修掉的 4 个真实问题

### 2.1 cordis 4.0.6 → 4.1.0：缺依赖的插件挂 PENDING 而非报错

`inject` 不满足时 cordis 4.1 把插件挂成 PENDING **静默不激活**（4.0.6 会照样激活）。
影响：3 个守卫插件的测试（memory-guard / dep-align-guard / skill-router）。
处置：测试装配补 `SessionProjectionRegistry`。
**生产不受影响**——生产把守卫挂在 host 层（无 scope tag），host 会加载 `sessionProjections`。

### 2.2 ★rc.2 拆分 PromptAssembly → 记忆写工具裁剪静默失效

rc.2 把 `PromptAssembly` 拆成 `PromptPresentation`（sections/contexts/variables，**不含 tools**），
工具声明在 waterfall **之后**才拼装（packages/core/system-prompt/src/index.ts）。
→ 我们的 `cutMemoryWriteTools(assembly.tools)` 拿到 `undefined`，裁剪静默失败，
还因抛异常把整个 fail-open 拖崩（sections/contexts 变换也一并失效）。

处置：改用工具注册层的 scope 可见性 —— `tools.restrict({ deny })` 挂在 agent 自己的 scope
（官方范本见 packages/experimental/browser-use-runtime/src/mcp.ts）。
验证：`AGENT tools: ['bash','memory_read']`（memory_log 已裁）/ `GLOBAL tools: 保留全部`。

### 2.3 rc.2 的 Session 事件改走 snapshotEvents()

`events` 属性没了 → memory-manager 测试 mock 失效。已修。

### 2.4 ★rc.2 没有 `{{cwd}}` 变量 —— 7 个 preset 的工作目录会显示成字面量

rc.2 的 system-prompt 只注册 `provider` / `model` 两个变量（packages/core/agent-loop/src/index.ts:336）。
工作目录改由 `working-directory:current` 上下文注入（`interpolate: false`，不经过 `{{}}`）。
→ 我们 7 个 preset 里的 `{{cwd}}` 会原样出现在 prompt 里。
处置：7 个 preset 全部改掉（`Your working directory is {{cwd}}.` → 去掉该子句），
备份 `agent.cordis.yml.bak-cwdvar-20261112233901`。

## 3. ★★ 切换生产前必须做的 5 件事

### 3.1 生产 settings.yaml 会被 rc.2 自动迁移（一次性、不可逆）

rc.2 启动时把 `$DSH_HOME/settings.yaml` **重命名为 `settings.yaml.imported`**，
再把各 section 导入 profile 的新配置条目（packages/settings/settings/src/index.ts:241）。

- 迁移**成功**：冒烟验证 `agent-default-model` → `agnes-cn`/`agnes-3.0-flash`，
  `llm-pi-ai` 全部 provider、`permission.defaultPreset` 都进来了。
- 但**第一次跑必须带着 `settings.yaml`**，否则永远迁不了（文件已被改名就不会再迁）。
- 回滚注意：迁移后原文件是 `.imported`，要恢复得改回 `settings.yaml`。

### 3.2 ★ Agnes 的 max_tokens 上限 65536，rc.2 默认 128000 → 全部 400

rc.2 的 `llm-pi-ai.defaultMaxTokens` 默认 **128000**（packages/llm/llm-pi-ai/src/config.ts:81）。
0.1.5 时代 Agnes 接受这个值；现在实测 3 个 Agnes 端点全部拒绝 131072：

| 端点                             | 65536  | 131072                            |
| -------------------------------- | ------ | --------------------------------- |
| api.agnes-ai.cn (agnes-cn)       | ✅ 200 | ❌ 400 不能超过 65536             |
| apihub.agnes-ai.com (agnes)      | —      | ❌ 400 exceeds the limit of 65536 |
| apihub.agnes-ai.com (agnes_plan) | —      | ❌ 400 exceeds the limit of 65536 |

处置：给这 3 个 provider 加 `defaultMaxTokens: 65536`（支持 per-provider 覆盖）。
冒烟里用 `settings/update` 写入已验证生效，模型随即跑通。

### 3.3 生产 profile package.json 的 file: 路径（4 处）

`~/.dsh/profiles/web/package.json` 里 4 个 `file:/home/dingx/deepseek-harness/...`
→ 改成 `file:/home/dingx/dsh-022-pretest/...`

### 3.4 生产 profile node_modules 软链（3 个守卫 + dsh-memory-manager）

`~/.dsh/profiles/web/node_modules/@deepseek-ai/` 下：

- `dsh-memory-guard`、`dsh-subagent-guard`、`dsh-dep-align-guard` → 改指预演仓
- `dsh-memory-manager` 生产原本没有软链，需新建

### 3.5 web-app bundle 的 terminal 补挂（已改，未 commit）

我们在 `packages/bundle/web-app/cordis.patch.yml` 补挂了 `pty`/`terminal-bash`/`terminal-pwsh`，
与生产 profile patch 的 `terminal`/`terminal-bash` 重复 → `terminals` 服务被注册两次，
cordis 拒绝：`service "terminals" has been registered`。
→ **已删掉 web-app 的补挂**（rc.2 由 profile patch 提供），改在生产 profile patch 补 `terminal-pwsh`
（备份 `cordis.patch.yml.bak-rc2-pwsh-20261112233102`）。
**这个改动必须 commit，否则切生产会带着重复注册。**

## 4. 生产 preset 已同步的修复

| 修复    | 内容                                                                                                             | 备份                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| P2-2    | 删 `tool-subagent-control/list-agents` 独立行（上游并入本体）；`dsh-workflow-worker-thread` → `dsh-workflow-ptc` | `agent.cordis.yml.bak-p22fix-20261112232758` |
| {{cwd}} | 7 个 preset 全部移除 `{{cwd}}` 变量                                                                              | `agent.cordis.yml.bak-cwdvar-20261112233901` |

## 5. 回滚

生产 3080 仍在跑 0.1.5（`~/deepseek-harness` @ `lan-access-0.1.5-merged`，未动）。
切过去后回滚 = 把 3.2/3.3/3.4 改回去 + 把 `.dsh-memory` 等新目录处理掉 + 用户重启 dsh-web。

## 6. 未验证项（诚实标注）

- **第三方 npm bundle 未加载**：冒烟 HOME 里 `dsh-free-search` / `dsh-persona-memory` / `dshmarket` /
  `dsh-pocket` / `@a9i5k4/dsh-auto-memory` / `dsh-vision-router` / `dsh-plugin-playwright`
  都报 `cannot resolve profile bundle`（冒烟 HOME 没装这些 npm 包）。
  **生产环境它们是装好的，切过去不会缺**——但记忆写入工具（`memory_log` 等）来自
  `dsh-auto-memory`，切生产后要确认那 10 个工具能被裁掉。
- LAN 侧（10.10.10.x 访问）的 cookie authority 隔离与 PRIVILEGED_METHODS 围栏未在 rc.2 冒烟重测
  （上轮 0.2.2-alpha.2 测过并全绿，rc.2 未重测）。
- 守卫的**行为级**探针（记忆写入被拦、依赖不对齐被阻断）未端到端跑，只验证了插件 active。
