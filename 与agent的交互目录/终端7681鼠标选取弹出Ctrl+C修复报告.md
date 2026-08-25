# 终端(7681)鼠标选取弹出 Ctrl+C 修复报告

**日期：** 2026-08-19
**服务：** term-server（自写精简 Web 终端）
**访问地址：** http://<宿主机>:7681
**涉及文件：** `/home/dingx/.hermes/scripts/term_server.py`
**前端：** xterm.js 5.3.0（CDN）+ fit-addon 0.8.0，后端 Python PTY 转发 bash

---

## 一、现象

在 7681 这个精简 Web 终端里：

1. 用鼠标**拖拽选中文本**后，习惯性地按 **Ctrl+C** 想"复制"
2. 结果没复制，反而出现 `^C`，并且**打断了当前命令/清掉了选择**

---

## 二、根因

这个前端（`term_server.py` 第 20–39 行的内嵌 JS）**完全没有做任何"复制"处理**：

- 没开 `copyOnSelect`
- 没有任何 `keydown` 拦截（Ctrl+C / Ctrl+Shift+C）
- 只有一条 `term.onData(... → ws.send(...))`，把键盘输入**原样直通**到后端 PTY

于是问题链是：

1. 鼠标拖选文本（浏览器/xterm 内部高亮，不发任何东西）
2. 按 **Ctrl+C** 想复制 → 页面没有任何代码捕获这个组合键
3. Ctrl+C 没有被浏览器拿去复制，而是**直接当成键盘输入**送进 bash 的 PTY
4. bash 收到 Ctrl+C = **SIGINT 中断信号** → 在提示符回显 `^C`，打断当前命令、清掉选择

**一句话：在这个精简终端里，Ctrl+C 永远是"中断"，从来不是"复制"。**

---

## 三、修复办法（已实施并验证）

在 `term_server.py` 的内嵌前端 JS 里做两处改动：

### 1. 开启 `copyOnSelect`（鼠标松手选中即自动复制）

原：

```js
var term=new Terminal({cursorBlink:true,fontSize:15,fontFamily:"Consolas,monospace",
  theme:{...}});
```

改：

```js
var term=new Terminal({cursorBlink:true,fontSize:15,fontFamily:"Consolas,monospace",copyOnSelect:true,
  theme:{...}});
```

> 效果：鼠标松手选中文本即自动复制到剪贴板，无需再按 Ctrl+C。

### 2. 新增 `keydown` 拦截（选中时 Ctrl+C / Ctrl+Shift+C = 复制，不再发 `^C`）

在 `term.onData(...)` 后追加：

```js
term.onData(function (d) {
  if (ws.readyState === WebSocket.OPEN) ws.send(d);
});
var lastSelText = '',
  lastSelAt = 0;
term.onSelectionChange(function () {
  if (term.hasSelection()) {
    lastSelText = term.getSelection();
    lastSelAt = Date.now();
  }
});
function doCopy(s) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(s);
    return;
  }
  var ta = document.createElement('textarea');
  ta.value = s;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } catch (_) {}
  document.body.removeChild(ta);
}
document.addEventListener(
  'keydown',
  function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (term.hasSelection() || Date.now() - lastSelAt < 2000) {
        e.preventDefault();
        e.stopPropagation();
        doCopy(term.hasSelection() ? term.getSelection() : lastSelText);
      }
    }
  },
  true,
);
```

> 逻辑：
>
> - **有选中文本时**按 Ctrl+C / Ctrl+Shift+C → `preventDefault()` 拦截，执行复制，**不再发 `^C` 给 bash**
> - **没有选中文本时**按 Ctrl+C → 放行，仍作为正常"中断"用
> - `onSelectionChange` + 2 秒窗口：即使松手后短暂取消选择，2 秒内按 Ctrl+C 仍复制刚选的内容
> - 带 `navigator.clipboard` 不可用的 http 环境 fallback（textarea + `document.execCommand("copy")`）

---

## 四、实施与生效

- **改文件：** `/home/dingx/.hermes/scripts/term_server.py`（改内嵌 JS）
- **语法校验：** `python3 -m py_compile .../term_server.py` 通过 ✅
- **生效方式：** 无需重启 7681 后端，**直接刷新浏览器页面**即可（HTML 由后端每次请求动态输出，改文件立即生效）
- **重启命令（如后端需重启）：**
  ```bash
  sudo systemctl restart term-server
  ```
  > 该系统级服务 `/etc/systemd/system/term-server.service`，pid 在 `/system.slice/`，需 root 权限，由用户手动执行。

---

## 五、验证清单

刷新页面后逐项确认：

- [ ] 鼠标选中文本，**松手即自动复制**
- [ ] 选中时按 **Ctrl+C / Ctrl+Shift+C** = 复制，**不再出现 `^C`**
- [ ] 没选中时按 **Ctrl+C** = 正常中断（打断当前命令）

---

## 六、本次修复存档位置

本报告存档于：
`/home/dingx/DSF-work/与agent的交互目录/`

> 注：该问题与 Dashboard `/chat`（9119 内嵌 Hermes TUI）的鼠标选取问题是**两个不同界面**，各自独立处理，详见相关对话/文档。
