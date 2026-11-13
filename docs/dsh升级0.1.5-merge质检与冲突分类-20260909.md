# dsh 升级 0.1.5：merge 现场质检与 20 冲突分类（check-agent 独立产出）

> 来源：check-agent 于 2026-09-09 深夜对预演 worktree `/home/dingx/DSF-work/.temp/dsh-merge-test` 的独立核查（本应是链路探针，agent 自主完成了完整质检）。主 agent 仅做落盘转存，未改结论。

## 一、实际状态核对（纠正此前口径）

| 项目            | 此前声称 | 实际核查                                                                       |
| --------------- | -------- | ------------------------------------------------------------------------------ |
| 暂存文件数      | 155      | **142 staged + 20 UU = 162 条路径**                                            |
| merge 完成度    | —        | 未完成，20 文件仍有冲突标记                                                    |
| pnpm install    | —        | 未执行，worktree 无 node_modules                                               |
| vendor/DSF-work | 卡点     | 根因确认（见下），且 **git 双分支 ls-tree 均无此路径＝未追踪，删除无版本风险** |

## 二、gen-third-party-notices.ts ENOENT 根因（确认）

`vendor/DSF-work/` 是 2026-08-25 打包遗留空壳（仅含 .temp/，32K，未追踪）。脚本 `collectVendored()` 遍历 vendor/ 所有子目录并 `readManifest('vendor/<name>/package.json')` → DSF-work 无 package.json → ENOENT。**修复＝删除该目录（安全）**。

## 三、20 冲突文件四类分法与逐类解法

### A类：简单并集/单侧取用（机械合并）

| 文件                                               | 解法                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.gitignore`                                       | 保留两边（native/system/test/bin/ + .dsh/.dsh-memory/.temp/）                       |
| `docs/config-catalog.i18n.yaml`                    | 取 feature 新 hash                                                                  |
| `packages/subagent/tool-subagent/README.*`（3 个） | 取 feature 新翻译 hash                                                              |
| `apps/web/src/main.ts`                             | 取 feature 版本（crypto.randomUUID 兼容，LAN 必需）                                 |
| `apps/cli/package.json`                            | 取 HEAD 的 version=0.1.5-alpha.1 + configTrees，追加 feature 的 "config" files 条目 |

### B类：上游重构覆盖（保留 HEAD 或按项取舍）

| 文件                                           | 解法                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-cordis/src/index.ts`                     | **取 HEAD 简化签名**（上游有意移除 Config/allowMutation——注意：这与本机 allowMutation=false 用法冲突，需主 agent 后续评估是否再以独立 commit 找回） |
| `tool-cordis/src/providers.ts`                 | 取 feature 新路径（./generated/api-catalog.ts）                                                                                                     |
| `client/connection/src/index.ts`               | 取 feature 版本                                                                                                                                     |
| `client/ui-settings/{index,settings-scope}.ts` | 取 feature 版本                                                                                                                                     |

### C类：架构冲突（本次 merge 最大风险点，需人工 porting）

- `packages/subagent/subagent/src/continuation.ts`：feature 的 **presetId 子代理预设功能**（1ae2ee7697）基于旧 1594 行结构；上游重构为 537 行 `ContinuableActivationRegistry`。**两侧都不能直接选**：需把 presetId 逻辑 port 到新架构。
- 伴随：`child-agent.ts`（presetStandingKey/ScopeKey）、`tests/continuation.spec.ts` 跟随重写。
- **porting 后必须专项回归 subagent presetId 路径**（项目执行系统核心能力）。

### D类：lockfile/workspace

- `pnpm-workspace.yaml`：保留 node-pty patch；**删除 @yao-pkg/pkg entry**（对应 patch 文件已不存在）；Claude SDK 与 AWS SDK 列表并集。
- `pnpm-lock.yaml`：解完 workspace 后 `pnpm install` 重生成。

## 四、阻塞项与执行序列

阻塞：P0 vendor/DSF-work 未删（hook 必炸）；P0 continuation.ts porting；P1 pnpm install 未跑；P1 @yao-pkg/pkg 残留 entry。

序列：①删 vendor/DSF-work → ②机械解 A/B 类 → ③porting continuation.ts（最关键）→ ④解 pnpm-workspace.yaml → ⑤git add 全部 → ⑥pnpm install → ⑦git commit（hook 应过）→ ⑧构建+冒烟。
