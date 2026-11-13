# dsh 0.2.2 升级方案（2026-10-30 定稿）

> 目标：**升级到 0.2.2，同时保住局域网访问与长期记忆，并放开主 agent 权限让它能干基础活。**
> 执行人：dsh 主 agent（3080 实例）。审批/重启：用户。验收：Hermes（本方案作者）。
> 回滚锚点：`~/deepseek-harness` @ `lan-access-0.1.5-merged`（0.1.5 分支从未改动）。

---

## 0. 现状事实（2026-10-30 19:00 实测）

| 项         | 值                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 生产实例   | `~/deepseek-harness` v0.1.5-alpha.1 @ `lan-access-0.1.5-merged`，3080 端口，systemd --user `dsh-web.service`             |
| 预演目录   | `~/dsh-022-pretest` v0.2.2-alpha.2 @ 分支 `dsh-v0.2.2-lan-access`，HEAD `f917efc7d3`，3091 端口冒烟实例（隔离 DSH_HOME） |
| 对照目录   | `~/dsh-022-vanilla` v0.2.2 纯上游 @ tag `dsh-v0.2.2-alpha.2`(f3803c9697)，只读参照                                       |
| 预演 build | ✅ `run-gates: 10 passed, 0 failed`（89s 全量 / 42s 增量）                                                               |
| 预演 tests | ✅ 132 passed / 28 skipped（28 个是集成测试，见 P2-3）                                                                   |
| 生产 build | ✅ 234 client artifacts（0.1.5 基线）                                                                                    |
| 分类器     | 9888 `modelscope/Qwen/Qwen3.8-Flash-Next` 实测 200 OK、1.4s                                                              |

---

## P0 已完成（Hermes 执行，已落库）

### P0-1 guard 授权改造（代码 + 测试 + 构建，主仓与预演仓同步）

| 改动                       | 文件                                                                                   | 语义                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codeClassFallback` 新配置 | `src/types.ts` `src/index.ts` `src/policy.ts`                                          | 分类器不可用时，bash/shell/edit 族按配置放行（默认仍 `close` 保旧行为）；预设置 `open`                                                                 |
| 黑名单 + 默认放行          | `src/filePolicy.ts`                                                                    | 判定顺序改为：**黑名单命中即拒** → 白名单命中（含扩展名门）→ 临时例外 → `defaultPolicy: allow` 放行 → 兜底拒绝                                         |
| rm 规则放宽                | `src/policy.ts`（`rmTargetsOutside`/`tokenizeShell`）+ `src/index.ts`（`rmOffenders`） | 工作区内的删除放行；越出工作区、家目录根、`/`、`cd` 后删除、`git rm`/`docker rm` 仍硬禁并转 code-agent；realpath 二次校验防软链逃逸（2026-08-25 事故） |
| 0.2.2 注入源声明           | 预演仓 `src/index.ts`                                                                  | 0.2.2 取消了 catch-all `kind:'plugin'`，改为模块增强声明 `kind:'guard-main-agent'` + `form:'notice'`                                                   |

测试：主仓 160 passed / 0 failed；预演仓 132 passed / 28 skipped。构建：两仓均 10/10 gate 绿。

### P0-2 预设置已切到放开档

`~/.dsh/.agent-presets/full/agent.cordis.yml` 与 `full-hub/`（备份：`*.bak-guardopen-20261030`）：

```yaml
fallback: 'open' # 其余工具：分类器挂掉放行
diagnosticFallback: 'open'
codeClassFallback: 'open' # bash/shell/edit：分类器挂掉放行（原硬拦转 code-agent）
filePolicyPath: 'docs/主agent可改写文件清单.yaml' # 已含 defaultPolicy: allow + blacklist
```

仍然硬生效（不受放开影响）：**rm 越出工作区**、**文件黑名单**（凭据 `.credentials.yaml`/`dsh.env`/`.ssh`/记忆库/`.git`/系统目录/清单文件自身）、审批通道、`call_code_agent`/`call_check_agent` 派发。

### P0-3 生效方式

主仓 `lib/index.js` 已重新打包（`codeClassFallback` 已在产物中）。**用户重启 `dsh-web` 后新权限即生效**（Agent 不重启服务，遵守铁律）。

---

## P1 待执行：5 个定制插件在 0.2.2 上的移植清单

0.2.2 对以下机制做了破坏性变更，5 个插件**没有任何一个**能靠配置直接迁过去：

| 插件                                           | 0.2.2 变更点                                                                                     | 需做的工作                                                                     | 优先级                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------ |
| `guard-main-agent`                             | `MessageSourceMap` 去掉 `kind:'plugin'`（改合并扩展）                                            | 已在本轮修好（模块增强声明）                                                   | ✅ 完成                  |
| `guard-main-agent` 集成测试                    | testkit 迁移到 `@deepseek-ai/dsh-tool-testkit`；`Session.create` version 3→4；`Agent.model` 必填 | 28 场景重写（现整体 skip），按 `Session`/`Agent` 新形态重建 fixture            | P2-3                     |
| `skill-router`                                 | 注入管线按 form/section 重构                                                                     | 校验注入内容与 `form:'snapshot'` 的 `sections` 结构一致，跑通技能注入          | 高                       |
| `dsh-injection-manager` / `dsh-memory-manager` | 会话 activation / continuation 机制重写（`continuation.ts` 被上游删除）                          | 重接注入时机，验证长期记忆写入/召回端到端                                      | 高（用户核心诉求）       |
| `dsh-subagent-guard`                           | 子代理 preset 组装改为上游新机制                                                                 | 保留"子代理按命名 preset 组装"逻辑，验证 code-agent/check-agent 仍按 preset 起 | 中                       |
| `dsh-dep-align-guard` / `dsh-memory-guard`     | host 级监听器契约微调                                                                            | 回归两条守卫探针                                                               | 中                       |
| `tool-cordis`                                  | `allowMutation` 门控需重新施加；`api-catalog.ts` 生成物改名                                      | 上游基底 + 本地门控，验证 false 时主 agent 仅 3 只读 inspect                   | 中                       |
| `connection` 特权方法围栏                      | 0.1.5→0.2.2 新增 `settings.*/credentials.*/host.*` 方法                                          | 补齐 `PRIVILEGED_METHODS` 围栏 + `trustedHosts` 防 DNS-rebinding               | **最高（局域网可用性）** |

---

## P2 执行顺序（dsh 主 agent 照做，逐项验收）

### P2-1 局域网可用性验证（最高优先）

```
目标：0.2.2 上 LAN 页面能登录并操作 settings/凭据，同时不被越权调用。
步骤：
1. 用真实配置起二级冒烟：
   mkdir -p ~/.dsh-pretest-l2 && cp -r ~/.dsh/.agent-presets ~/.dsh-pretest-l2/ && cp ~/.dsh/settings.yaml ~/.dsh-pretest-l2/ 2>/dev/null
   cd ~/dsh-022-pretest && DSH_HOME=~/.dsh-pretest-l2 pnpm dsh web --host 127.0.0.1 --port 3092 --no-open --trusted-host 10.10.10.9
