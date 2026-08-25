# 实施计划 v2：建立 project-planner（项目规划师）Agent

> 2026-08-20 | 参照 plan-reviewer preset 模式 | v2 修订（响应 plan-reviewer 评审 7 点：补 persona 全文/调用链/验收量化/bite-sized 定义/todo 取舍/模型说明）

## 一、目标与定位

建立 **project-planner**（项目规划师）子 Agent：P1 规划阶段专职创作——读立项文档 → 定文件结构 → 拆 bite-sized 任务 → 每任务写验收标准 → 产出 `docs/计划.md`。**只规划不实施**，独立于实施（code-agent）与评审（plan-reviewer）。

**五环闭环调用链（明确）**：

```
主 agent（收到立项需求）
  → 派 call_project_planner 产出 docs/计划.md（v1）
  → 主 agent 转交 call_plan_reviewer 评审计划
  → 评审不过 → 退回 project-planner 修订 → 重审（循环直到通过）
  → 评审通过 → 派 code-agent 实施（P2）
  → 派 check-agent 质检（P3）→ 用户验收（P4）→ 收尾（P5）
```

- **触发条件**：主 agent 完成 P0 立项（有 docs/立项.md）后，进入 P1 时调用
- **立项文档标准**：复用现有 `docs/立项.md` 格式（背景/目标/范围/核心设计/验收标准/里程碑）；若立项缺失，project-planner 先基于用户意图产出草案，主 agent 确认立项后再正式规划
- **角色区分（防混淆）**：plan-reviewer=评审（挑毛病），project-planner=创作（产出计划），prompt 职责明确区分

## 二、Preset 设计（参照 plan-reviewer）

### 2.1 目录与文件

```
~/.dsh/.agent-presets/project-planner/
├── preset.yml          # name: 项目规划师 / description
└── agent.cordis.yml    # persona + agent-instructions + 工具集
```

### 2.2 工具集

- `persona`、`agent-instructions`（maxBytes 65536）
- `tool-fs`（读立项/写计划.md）、`tool-fs-search`（读项目结构）
- `compaction`（组：compaction-basic / command-compact / tool-result-pruner）
- `tool-session-query`、`tool-str-replace-editor`、`tool-skill`
- **去掉**：bash、goal/planning、todo、子代理编排、cordis 运行时
- **todo 取舍说明**：规划是**一次性产出**（不跨会话跟踪执行进度），输出即 docs/计划.md 本身，因此**不需要 todo 工具**；执行期跟踪由 code-agent（P2）负责

### 2.3 persona（完整英文文本，可直接复制）

```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: |-
      You are the PROJECT PLANNER agent in the DeepSeek Harness project system. You turn a validated proposal (立项.md) into an executable plan. Your working directory is {{cwd}}. You run on the {{model}} model.

      You DO NOT write code, implement features, or execute tasks. You only produce a PLAN, then report it to the main orchestrator agent.

      Your duties:
      - Read the proposal doc (docs/立项.md): background, goals, scope (do & don't), acceptance criteria, milestones.
      - Define the file structure first: directory tree + main file names.
      - Decompose into bite-sized tasks (each task ≤30 min, verifiable by a single typecheck/lint/test run).
      - Write acceptance criteria per task: green = checks pass, red = do not proceed.
      - Specify dependency order (which tasks must finish before others) and risks (external API, new deps, rollback).
      - Produce docs/计划.md (Chinese, checklist style): task list + dependency order + risks.

      Hard rules:
      - PLAN ONLY. Never write production code, never modify the codebase.
      - Every task must be verifiable; no vague tasks.
      - No over-engineering: avoid redundant abstractions and premature optimization.
      - Evidence before claims: base the plan on the actual proposal, not assumptions.
```

### 2.4 full preset 挂载（追加，照 tool-subagent-plan-reviewer 格式）

```yaml
- id: tool-subagent-project-planner
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: call_project_planner
    backgroundMode: one-shot
    presetId: project-planner
    agentOptions:
      provider: agnes
      model: agnes-2.5-flash
```

### 2.5 模型选型说明

- project-planner 用 **agnes-2.5-flash（免费）**：规划不需顶级模型，"够用就好"原则；agnes 大请求已验证稳定（plan-reviewer/check-agent 实测通过）
- plan-reviewer 也用 agnes（gpt-oss-20b 因 groq 大请求限流 429 不可用于子代理，已记录于 CHANGELOG）；两角色职责不同（评审 vs 创作），prompt 强区分

## 三、实施步骤

1. 建 `~/.dsh/.agent-presets/project-planner/`（preset.yml + agent.cordis.yml，照 plan-reviewer 抄改）
2. 备份 `full/agent.cordis.yml` → 追加 tool-subagent-project-planner 挂载行
3. YAML 语法校验（python yaml.safe_load 读两个文件）

## 四、验收标准（量化可检查）

**合格计划检查项**（call_project_planner 产出物必须全部满足）：

- [ ] 含文件结构树（目录 + 主要文件名）
- [ ] 每个任务有验收标准（绿/红）
- [ ] 标注依赖顺序
- [ ] 标注风险项
- [ ] 无过度设计（无冗余抽象/提前优化）
- [ ] 不包含任何代码/实施动作（只规划不实施）

**preset 正确性**：

- [ ] `~/.dsh/.agent-presets/project-planner/` 存在且结构完整（preset.yml + agent.cordis.yml）
- [ ] full preset 含 tool-subagent-project-planner（presetId: project-planner）
- [ ] YAML 语法通过

**无回归**：

- [ ] 重启后 call_plan_reviewer / call_check_agent 连通正常
- [ ] full preset 其余配置未损坏

## 五、风险与注意

- 格式完全照 plan-reviewer 抄（preset 文件 + 挂载行），只改 id/toolName/presetId/persona 文本
- 不碰 settings.yaml / 主系统其他配置
- 若挂载后 call_project_planner 不出现：检查挂载行缩进/YAML 语法/重启是否生效
