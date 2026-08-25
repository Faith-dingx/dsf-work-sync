# 主 agent 可改写文件清单（白名单 + fail-close）

> **版本**：v2.1 · 2026-08-21  
> **修订要点**：响应 plan-reviewer 复审意见（H1-H4）：①删除3.1节黑名单式表格 ②.temp/添加类型限制 ③明确temporaryOverrides时序 ④补充glob匹配算法说明  
> **定位**：guard-main-agent 插件的文件权限越界拦截数据源，替代"主agent凭自觉管住手"  
> **判断原则**：**白名单之外一律拒绝（fail-close）**，无黑名单概念

---

## 一、设计原则

**一条硬规则**：主agent（便宜模型做编排中转）只可以碰工作区产出物（文档/日志/临时测试），绝不可以碰系统底座、代码、配置、记忆基础设施。

**三个判断维度**（按优先级从高到低）：

1. **白名单命中**：绝对路径（已resolve symlink）是否落在某个白名单条目里
2. **文件类型限制**：白名单路径下只允许特定后缀（如 `docs/` 仅 `*.md`）
3. **默认拒绝**：未命中任何白名单 → 拒绝（fail-close）

---

## 二、白名单（唯一权限来源）

### 2.1 工作区文档（核心白名单）

| 路径模式                                    | 允许的文件类型 | 说明                                                                        |
| ------------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| `/home/dingx/DSF-work/docs/`                | `*.md`         | 项目文档：CHANGELOG、PROGRESS、PROJECT、部署指南、对比分析、立项/计划文档等 |
| `/home/dingx/DSF-work/projects/*/docs/`     | `*.md`         | 项目文档：立项、计划、进展、方案、边界规范等                                |
| `/home/dingx/DSF-work/projects/*/README.md` | `README.md`    | 项目自述                                                                    |

> **严格限制**：`docs/` 下**仅限 `.md` 文件**。`.yaml`、`.json`、`.ts`、`.js` 等其他后缀一律拒绝。

### 2.2 临时文件区（类型受限放行）

| 路径模式                      | 允许的文件类型                 | 说明                                                |
| ----------------------------- | ------------------------------ | --------------------------------------------------- |
| `/home/dingx/DSF-work/.temp/` | `.md`, `.txt`, `.log`, `.json` | 临时文件固定区（AGENTS.md 约定），主agent可自由读写 |

**风险说明**：`.temp/` 虽为临时目录，但禁止在其中创建 `.ts`/`.js`/`.py` 等可执行脚本，防止主agent间接写入代码。

**规矩**（从 AGENTS.md 引用）：

- 测试/调试产生的临时文件**一律放 `.temp/`**，绝不写系统分区
- 测试结束**立刻整理**：有价值的归档到 `.temp/archive/`（带日期命名），无价值的立即删除
- 长期有价值的产出移入 `docs/` 等正式文档，不留 `.temp`
- **禁止在 `.temp/` 创建可执行脚本（.ts/.js/.py等）**

### 2.3 与 agent 交互目录（整目录放行）

| 路径模式                         | 允许的文件类型 | 说明                            |
| -------------------------------- | -------------- | ------------------------------- |
| `/home/dingx/与agent的交互目录/` | 任意           | 与 agent 交互产生的文档、报告等 |

> **注**：此目录不存在则跳过；若用户新建或重命名，需同步更新本清单。

---

## 三、非白名单即拒绝（fail-close）

### 3.1 非白名单即拒绝

**以下文件类型因未命中白名单而被拒绝**（仅作说明，非规则条目）：

- 代码文件（`.ts`/`.js`/`.py` 等）
- 配置文件（`.yaml`/`.json`/`.toml` 等）
- 记忆文件（`AGENTS.md`/`WORKSPACE.md`/`~/.dsh/memory/` 等）
- 系统配置与敏感路径（`~/.dsh/settings.yaml`/`~/.ssh/`/`/etc/` 等）
- 系统源码（`/home/dingx/deepseek-harness/`）
- 其他未列入白名单的路径

所有未命中白名单的写入操作均被拒绝（fail-close）。

### 3.2 判断伪代码

```typescript
/**
 * 判定主 agent 对目标路径是否有写权限
 * @param absolutePath - 要写入的文件的绝对路径（已 resolve symlink）
 * @returns {allowed: boolean, reason: string}
 */
function canMainAgentWrite(absolutePath: string): { allowed: boolean; reason: string } {
  // ① 白名单遍历 → 命中则放行
  for (const rule of WHITELIST_RULES) {
    if (matchPath(absolutePath, rule)) {
      // 检查文件类型限制
      if (rule.allowedExtensions && !rule.allowedExtensions.includes(getExtension(absolutePath))) {
        return {
          allowed: false,
          reason: `白名单路径 ${rule.path} 但文件类型 ${getExtension(absolutePath)} 不在允许列表 [${rule.allowedExtensions.join(', ')}]`,
        };
      }
      return { allowed: true, reason: `白名单: ${rule.reason}` };
    }
  }

  // ② 未命中白名单 → 拒绝
  return { allowed: false, reason: '未匹配白名单，默认拒绝' };
}
```

