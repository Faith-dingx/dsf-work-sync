# 9888 免费模型真实能力测试报告

> 测试时间：2026-08-20 03:5x（串行温和测试，间隔 2.5s，控制频率不触发限流）
> 说明：9888 暴露清单/命名是动态的（路由质量筛选），本报告基于当时可调用清单；使用前请先跑 `scripts/refresh-9888-models.py` 读最新表 `.temp/9888-models.json`，不依赖本报告的具体清单。

## 一、重要发现：可调用全集 vs /v1/models

- **/v1/models 只返回精选子集**（当时 8 个），但 **chat/completions 实际可调用 48 个**（含 `openrouter/` 免费档一大批）
- 已改进刷新脚本：`/v1/models` + 探测法（调未知模型解析 400 错误里的权威可用列表）合并去重 → 完整表
- 模型 id 命名随路由调整变化（曾出现 `agnes-2.5-flash` → `agnes/agnes-2.5-flash`），**用前必须实时读表**

## 二、可调用模型实测分类

### 🟢 稳定可用（实测成功，推荐）

| 模型 id                                             | 代码 | 中文             | 推理 | 延迟     | 定位                                      |
| --------------------------------------------------- | ---- | ---------------- | ---- | -------- | ----------------------------------------- |
| `groq/openai/gpt-oss-20b`                           | 优   | 优               | 优   | 1.3–3.1s | **全能首选**（code/zh/reason 都好）       |
| `groq/openai/gpt-oss-120b`                          | 优   | —                | —    | 1.7–3.0s | code 强，docstring 完整                   |
| `groq/groq/compound`                                | 优   | 优               | 优   | 4.5–5.6s | 推理 + 代码都强                           |
| `groq/groq/compound-mini`                           | —    | 优               | 优   | 4.1–5.4s | 推理/轻量                                 |
| `groq/qwen/qwen3.6-27b`                             | 优   | 优(带thinking链) | 优   | 2.5–2.6s | 中文强，但输出带推理过程，需大 max_tokens |
| `agnes/agnes-2.5-flash`                             | 优   | 优               | 优   | 2.2–4.5s | **check-agent 首选**（在用）              |
| `google/gemini-3.1-flash-lite`                      | 优   | 优               | 优   | 2.8–9.2s | check 备用                                |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free` | —    | 优               | 优   | 6.4–8.6s | 550B 大模型，可用但慢                     |
| `openrouter/cohere/north-mini-code:free`            | 优   | —                | —    | 19–45s   | 代码可用但太慢，不实用                    |

### 🔴 不可用/不稳定（实测 500）

- `openrouter/qwen/qwen3-coder:free`、`openrouter/deepseek/deepseek-v4-flash:free`、`openrouter/openai/gpt-oss-20b:free` —— **HTTP 500**（openrouter 池部分上游不可用）
- `groq/compound-mini`（无前缀旧 id，已废弃——正确 id 是 `groq/groq/compound-mini`）

## 三、对工作的建议

| 用途                   | 推荐模型                                                              | 理由                                         |
| ---------------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| **code-agent 免费化**  | `groq/openai/gpt-oss-20b`                                             | 代码+中文+推理全能、快，替代付费 opencode-go |
| **code 重任务**        | `groq/openai/gpt-oss-120b`                                            | 代码能力更强、docstring 完整                 |
| **check-agent**        | `agnes/agnes-2.5-flash`（现状）+ `google/gemini-3.1-flash-lite` 备用  | 中文/质检/推理都稳                           |
| **规划/推理/方案探索** | `groq/groq/compound`                                                  | 推理链强                                     |
| **中文专项**           | `groq/qwen/qwen3.6-27b`                                               | 中文最好（注意 thinking 链输出）             |
| **大模型场景（按需）** | `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`                   | 550B，慢但强                                 |
| **避开**               | openrouter 池 qwen3-coder / deepseek-v4-flash:free / gpt-oss-20b:free | 500 不可用                                   |

## 四、要点

1. 清单/命名动态 → **用前实时读表**（`scripts/refresh-9888-models.py`，crontab 每小时自动）
2. **openrouter 池不稳定**（部分 500）→ 优先 `groq/` / `agnes/` / `google/` / `nous/` 前缀
3. `qwen3.6-27b` 默认 thinking 推理链 → 调用时 max_tokens 需调大
4. 测试全程串行 + 间隔 2.5s，未触发限流
