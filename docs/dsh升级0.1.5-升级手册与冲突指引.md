# dsh 本地升级 0.1.5-alpha.1 — 升级手册与冲突指引

> 生成：2026-09-09，主编排 agent 基于 merge 预演（真实冲突清单，非估算）。
> 现网：`/home/dingx/deepseek-harness` @ `feature/lan-access`（0.1.1-rc.2 底座 + 33 个本地提交）。
> 目标：升级到 `origin/master`（dsh-0.1.5-alpha.1，2026-09-08），保留全部本地定制。
> **用户执行第 0~5 步；升级完成后主 agent 接手第 6 节回归验证。**

---

## 0. 预演结论速览

| 项目              | 数据                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- |
| 落后上游          | 2942 提交（0.1.1-rc.2 → 0.1.5-alpha.1，18 天）                                           |
| 本地独有提交      | 33 个（LAN 访问 + guard 插件栈 + tool-cordis 门控 + subagent 预设组合）                  |
| 双侧都改的文件    | 33 个（候选面）                                                                          |
| **真实冲突文件**  | **20 个**（worktree 实测，非估算）                                                       |
| 冲突密度          | continuation.ts 5 处（最高）；child-agent.ts 3 处；connection/index.ts 2 处；其余各 1 处 |
| Node/pnpm         | 本机 v22.22.3 / 11.7.0，满足上游 engines `^22.19.0 \|\| >=24` ✅                         |
| 上游原生 LAN 支持 | **无**（trusted-host 为本地独有，必须移植）                                              |
| 预演 worktree     | `/home/dingx/DSF-work/.temp/dsh-merge-test`（保留作对照，勿删）                          |

**保险网**：code-agent 正在预演 worktree 里预构建完全解决冲突的分支 `lan-access-0.1.5-pre`。方案 A（手动合并）遇到困难时随时切方案 B，约 10 分钟完成。

---

## 1. 用户操作序列（方案 A：手动合并，约 30~60 分钟）

### 第 0 步 预检 + 停服务

```bash
cd /home/dingx/deepseek-harness
git status --short            # 必须为空（干净）。不为空先停下叫我
systemctl --user stop dsh-web config-ui
systemctl --user list-units | grep -E 'dsh|config'   # 确认两服务 inactive
```

> 停服后再备份，保证 sessions 数据一致性。停机期间所有 agent 均不可用，属预期。

### 第 1 步 备份（不可跳过）

```bash
# 1a. 仓库全量备份（含 feature/lan-access 全部 33 提交）
cd /home/dingx/deepseek-harness
git bundle create /home/dingx/DSF-work/.temp/harness-backup-$(date +%Y%m%d-%H%M).bundle --all

# 1b. 运行数据备份（sessions 342M 等；V3 迁移会改写原数据，这是唯一回滚凭据）
tar -C /home/dingx -czf /home/dingx/DSF-work/.temp/dsh-home-backup-$(date +%Y%m%d-%H%M).tar.gz \
  .dsh/sessions .dsh/memory .dsh/.agent-presets .dsh/.credentials.yaml .dsh/settings.yaml

# 1c. 核对
ls -lh /home/dingx/DSF-work/.temp/harness-backup-*.bundle /home/dingx/DSF-work/.temp/dsh-home-backup-*.tar.gz
```

### 第 2 步 合并

```bash
cd /home/dingx/deepseek-harness
git fetch origin
git checkout master
git merge --ff-only origin/master     # 本地 master 快进到上游
git checkout -B lan-access-0.1.5      # 新工作分支（基于 0.1.5）
git merge feature/lan-access          # ← 停在 20 个冲突上，按第 2 节逐文件解决
```

### 第 3 步 解决冲突（逐文件指引见第 2 节）

解决过程中随时自查进度：

```bash
git diff --name-only --diff-filter=U   # 剩余未解决文件，归零为止
git grep -n '^<<<<<<<' -- . | wc -l    # 残留冲突标记，必须为 0
```

全部解决后提交：

```bash
git add -A
git commit    # 默认 merge 信息即可
```

### 第 4 步 安装 + 构建

```bash
cd /home/dingx/deepseek-harness
pnpm install        # 锁文件自动补本地新包；约 5~15 分钟
pnpm build          # tsx scripts/build.ts
```

> 若 pnpm install 报 minimumReleaseAge 阻塞：不要放宽策略，把报错原文发我。

### 第 5 步 启动 + 验证

```bash
systemctl --user start dsh-web config-ui
sleep 15
systemctl --user status dsh-web --no-pager | head -5
curl -s -o /dev/null -w '本机3080: %{http_code}\n' http://127.0.0.1:3080
curl -s -o /dev/null -w 'LAN 3080: %{http_code}\n' http://10.10.10.9:3080
curl -s -o /dev/null -w 'config-ui: %{http_code}\n' http://127.0.0.1:3083
```

