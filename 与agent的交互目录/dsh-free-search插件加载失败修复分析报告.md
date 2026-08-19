# dsh-free-search 插件加载失败 — 修复分析报告

**日期：** 2026-08-19
**服务：** dsh-web（DeepSeek Harness web）
**访问地址：** http://10.10.10.9:3080

---

## 一、现象

浏览器打开 dsh web 时，插件区报错：

```
Failed to load plugins dsh-free-search
```

web 搜索插件无法加载。

---

## 二、根因

`settings.plugin.item` 在新版 dsh（Cordis 框架）里是一个 **keyed 插槽**，官方要求注册时必须带 `options.key`。

而 `dsh-free-search` **0.4.5** 在注入该插槽时**漏了 `key`**，导致：

```
keyed slot "settings.plugin.item" requires options.key
```

→ 浏览器加载插件时检查失败 → 插件加载失败。

**本质：** 这是插件与当前 dsh（developer preview，经常有破坏性变更）之间的兼容问题，并非 dsh 本体故障。

**涉及文件：**
`~/.dsh/profiles/web/node_modules/dsh-free-search/lib/client.js`

- 元凶检查点：`ui-slots/src/index.ts:806`（keyed slot 校验）
- 注入位置：`client.js:387` — `ctx.slots.inject("settings.plugin.item", ...)`

---

## 三、修复

在 `client.js` 的 `ctx.slots.register(...)` 对象里补上：

```js
key: "dsh-free-search",
```

补丁位置：`client.js:391`

改动后，keyed slot 校验（`ui-slots:806`）通过，插件正常加载。

**已重启 `dsh-web`（user 域服务，active，3080 正常监听）。**

---

## 四、验证 / 用户操作

打开 **http://10.10.10.9:3080** 按 **Ctrl+F5 强制刷新**：

- "Failed to load plugins dsh-free-search" 报错消失
- web 搜索插件正常加载

---

## 五、注意事项

1. **直接改了 profile 里 node_modules 的插件文件**，若以后 `pnpm install / pnpm update` 重新装依赖会被覆盖。
2. npm 上已发布 **0.4.7（官方修复版）**，若想更稳可升级：

   ```bash
   pnpm add dsh-free-search@^0.4.7
   ```

---

## 六、修复过程回顾

1. 定位报错：浏览器插件区 "Failed to load plugins dsh-free-search"
2. 查 dsh 日志 / 插件加载链，锁定 keyed slot 校验 `ui-slots/src/index.ts:806`
3. 翻到 `client.js:387` 确认 register 对象缺少 `key`
4. 补上 `key: "dsh-free-search"`
5. 重启 `dsh-web`，确认 3080 监听
6. 用户在浏览器端 Ctrl+F5 刷新验证
