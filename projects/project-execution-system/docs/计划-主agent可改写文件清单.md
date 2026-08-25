# 实施计划 v2.1：主 agent 可改写文件清单（guard-main-agent 文件权限拦截）

> **日期**：2026-08-21 | **状态**：P1 规划（只规划不实施）| **版本**：v2.1（响应 plan-reviewer 复审 H1-H4）  
> **主文档**：`docs/主agent可改写文件清单.md`  
> **对接需求**：guard-main-agent 计划 D1（文件权限越界拦截）  
> **v2.1 修订要点**：①删除3.1节黑名单式表格 ②.temp/添加类型限制 ③明确temporaryOverrides时序 ④补充glob匹配算法说明

---

## 一、设计决策（4 个关键问题）

### 决策 1：清单格式——独立 YAML，插件读取

- **选择**：`docs/主agent可改写文件清单.yaml`（结构化数据），`docs/主agent可改写文件清单.md`（人读说明）
- **理由**：YAML 可直接被 TypeScript 解析，无需额外配置；两种文件分离便于维护和阅读
- **插件接入**：guard 插件通过 `config.filePolicyPath` 读取 YAML，启动时加载，运行时查询

### 决策 2：判断逻辑——纯白名单 + fail-close

- **选择**：只匹配白名单，命中放行，未命中拒绝
- **理由**：fail-close 是 guard 插件的整体策略，防止漏放；删除黑名单简化判断逻辑
- **匹配方式**：前缀匹配为主（性能优、可读性好）+ 文件类型限制（如 `docs/` 仅 `*.md`）

### 决策 3：symlink 解析——判定前 realpath

- **选择**：所有路径判定前调用 `fs.realpathSync()` 解析物理路径
- **理由**：防止主 agent 通过符号链接绕过白名单（如 `ln -s ~/.dsh/settings.yaml /home/dingx/DSF-work/.temp/link-to-settings.yaml`）
- **延伸**：禁止在白名单目录内创建指向禁区目标的符号链接

### 决策 4：用户直接要求的例外机制——临时放行记录

- **选择**：在 YAML 中增加 `temporaryOverrides` 字段，记录用户明确要求编辑清单外文件的信息
- **理由**：主agent不碰代码/配置/记忆，但用户明确授权时应有追溯机制
- **格式**：filePath + userMessage快照 + timestamp + expiresAt
- **时序**：用户请求 → 主agent拦截 → 提示用户手动编辑YAML → guard插件启动时加载 → 运行时检查 → 到期自动清理

---

## 二、任务列表（bite-sized，每个 ≤30min）

### T1. 确立清单 YAML 骨架（依赖：无）⭐ 关键路径