---

## 四、清单存放形式

### 4.1 YAML 配置文件

**路径**：`/home/dingx/DSF-work/docs/主agent可改写文件清单.yaml`

见同级 YAML 文件。

### 4.2 guard 插件配置接入

```yaml
# 在 full preset 的 cordis.yml 中，guard-main-agent 增加配置项：
- id: guard-main-agent
  name: '@dsf/guard-main-agent'
  config:
    filePolicyPath: 'docs/主agent可改写文件清单.yaml' # 新增：清单文件路径（相对于 cwd）
    # ... 其余配置不变
```

---

## 五、更新机制

### 5.1 谁有权修改清单

| 修改类型             | 谁有权                        | 触发方式                          |
| -------------------- | ----------------------------- | --------------------------------- |
| **白名单条目增删**   | 仅限用户                      | 用户主动要求                      |
| **文件类型限制调整** | 仅限用户                      | 用户主动要求                      |
| **插件读取清单**     | guard-main-agent 插件自动读取 | 每次 pre-execute 前加载（可缓存） |

### 5.2 扩容流程

```
用户："以后主agent也可以改 /home/dingx/foo/bar/"
  ↓
主 agent 拒绝自行修改清单（自身也在清单保护下）
  ↓
主 agent 提示用户：请直接在 docs/主agent可改写文件清单.yaml 的 whitelist 中添加条目
  ↓
用户自行编辑文件（或通过 GUI 面板操作）
  ↓
插件下次启动时重新加载清单（或热重载，取决于实现）
```

### 5.3 清单变更日志

每次修改清单，必须在 `docs/CHANGELOG.md` 中记录：

- 修改时间
- 修改内容（新增/删除/修改了哪条白名单条目）
- 修改原因（哪次用户授权）

---

## 六、边界情况处理

### 6.1 符号链接（symlink）解析策略

**风险**：主 agent 可通过创建符号链接指向禁区文件，绕过路径前缀检查。

- 示例攻击：`ln -s ~/.dsh/settings.yaml /home/dingx/DSF-work/.temp/link-to-settings.yaml`
- 若只检查显示路径，会命中白名单放行
- 实际写入的是禁区文件 `~/.dsh/settings.yaml`

**对策**：

1. **判定前必须 resolve symlink**：使用 `fs.realpathSync()` 将路径解析为物理路径后再判定
2. **白名单中也需 resolve**：如果白名单路径本身是 symlink，也应 resolve 后比对
3. **禁止创建指向禁区的 symlink**：即使 symlink 本身在白名单目录，其目标若在禁区，也拒绝创建

**实现伪代码**：

```typescript
async function resolvePath(rawPath: string): Promise<string> {
  try {
    return await fs.promises.realpath(rawPath);
  } catch {
    // 路径不存在时，对父目录做 resolve
    const parent = path.dirname(rawPath);
    try {
      const resolvedParent = await fs.promises.realpath(parent);
      return path.join(resolvedParent, path.basename(rawPath));
    } catch {
      return rawPath; // 无法 resolve 时返回原路径（fail-close）
    }
  }
}
```

### 6.2 不存在的路径（create 操作）

- 对 `write` 工具创建新文件：检查父目录是否在白名单内
- 例如：要写 `/home/dingx/DSF-work/docs/new-file.md`，检查父目录 `/home/dingx/DSF-work/docs/` 在白名单且 `*.md` 允许 → 放行
- 例如：要写 `/home/dingx/DSF-work/docs/new-file.yaml`，检查父目录在白名单但 `.yaml` 不在允许后缀 → 拒绝
- 例如：要写 `/home/dingx/.dsh/memory/new-entry.md`，检查父目录不在白名单 → 拒绝

### 6.3 用户直接要求编辑的例外机制

**场景**：用户明确说"帮我改一下 AGENTS.md"，但 AGENTS.md 不在白名单内。

**处理流程（时序）**：

```
用户请求编辑清单外文件
    ↓
主 agent 拦截，提示用户："该文件不在白名单内，如需编辑请手动编辑清单 YAML 的 temporaryOverrides 字段"
    ↓
用户手动编辑 docs/主agent可改写文件清单.yaml，在 temporaryOverrides 数组追加记录
    ↓
guard 插件下次启动时加载清单（或热重载），检查请求时的 expired 状态
    ↓
若记录未过期（expiresAt > now），放行该次写操作
    ↓
插件启动时自动清理过期记录（expiresAt < now）
```

**关键规则**：

- **临时例外由用户手动编辑清单 YAML 追加**，主 agent 不自动生成
- 用户消息快照由用户自行记录（主 agent 仅提示格式）
- 有效期建议 24 小时，到期自动失效
- guard 插件启动时过滤过期记录（简单字符串比较 `expiresAt < Date.now()`）