2. 验收：3092 返回 401（未认证）→ 登录 → 打开 settings 面板 → 改一项再复原。
3. 验收：从 10.10.10.x 另一台机器访问 3092，确认 trustedHosts 拦非白名单 Host。
4. 验收：未认证客户端调用 settings.*/credentials.*/host.* 被拒（PRIVILEGED_METHODS 围栏生效）。
日志：~/DSF-work/.temp/dsh-022-pretest/smoke-l2.log
```

### P2-2 长期记忆端到端

```
目标：0.2.2 上记忆写入/召回与 0.1.5 一致。
步骤：在 3092 会话里跑 memory 写入 → 重启 3092 → memory_recall 命中 → 检查 ~/.dsh/memory 与 .dsh-memory 落盘位置未变。
验收：写入/召回/重启存活三项通过，且无 {{变量}} 注入报错。
```

### P2-3 guard 集成测试移植（28 场景）

```
目标：恢复被 skip 的 28 个集成场景。
要点：testkit 改从 @deepseek-ai/dsh-tool-testkit 导入；Session.create version 4；
      Agent mock 补 model 字段；pre-execute 管线要走真实 ctx 事件而不是手搓 exec。
验收：npx vitest run packages/extensions/guard-main-agent/tests/ 全绿（160 passed）。
```

### P2-4 guard/skill-router/记忆三插件行为回归

```
探针清单（每条给证据截图/日志）：
① 主 agent 直写普通文件（工作区内）→ 放行
② 主 agent 写凭据/黑名单路径 → 拒绝且不转派（黑名单优先）
③ 主 agent 执行工作区内 rm -rf build/ → 放行
④ 主 agent 执行 rm -rf /etc/xxx → 拒绝 + 转派 code-agent
⑤ 分类器拔线（改 endpoint 到无效端口）→ bash 仍可用（codeClassFallback=open）
⑥ skill-router 注入技能 → 会话里能看到注入内容
⑦ 子代理按 preset 起（code-agent）→ 工具面与 0.1.5 一致
```

### P2-5 替换与验收

```
1. 出《0.2.2 升级评估文档》：逐文件 对比清单（上游文件@行号 / 变更摘要 / 本地点 / 结论 H-S-M-L / 必改 Y-N）。
2. 交接白板：kind=handoff，写明 `dsh-web.service` 切到 ~/dsh-022-pretest @ dsh-v0.2.2-lan-access。
3. 由用户执行：systemctl --user restart dsh-web （Agent 不得自行重启）
4. 冒烟：3080 401→登录→任务→记忆→LAN 客户端；全绿后 M1 归档。
5. 回滚（30 秒）：把 service WorkingDirectory 指回 ~/deepseek-harness，用户重启；
   0.1.5 分支未动，无需 git 操作。
```

---

## 硬约束（不得越线）

1. 重启 `dsh-web` / 任何系统服务 → **用户专属**，Agent 只准备、只验证。
2. 主 agent 模型切换 → 用户专属。
3. 凭据文件（`.credentials.yaml`/`dsh.env`）→ 只读，永不直写。
4. `rm` → 只在工作区内；越界一律转 code-agent。
5. 预演产物先落盘再动手：所有结论写 `~/DSF-work/.temp/dsh-022-pretest/`，升级评估文档写 `~/DSF-work/docs/`。
6. 3090 的 `dsh-sandbox.service` 全程不动。

---

## 附：本次授权改造的可回滚点

| 项            | 回滚方式                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| guard 代码    | `git -C ~/deepseek-harness revert 3173b3aa8f`（单 commit，含 src+tests）                 |
| 预设置        | `cp ~/.dsh/.agent-presets/full/agent.cordis.yml.bak-guardopen-20261030 …`（full-hub 同） |
| 文件清单 YAML | `~/DSF-work/docs/主agent可改写文件清单.yaml`（v3.0 已在库，改回 v2.1 即恢复白名单模式）  |