**LAN 最终验证**：从另一台设备（手机/PC）浏览器打开 `http://10.10.10.9:3080`，能出登录页/首屏即 LAN 功能移植成功。

完成后告诉我"升级完了"，我立即接手第 6 节回归 + P3 质检。

---

## 2. 20 个冲突文件逐个解决指引

> 合并方向：ours（`:2:`）= 上游 origin/master，theirs（`:3:`）= 本地 feature/lan-access。
> 看某一文件两侧完整版本的命令：`git show :2:路径`（上游）/ `git show :3:路径`（本地）。

### A 类：机械并集（简单，5 个）

| #   | 文件                            | 做法                                                                                                                                                                                     |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.gitignore`                    | 两块都保留：上游 `native/system/test/bin/` + 本地运行时目录块（`.dsh/` `.dsh-memory/` `.temp/` 及注释）                                                                                  |
| 2   | `pnpm-workspace.yaml`           | 豁免清单取并集：上游 claude-agent-sdk@0.3.263 系列 + codex@0.153.4 系列（含注释行）与本地 @aws-sdk/* 六条并列，注意缩进一致                                                              |
| 3   | `apps/cli/package.json`         | dependencies 取并集：上游全量 + 本地新增 6 个 `@deepseek-ai/dsh-{skill-router,guard-main-agent,injection-manager,memory-manager,subagent-guard,jobs-local}: workspace:^`，注意 JSON 逗号 |
| 4   | `pnpm-lock.yaml`                | **不要手工合**：`git checkout --ours pnpm-lock.yaml`（保上游锁文件，pnpm install 自动补本地包），然后 `git add pnpm-lock.yaml`                                                           |
| 5   | `docs/config-catalog.i18n.yaml` | 取上游：`git checkout --ours docs/config-catalog.i18n.yaml && git add docs/config-catalog.i18n.yaml`（升级后重录，回归清单第 7 项）                                                      |

### B 类：LAN 功能（核心，4 个文件 5 处冲突）

| #   | 文件                                                       | 冲突数 | 做法                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | `apps/web/src/main.ts`                                     | 1      | 以上游瘦引导结构为基底，把本地版（:3:）里**从 `/* oxlint-disable` 注释开始到 polyfill 函数块结束**的 crypto.randomUUID polyfill 整块插入上游文件头部（模块初始化之前）。这段 polyfill 是 http://LAN-IP 不安全 origin 下 Web UI 能用的关键，一字段都不能丢                                             |
| 7   | `packages/client/connection/src/index.ts`                  | 2      | 两侧都要：上游新结构 + 本地 PRIVILEGED_METHODS 围栏与 trustedHosts DNS-rebinding 防线。**判断规则**：settings._/credentials._/host.*（配置、凭据、桌面操作）类方法一律在围栏清单里；llm.providers/llm.models（模型目录）类不围栏（LAN 选模型需要）；上游 18 天新增的配置/凭据类方法要**补进**围栏清单 |
| 8   | `packages/client/ui-settings/src/client/index.ts`          | 1      | 上游基底 + 保留本地逻辑：受信 LAN 页面上 settings mirror 走 host 持久化（不退化为内存态）                                                                                                                                                                                                             |
| 9   | `packages/client/ui-settings/src/client/settings-scope.ts` | 1      | 同上，与 #8 是同一个功能（7cb2d80e35），两侧逻辑对照合并                                                                                                                                                                                                                                              |

> `packages/host/webserver/src/index.ts` 已自动合并成功，无需处理。

### C 类：tool-cordis（2 个）

| #   | 文件                                               | 做法                                                                                                                               |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 10  | `packages/extensions/tool-cordis/src/index.ts`     | 上游基底 + 重新施加 allowMutation 门控（b9efb60a28）：allowMutation=false 时 mutation 工具被拒绝/移除，主 agent 仅 3 只读 inspect  |
| 11  | `packages/extensions/tool-cordis/src/providers.ts` | 冲突源于 api-catalog 路径重构：若上游同样把 api-catalog 移到 src/generated/ 则用上游路径，否则保本地路径。以 `pnpm build` 通过为准 |

### D 类：subagent 栈（最难，8 个文件 13 处冲突）

| #   | 文件                                                                              | 冲突数 | 做法                                                                            |
| --- | --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| 12  | `packages/subagent/subagent/src/continuation.ts`                                  | 5      | 上游演进为基底 + 重新施加本地"子代理从命名 agent preset 组装"逻辑（1ae2ee7697） |
| 13  | `packages/subagent/subagent/src/child-agent.ts`                                   | 3      | 同上，保 preset 组装入参传递                                                    |
| 14  | `packages/subagent/subagent-in-process-driver/src/index.ts`                       | 2      | 同上                                                                            |
| 15  | `packages/subagent/subagent/tests/continuation.spec.ts`                           | 1      | 测试用例并集：上游新用例 + 本地 preset 组合用例                                 |
| 16  | `packages/subagent/tool-subagent/src/index.ts`                                    | 1      | 上游基底 + 本地 preset 组合参数                                                 |
| 17  | `packages/subagent/tool-subagent/README.md` / `README.zh.md` / `README.i18n.yaml` | 各 1   | 本地新增的 preset 组合章节保留（中英成对）；上游已覆盖等价内容则以上游为准      |

> **建议**：D 类如果拿不准，不要硬来——直接放弃方案 A 转方案 B（预构建分支里这些已由 code-agent 解决并经构建验证）。

---

## 3. 方案 B：预构建分支保险网（方案 A 卡住时用，约 10 分钟）

前置：code-agent 已完成 `lan-access-0.1.5-pre` 分支（完成时我会回填 SHA 到此处：**PREBUILT_SHA**）。

> **⚠ 状态（2026-09-09 14:30）**：因子代理后端连续 3 次无输出失败（微型探针亦失败，确认为后端临时宕机而非任务问题），预构建分支**尚未建成**。这不阻塞方案 A——手动合并照常执行。若你在 D 类（subagent 栈）卡住而预构建仍未恢复：执行 `git merge --abort` 安全回到合并前状态（不会丢任何东西），然后等我重试预构建或换时间再升。

```bash
cd /home/dingx/deepseek-harness
git merge --abort                                  # 放弃当前手动合并（若无进行中合并会报错，忽略）
git fetch origin 2>/dev/null; true
git checkout -B lan-access-0.1.5 lan-access-0.1.5-pre
git log --oneline -1                               # 应显示预构建 merge commit
pnpm install && pnpm build
systemctl --user start dsh-web config-ui
```

若我通知你预构建也失败：**不要硬升**，执行 `git checkout feature/lan-access && systemctl --user start dsh-web config-ui` 原地恢复，我们另约时间。

---

## 3.5 断联保险与升级前零风险预检（2026-09-09 补充，回应"升级后会不会彻底断联"）

### A. 升级前可做的零风险预检（不停服、不动现网，强烈建议先跑）

```bash
# 在独立 worktree 里实测 0.1.5 纯上游能否在本机启动（与现网完全隔离）
cd /home/dingx/deepseek-harness
git worktree add /home/dingx/DSF-work/.temp/dsh-user-boottest origin/master
cd /home/dingx/DSF-work/.temp/dsh-user-boottest
PATH=/home/dingx/.hermes/node/bin:$PATH pnpm install
PATH=/home/dingx/.hermes/node/bin:$PATH DSH_HOME=$PWD/.boot-home \
  timeout 60 pnpm dsh web --host 127.0.0.1 --port 3999 --no-open > /home/dingx/DSF-work/.temp/boottest.log 2>&1 &
sleep 40 && curl -s -o /dev/null -w 'boot-test: %{http_code}\n' http://127.0.0.1:3999
# 期望 200 → 放心继续第 1 节流程；非 200 → 停，把 boottest.log 尾部发我（此时服务未停，联系畅通）
```

### B. 已验证的磁盘级事实（源码与实证，非推测）

1. **会话本体在磁盘**：`~/.dsh/sessions/` 实测 **770 个会话文件**。我与你的全部对话存在这里，不依赖任何进程存活——服务停了、版本换了，文件原地不动。
2. **V3 迁移不改写原文**（源码级确认，`released-session-format-migrations` 决策）：迁移策略 = 源文件"路径、字节、inode 保持不变"，只**另发**一个新版本文件（`session.v3.jsonl.zstd`）；迁移被拒时同样"原文不动、不发布"。⇒ 回滚到旧分支后，旧版读自己的原文件，**照常恢复全部历史**。
3. **从 0.1.1-rc.2 升级有官方实测**：上游回归 fixtures 里就有 `v3-single-unit.json`（正是 0.1.1-rc.2 的存储布局）→ 升级路径被明确测试过；projection-cache 坏记录走 `backup-and-skip`（改名为 `.bak.<时间戳>` 保留、跳过、启动不炸）。
4. **服务自愈**：`dsh-web.service` 配置 `Restart=on-failure`（崩溃 5 秒自动拉起）+ `ExecStartPre` 每次启动自动 `pnpm install`（忘装依赖也不会起不来）。
5. **备份双保险**：第 1 步的 git bundle（全部分支）+ sessions tar（迁移前原样数据）是最后凭据。

### C. 救援三连（纯终端可执行，不依赖 GUI；卡住任何一步>5 分钟就先跑这个）

```bash
# ① 服务挂了先试重启（会自动装依赖）
systemctl --user restart dsh-web

# ② 回滚到旧版本（旧分支引用从未被动过，原地可跑）
cd /home/dingx/deepseek-harness && git checkout feature/lan-access && pnpm install && systemctl --user restart dsh-web

# ③ 连旧版都起不来：恢复升级前数据快照后再启动
systemctl --user stop dsh-web
tar -C /home/dingx -xzf /home/dingx/DSF-work/.temp/dsh-home-backup-*.tar.gz
systemctl --user start dsh-web
```

服务一恢复，浏览器重开 `http://10.10.10.9:3080` 进入同一会话，联系即刻恢复。

### D. 唯一已知代价（如实告知）

升级成功并继续使用后，**新产生的消息**写入 V3 新文件——若之后才回滚旧版，旧版只能看到升级前的历史（升级后的新消息文件仍在磁盘，不丢，但旧版不读）。所以：**升级后先别急着重启回旧版**；若要回滚，尽早回滚。

### E. 黄金法则

> 升级窗口内（服务停止期间）联系本就中断，这是预期内的短窗。任何一步卡住超过 5 分钟：**先跑救援三连恢复服务，再回 GUI 找我**——永远不要在服务停机的状态下反复尝试修问题。

---

## 4. 回滚预案

| 层面                 | 操作                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 代码回滚             | `cd /home/dingx/deepseek-harness && git checkout feature/lan-access && pnpm install && systemctl --user start dsh-web config-ui`（旧分支引用未动，原地可跑）                                                          |
| 数据回滚（极端情况） | `systemctl --user stop dsh-web` → `tar -C /home/dingx -xzf .temp/dsh-home-backup-*.tar.gz`（覆盖 .dsh/sessions 等）→ 起服务。注：源码已证实 V3 迁移**冻结原文、另发新文件**，正常回滚不需要此步；此步仅为极端损坏兜底 |
| 服务起不来           | `journalctl --user -u dsh-web -n 50 --no-pager` 把输出发我；应急回滚另有 `/home/dingx/bin/rollback.sh`（harness 类）                                                                                                  |

---

## 5. 本次保留的 33 个本地提交清单（归属映射）

**LAN 访问线（5）**：b7a29bbd40 LAN/远程 Web UI 服务、1aa59b9e83 randomUUID polyfill lint 修复、7cb2d80e35 ui-settings LAN 持久化、719386ad31 guard-main-agent 主 agent 行为强制、（webserver 随 b7a29bbd40）
**guard 插件栈（8）**：8a70d130bb dep-align-guard、1e625ee49e subagent-guard、1d26ada35a/bb4195058b/808fc89e74/7f5954c212 防护修复、5514dc7184/6d65d43582 分类器 fail-open、2096f422db 文件策略热重载、1b42c7e8fa **rm 硬禁**（用户指令）
**tool/inject/memory（6）**：b9efb60a28 tool-cordis allowMutation、de58830d39 injection-manager、5daf93ba28 memory-manager、655d8cc30e user-entries 通道、a971d878de/8dee795573 会话摘要注入、fc61e2ff89 skill-router
**subagent 线（4）**：1ae2ee7697 预设组合、2f0b8abe7f randomUUID import、a336607bcb preset-test 临时根、2f0b8abe7f 委派分发
**杂项（其余）**：7530e5808a .gitignore 运行时目录、812c80b842 config-catalog 重录、d63c145b87 AWS SDK 豁免、1f5edb743b inject 校验脚本等

---

## 6. 升级后主 agent 接手的回归清单（P3 前置）

1. 服务健康：3080/3083/9119 全 200，软路由 10.10.10.2:9888 可达
2. LAN 访问：从局域网设备访问 3080 正常（trusted-host 两地址仍生效）
3. guard rm 硬禁四通道验证；guard-main-agent 文件白名单验证
4. tool-cordis allowMutation=false：主 agent 仅 3 只读 inspect
5. 记忆管线：memory-manager 注入、conversation-summary、自动沉淀正常
6. skill-router 过滤、subagent 预设组合（六件套冒烟）
7. config-catalog 重录（本地插件条目补回文档）
8. 会话 V3 迁移抽检：旧会话可读、journal 无迁移报错
9. P3 独立质检 + 异 agent 复检
10. 软路由安装包重建 —— **明确不在本次范围**，本次只升本地

## 7. 升级收益回顾（为何值得升）

聊天流式/会话恢复性能优化、Web UI 大改版（文件树/产物直达/标签页）、会话 V3 格式+写租约+迁移审计、工作区文件双面 API；同时缩小 2942 提交漂移，越晚升移植成本越高。