```yaml
# 临时例外记录（用户明确要求编辑清单外文件时）
temporaryOverrides:
  - filePath: '/home/dingx/DSF-work/AGENTS.md'
    userMessage: '帮我改一下AGENTS.md'
    timestamp: '2026-08-21T18:00:00Z'
    expiresAt: '2026-08-22T18:00:00Z'
    by: 'user-direct-request'
```

---

## 七、与 guard 插件的集成点

### 7.1 拦截时机

在 guard 插件的 `tools/pre-execute` 事件中，对每个写操作（`write` / `edit` / `str_replace`）：

1. 从 `arguments.file_path` 提取目标路径
2. **resolve symlink**：调 `resolvePath(path)` 获取物理路径
3. 调 `canMainAgentWrite(resolvedPath)` 判定
4. 返回 `{verdict: 'block'|'allow', reason: string}` 给策略引擎
5. 若 block，注入系统消息说明拦截原因，并派发 code-agent

### 7.2 日志格式

每次拦截记录结构化日志：

```json
{
  "event": "file_access_denied",
  "tool": "write",
  "originalPath": "/home/dingx/DSF-work/.temp/link-to-settings.yaml",
  "resolvedPath": "/home/dingx/.dsh/settings.yaml",
  "agent": "main-agent",
  "matchedRule": "未命中白名单",
  "timestamp": "2026-08-21T..."
}
```

### 7.3 误判处理

若主 agent 被误拦截（白名单缺少某合法路径）：

1. 日志记录拦截事件
2. 主 agent 向用户报告："我尝试写 xxx 被拦截，原因：未匹配白名单。如需放行，请在清单中追加白名单条目"
3. 用户确认后更新清单（不经过主 agent 自行修改）

---

## 八、清单扩展性设计

### 8.0 实现说明：glob 路径模式匹配

对于 `projects/*/docs/` 这类 glob 模式，通过正则表达式实现匹配：

```typescript
// 示例：projects/*/docs/ 转换为正则
// glob: /home/dingx/DSF-work/projects/*/docs/
// regex: ^/home/dingx/DSF-work/projects/[^/]+/docs/
const globToRegex = (globPath: string): RegExp => {
  // 转义特殊字符，* 替换为 [^/]+（匹配任意非斜杠字符）
  const escaped = globPath.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/\\\*/g, '[^/]+'));
};
```

**匹配算法**：

1. 将 YAML 中的 glob 模式（`value` 字段含 `*`）转换为正则
2. 对目标路径调用 `regex.test(resolvedPath)`
3. 前缀匹配（`type: prefix`）直接判断路径前缀
4. 精确匹配（`type: exact`）使用字符串全等

### 8.1 未来可能的扩展方向

| 扩展方向         | 预估需求                            | 当前状态                                 |
| ---------------- | ----------------------------------- | ---------------------------------------- |
| 多工作区支持     | 用户有多个 DSH 工作区，各自有白名单 | 待实现（清单路径改为 per-workspace）     |
| 文件类型通配符   | 支持 `docs/*.md`、`docs/*.txt` 等   | 已支持（YAML 中 allowedExtensions 字段） |
| 路径通配符       | 支持 glob 模式匹配                  | 可用正则实现，见上文实现说明             |
| 时间窗口限制     | 某些时段允许、某些时段禁止          | 暂未需要                                 |
| 只读区中间态     | 允许读但不允许写                    | 规划中，暂不实现                         |
| symlink 目标追踪 | 递归解析多级 symlink                | 已实现单层 resolve，多级可后续扩展       |

### 8.2 版本管理

- 清单文件版本号：YAML 头部 `# v2.1`
- 大版本变更（结构变化）：同步更新 guard 插件代码
- 小版本变更（仅规则增删）：只需更新 YAML，插件自动热重载

---

## 九、总结：一句话规则

> **主 agent 只能写 `docs/` 下的 `.md` 文件（日志/流程文档/更新文档）、`.temp/` 临时区（仅 .md/.txt/.log/.json）、以及 `与agent的交互目录/`。其他一律拒绝。**
>
> 所有细节以上述清单为准，清单未覆盖的默认为禁区（fail-close）。

---

_v2.1：响应 plan-reviewer 复审修正（H1-H4）：①删除3.1节黑名单式表格，改为说明段落 ②.temp/添加类型限制（.md/.txt/.log/.json），禁止可执行脚本 ③明确temporaryOverrides时序：用户手动编辑，主agent不自动生成 ④补充glob匹配算法说明（正则转换）。_  
_v2.0：响应主agent修正1-3重写。核心变更：①删除黑名单概念，仅保留白名单 ②主agent坚决不碰代码/配置/记忆 ③docs/下仅限_.md ④新增用户直接要求编辑的临时放行记录机制。*  
_v1.1：原黑名单+白名单双轨制，已废弃。_