- 在 `docs/` 下创建/更新 `主agent可改写文件清单.yaml`，包含：
  - `defaultPolicy: deny`
  - `symlinkResolve: true`
  - `whitelist`：docs/（仅*.md）、projects/_/docs/（仅_.md）、projects/*/README.md、.temp/（.md/.txt/.log/.json）、与agent的交互目录/（任意）
  - `temporaryOverrides: []`（空数组）
- 验收：**YAML 语法校验通过**（`python -c "import yaml; yaml.safe_load(open('docs/主agent可改写文件清单.yaml'))"`）

### T2. 编写清单.md 说明文档（依赖：T1）

- 基于 T1 的 YAML 内容，补充人读版说明（背景、设计原则、边界情况处理、更新机制）
- 明确"白名单之外一律拒绝"的原则
- 补充 symlink 解析策略、临时例外机制时序说明、glob 匹配算法说明
- 验收：**md 文件无语法错误**，与 YAML 内容一致（不矛盾）

### T3. guard 插件增加 filePolicy 模块（依赖：T1）

- 在 `packages/guard-main-agent/src/` 新增 `filePolicy.ts`：
  - 加载 YAML 配置文件（`fs.readFileSync` + `yaml.parse`）
  - 实现 `resolvePath(rawPath): Promise<string>`（realpath 解析，处理 symlink）
  - 实现 `canWrite(path): {allowed, reason, rule}` 函数
  - 检查文件类型限制（`allowedExtensions` 字段）
  - 检查临时例外记录（`temporaryOverrides`）
  - 实现 glob→regex 转换（`globToRegex` 函数）
  - 缓存已加载的配置（避免每次 pre-execute 重新读文件）
- 验收：**单元测试**（mock fs，验证白名单命中/文件类型拒绝/symlink解析/临时例外四种 case）全绿

### T4. 接入 filePolicy 到 tools/pre-execute 事件（依赖：T3）

- 在 `index.ts` 的 `tools/pre-execute` 监听器中：
  - 判断工具名是否为写操作（`write` / `edit` / `str_replace` / `browser_upload_file`）
  - 对写操作调 `resolvePath(filePath)` 获取物理路径
  - 调 `canWrite(resolvedPath)` 判定
  - 若拒绝，将结果注入 policy 层（复用现有 `verdict: 'block'` 逻辑）
- 验收：**单元测试** mock 写操作调用，验证拦截逻辑正确触发；symlink 绕过场景被正确拦截

### T5. 误判处理 + 用户提示（依赖：T4）

- 当主 agent 被文件权限拦截时，注入系统消息：
  - 说明被拦截的文件路径（originalPath + resolvedPath）
  - 说明未匹配白名单的原因
  - 提示用户如何扩容（编辑 YAML 添加白名单条目）
- 验收：**端到端测试**模拟写 `docs/test.yaml`（类型拒绝）及 `~/.dsh/settings.yaml`（不在白名单），确认拦截消息正确生成

### T6. 端到端集成测试（依赖：T5）⭐ 关键路径

- 写 `tests/guard-main-agent.spec.ts`，增加文件权限测试场景：
  - 场景5：主 agent 尝试写 `~/.dsh/settings.yaml` → 应被拦截（不在白名单）
  - 场景6：主 agent 尝试写 `docs/新文档.md` → 应被放行（白名单命中 + 类型允许）
  - 场景7：主 agent 尝试写 `docs/配置.yaml` → 应被拦截（类型不允许）
  - 场景8：主 agent 尝试写 `.temp/test.txt` → 应被放行（临时区允许类型）
  - 场景9：主 agent 尝试写 `.temp/test.ts` → 应被拦截（临时区禁止可执行脚本）
  - 场景10：主 agent 通过 symlink 指向禁区 → 应被拦截（symlink 解析后不在白名单）
  - 场景11：用户临时例外记录生效 → 应被放行
  - 场景12：临时例外记录过期 → 应被拦截（expiresAt < now）
- 验收：**全部测试通过**，`pnpm test` 全绿

### T7. 用户 preset 挂载 + 文档（依赖：T6）

- 在 `~/.dsh/.agent-presets/full/agent.cordis.yml` 的 guard-main-agent 配置中追加：
  ```yaml
  filePolicyPath: 'docs/主agent可改写文件清单.yaml'
  ```
- 在 README.md 中补充文件权限拦截说明（含白名单+fail-close原则、symlink策略、临时例外机制）
- 验收：**YAML 语法通过**，diff 只改 full preset

### T8. 人工验收（依赖：T7 + 重启 dsh）

- Web GUI 测试：
  - 测试5：主 agent 尝试直接写 `~/.dsh/settings.yaml` → 应被拦截
  - 测试6：主 agent 尝试写 `docs/test.md` → 应被允许执行
  - 测试7：主 agent 尝试写 `docs/config.yaml` → 应被拦截（类型限制）
  - 测试8：主 agent 创建 symlink 指向禁区文件 → 应被拦截
  - 测试9：用户要求临时编辑 AGENTS.md → 应被拦截（需先加临时例外记录）
  - 测试10：主 agent 尝试写 `.temp/test.ts` → 应被拦截（禁止可执行脚本）
- 验收：六项均通过，截图留存

### T9. 收尾记录（依赖：T8）⚠️ 必做

- 更新 `docs/CHANGELOG.md`：记录本次清单规划及 v2.1 修订内容（4 处核心变更）
- 更新 `docs/PROGRESS.md`：标记本项目阶段完成状态
- 调用 `memory_log` 记录今日工作（规划完成，等 plan-reviewer 复审）
- 验收：CHANGELOG 有对应条目，PROGRESS 状态更新，memory_log 已写入

---

## 三、验收标准（量化）

| #   | 标准                                 | 验证方法                                                    |
| --- | ------------------------------------ | ----------------------------------------------------------- |
| 1   | 主 agent 写系统配置文件时被拦截      | 尝试写 `~/.dsh/settings.yaml` → 日志确认 deny               |
| 2   | 主 agent 写工作区 .md 文档被允许     | 尝试写 `docs/test.md` → 确认 write 工具正常执行             |
| 3   | 主 agent 写工作区非 .md 文件时被拦截 | 尝试写 `docs/config.yaml` → deny（类型限制）                |
| 4   | 主 agent 写记忆文件时被拦截          | 尝试写 `~/.dsh/memory/MEMORY.md` → deny                     |
| 5   | 主 agent 写 `.temp/` 临时文件被允许  | 尝试写 `.temp/test.txt` → allow                             |
| 6   | symlink 绕过被拦截                   | 创建指向禁区的 symlink 后尝试写 → deny，日志含 resolvedPath |
| 7   | 拦截消息包含具体原因                 | 日志含 `matchedRule` 字段，可读                             |
| 8   | 临时例外记录可生效                   | 手动添加 temporaryOverrides 后，对应文件可写                |
| 9   | 临时例外记录过期失效                 | 设置 expiresAt 为过去时间，对应文件应被拒绝                 |
| 10  | .temp/禁止可执行脚本                 | 尝试写 `.temp/test.ts` → deny                               |
| 11  | 清单变更可热重载                     | 编辑 YAML 后插件下次 pre-execute 即生效                     |
| 12  | CHANGELOG/PROGRESS 已更新            | 验收标准 #11 完成后立即执行 T9                              |

---

## 四、风险项

| 风险                                          | 等级 | 应对                                                            |
| --------------------------------------------- | ---- | --------------------------------------------------------------- |
| T1 白名单覆盖不全，遗漏重要路径               | 高   | T8 人工验收全覆盖；用户反馈后迭代补充                           |
| 路径解析问题（相对路径 vs 绝对路径）          | 中   | 统一在插件内用 `path.resolve(cwd, filePath)` 转绝对路径后再判定 |
| 符号链接绕过白名单                            | 中   | T3/T6 专项测试覆盖；`resolvePath()` 函数单测验证                |
| YAML 文件格式错误导致插件启动失败             | 低   | 加载失败时 fallback 到内建默认白名单（fail-close）              |
| 文件类型限制过于严格（用户需要写 .json 文档） | 中   | 可通过 dynamicWhitelist 或临时例外记录机制扩展                  |
| 临时例外记录过期后自动清理                    | 低   | 插件启动时过滤过期记录，或每小时清理一次                        |
| glob 模式匹配错误导致误拦截                   | 中   | T3 单元测试覆盖 glob→regex 转换；T6 场景12 验证临时例外过期清理 |

---

## 五、与现有系统的关系

| 组件                       | 关系                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `主agent职责边界.md`       | 本清单是其"文件权限越界"子项的具体化                                  |
| `AGENTS.md`                | 引用其临时文件规矩（`.temp/` 白名单来源）                             |
| `计划-guard-main-agent.md` | 本计划是其 D1 文件权限拦截的具体实现方案                              |
| `skill-router`             | 互补：skill-router 控制模型看到哪些 skill，本清单控制模型能写哪些文件 |
| `CHANGELOG.md`             | T9 收尾任务必须更新本文件                                             |
| `PROGRESS.md`              | T9 收尾任务必须更新本文件                                             |

---

_v2.1：响应 plan-reviewer 复审修正（H1-H4）：①删除3.1节黑名单式表格，改为说明段落 ②.temp/添加类型限制（.md/.txt/.log/.json） ③明确temporaryOverrides时序：用户手动编辑，主agent不自动生成 ④补充glob匹配算法说明（正则转换） ⑤验收标准增加临时例外过期失效和.temp禁止可执行脚本测试项。_  
_下一步：用户确认 → 进入 P2 实施。_
