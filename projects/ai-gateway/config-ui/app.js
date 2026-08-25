'use strict';
/* AI 网关配置界面 — 原生 JS 单页（零框架零构建）
 * 视图：登录（含首启 token 展示）→ T4 首启向导 ↔ 主视图（Provider/子代理/密钥/状态）
 */
(() => {
  const TOKEN_KEY = 'configUiToken';
  // 思考级别全集（D 项：不再对所有模型硬编码 off/low/high/max，改按模型支持的级别联动）
  const FULL_EFFORT_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || null,
    bootToken: null, // 本次首启从 /api/boot 拿到的明文 token（仅展示一次）
    bootInitialized: null,
    tab: 'providers',
    providers: {}, // id -> provider 对象（完整保留，编辑合并）
    providerKeys: [],
    keyItems: [], // 密钥行数据缓存（name → {masked, configured}，供「修改」显示掩码参考）
    subagentFields: {}, // 子代理 id -> 标注字段数组（保存时选可编辑路径）
    modelCatalog: [], // [{provider, model}] 聚合模型下拉（GET /api/models）
    providerOptions: [], // [{provider, displayName, source}] 厂商目录（settings 优先、标注自定义配置）
    modelsByProvider: {}, // provider -> [模型id...]（settings.models ∪ 内置，去重保序；厂商↔模型联动）
    modelEfforts: {}, // provider -> {modelId: [思考级别...] | null}（后端 /api/models 的 modelEfforts）
    editingProviderId: null, // null = 新增
    wizard: { step: 1, gateway: '', pname: '', env: '', key: '', envTouched: false },
  };

  const $ = (id) => document.getElementById(id);

  /* ───────────── 小工具 ───────────── */

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );

  let toastTimer = null;
  function toast(msg, kind = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  function setMsg(el, text, kind) {
    el.textContent = text || '';
    el.className = `msg ${kind || ''}`;
  }

  /* ───────────── 系统告警横幅 ───────────── */

  function showBanner(msg) {
    const banner = $('alert-banner');
    if (!banner) return;
    $('alert-banner-msg').textContent = msg;
    banner.classList.remove('hidden');
  }

  function hideBanner() {
    const banner = $('alert-banner');
    if (banner) banner.classList.add('hidden');
  }

  // 依据 /api/status 的 dsh 探针结果刷新横幅（未运行 → 查询启动错误详情，无则显示通用告警）
  async function syncBanner(st) {
    if (st && st.running === false) {
      try {
        const errResp = await api('/api/boot-error');
        if (errResp && errResp.hasError) {
          showBanner(`⚠️ ${esc(errResp.error)}`);
        } else {
          showBanner(`dsh 主服务（端口 ${st.dshPort}）未运行`);
        }
      } catch {
        showBanner(`dsh 主服务（端口 ${st.dshPort}）未运行`);
      }
    } else {
      hideBanner();
    }
  }

  /* ───────────── API 封装 ───────────── */

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error('无法连接配置服务（请确认 server.js 已启动）');
    }
    // 401：令牌失效 → 回到登录
    if (res.status === 401 && !path.startsWith('/api/boot') && !path.startsWith('/api/status')) {
      logout();
      throw new Error('登录已失效，请重新登录');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 非 JSON 响应 */
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `请求失败 HTTP ${res.status}`);
    }
    return data;
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
    state.token = null;
    state.bootToken = null;
    hideMainView();
    showLoginView();
  }

  /* ───────────── 视图切换 ───────────── */

  function hideMainView() {
    $('view-main').classList.add('hidden');
    $('wizard').classList.add('hidden');
  }

  function showLoginView() {
    $('view-login').classList.remove('hidden');
    $('login-token').value = '';
    $('login-msg').textContent = '';
    bootCheck();
  }

  function showMainView() {
    $('view-login').classList.add('hidden');
    $('wizard').classList.add('hidden');
    $('view-main').classList.remove('hidden');
    switchTab(state.tab);
  }

  /* ───────────── 初始化：boot 检测 → 登录/向导/主视图 ───────────── */

  async function bootCheck() {
    const firstBootPanel = $('first-boot-panel');
    const loginForm = $('login-form');
    try {
      const boot = await api('/api/boot');
      if (boot && boot.initialized === false && boot.token) {
        // 首启：明文 token 仅在本次展示一次
        state.bootToken = boot.token;
        state.bootInitialized = false;
        if (!state.token) {
          // token 直接用于向导的鉴权请求；同时展示给用户复制保存
          state.token = boot.token;
          sessionStorage.setItem(TOKEN_KEY, boot.token);
          loginForm.classList.add('hidden');
          firstBootPanel.classList.remove('hidden');
          $('boot-token').textContent = boot.token;
        }
      } else {
        state.bootInitialized = true;
        if (!state.token) {
          loginForm.classList.remove('hidden');
          firstBootPanel.classList.add('hidden');
        }
      }
    } catch (err) {
      setMsg($('login-msg'), err.message, 'err');
      loginForm.classList.remove('hidden');
    }
  }

  /* ───────────── T4 首启向导 ───────────── */

  function openWizard() {
    state.wizard = {
      step: 1,
      gateway: 'http://127.0.0.1:9888',
      pname: '',
      env: '',
      key: '',
      envTouched: false,
    };
    $('wizard').classList.remove('hidden');
    $('wz-gateway').value = state.wizard.gateway;
    $('wz-provider-name').value = '';
    $('wz-env').value = '';
    $('wz-key').value = '';
    $('wz-check-result').textContent = '';
    $('wz-finish').classList.add('hidden');
    $('wz-run-check').disabled = false;
    $('wz-summary').textContent = '';
    wizardStep(1);
  }

  function wizardStep(n) {
    state.wizard.step = n;
    document.querySelectorAll('.wizard-step').forEach((el) => {
      el.classList.toggle('hidden', Number(el.dataset.step) !== n);
    });
    $('wz-progress').textContent = `${n} / 3`;
  }

  function wizardNext(from) {
    if (from === 1) {
      const g = $('wz-gateway').value.trim();
      if (!g) {
        toast('请填写网关地址', 'err');
        return;
      }
      if (!/^https?:\/\//.test(g)) {
        toast('网关地址需以 http:// 或 https:// 开头', 'err');
        return;
      }
      state.wizard.gateway = g;
    } else if (from === 2) {
      state.wizard.pname = $('wz-provider-name').value.trim();
      state.wizard.key = $('wz-key').value;
      if (!state.wizard.pname) {
        toast('请填写模型服务名称', 'err');
        return;
      }
      if (!$('wz-key').value) {
        toast('请填写 API 密钥', 'err');
        return;
      }
      if (!state.wizard.envTouched) {
        state.wizard.env =
          state.wizard.pname.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_API_KEY';
      }
      // 汇总预览（key 只显示掩码）
      const pv = maskPreview(state.wizard.key);
      $('wz-summary').innerHTML =
        `网关地址：<code>${esc(state.wizard.gateway)}</code><br>` +
        `服务方：<b>${esc(state.wizard.pname)}</b><br>` +
        `环境变量：<code>${esc(state.wizard.env)}</code><br>` +
        `API 密钥：<code>${esc(pv)}</code>（仅显示掩码）`;
    }
    wizardStep(from + 1);
  }

  function maskPreview(value) {
    const s = String(value);
    if (s.startsWith('sk-')) return `sk-****${s.length > 4 ? s.slice(-4) : ''}`;
    return `****${s.length > 4 ? s.slice(-4) : ''}`;
  }

  async function wizardRunCheck() {
    const resEl = $('wz-check-result');
    const btn = $('wz-run-check');
    btn.disabled = true;
    setMsg(resEl, '正在写入密钥并检测状态…');
    const steps = [];
    try {
      await api('/api/keys', {
        method: 'POST',
        body: { name: state.wizard.env, value: state.wizard.key },
      });
      // 立即清空输入框中的明文，防留在 DOM
      $('wz-key').value = '';
      state.wizard.key = '';
      steps.push(`✅ 密钥 ${esc(state.wizard.env)} 已写入（掩码 ${esc(maskPreview(''))}…）`);
      const st = await api('/api/status');
      steps.push(
        `✅ 状态检测完成：dsh 端口 ${esc(st.dshPort)} ${st.running ? '运行中' : '未运行（不影响配置）'}` +
          `｜配置目录 ${esc(basename(st.configDir))}`,
      );
      const masked = await api('/api/keys');
      const entry = (masked && Array.isArray(masked.keys) ? masked.keys : []).find(
        (k) => k.name === state.wizard.env,
      );
      const maskShown = entry ? entry.masked : '****';
      resEl.innerHTML = `<div class="msg ok">全部完成 ✓</div><div class="msg">密钥回读（掩码）：<code>${esc(state.wizard.env)} = ${esc(maskShown)}</code></div>`;
      $('wz-finish').classList.remove('hidden');
    } catch (err) {
      setMsg(resEl, '检测失败：' + err.message, 'err');
      $('wz-run-check').disabled = false;
    }
    void steps;
  }

  /* ───────────── 主视图：标签页 ───────────── */

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.classList.toggle('hidden', p.id !== `pane-${tab}`);
    });
    if (tab === 'providers') loadProviders();
    else if (tab === 'subagents') loadSubagents();
    else if (tab === 'keys') loadKeys();
    else if (tab === 'status') loadStatus();
    else if (tab === 'rollback') loadRollback();
  }

  /* ───────────── ① Provider 管理 ───────────── */

  async function loadProviders() {
    const listEl = $('provider-list');
    listEl.innerHTML = '<div class="item-empty">加载中…</div>';
    try {
      const data = await api('/api/providers');
      state.providers = data.providers && typeof data.providers === 'object' ? data.providers : {};
      state.providerKeys = Object.keys(state.providers).sort();
      renderProviders();
    } catch (err) {
      listEl.innerHTML = `<div class="item-empty">${esc(err.message)}</div>`;
    }
  }

  function renderProviders() {
    const listEl = $('provider-list');
    if (!state.providerKeys.length) {
      listEl.innerHTML =
        '<div class="item-empty">暂无模型服务。点击右上「新增模型服务」开始配置。</div>';
      return;
    }
    listEl.innerHTML = state.providerKeys
      .map((id) => {
        const p = state.providers[id] || {};
        const models = Array.isArray(p.models) ? p.models : [];
        return `<div class="item-card">
          <div class="item-head">
            <span class="item-id">${esc(id)}</span>
            ${esc(p.displayName) ? `<span class="item-badge">${esc(p.displayName)}</span>` : ''}
            <span class="item-badge tag-accent">${esc(p.api || '开放接口')}</span>
            <span class="item-badge">${models.length} 个模型</span>
          </div>
          <div class="item-meta">
            端点：<code>${esc(p.baseURL || '—')}</code><br>
            密钥环境变量：<code>${esc(p.apiKeyEnv || '—')}</code><br>
            模型：<code>${esc(models.map((m) => (m && m.id) || m).join(' ')) || '—'}</code>
          </div>
          <div class="item-actions">
            <button type="button" class="sm" data-act="edit" data-id="${esc(id)}">编辑</button>
            <button type="button" class="sm" data-act="del" data-id="${esc(id)}">删除</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function openProviderForm(id) {
    state.editingProviderId = id || null;
    $('provider-form-wrap').classList.remove('hidden');
    $('provider-form-title').textContent = id ? `编辑模型服务：${id}` : '新增模型服务';
    const p = id ? state.providers[id] || {} : {};
    const models = Array.isArray(p.models) ? p.models : [];
    $('pf-id').value = id || '';
    $('pf-display').value = p.displayName || '';
    $('pf-endpoint').value = p.baseURL || '';
    $('pf-api').value = p.api || 'openai-completions';
    $('pf-env').value = p.apiKeyEnv || '';
    $('pf-models').value = models.map((m) => (m && m.id) || m).join('\n');
    $('pf-submit').textContent = id ? '保存修改' : '保存';
    // 与密钥「修改」行为一致：滚动到表单，让用户看到已预填的各参数
    const formWrap = $('provider-form-wrap');
    if (formWrap) formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 聚焦首个常填字段（编辑时聚焦显示名，新增时聚焦唯一 ID，preventScroll 不干扰上述平滑滚动）
    const focusEl = id ? $('pf-display') : $('pf-id');
    if (focusEl) focusEl.focus({ preventScroll: true });
  }

  function closeProviderForm() {
    $('provider-form-wrap').classList.add('hidden');
    state.editingProviderId = null;
  }

  /** 把模型文本行 → 数组；命中原对象则复用（保留 name 等额外键）。 */
  function modelsFromText(text) {
    const orig = state.editingProviderId ? state.providers[state.editingProviderId] : null;
    const origModels = !orig || !Array.isArray(orig.models) ? [] : orig.models;
    const byId = {};
    origModels.forEach((m) => {
      if (m && typeof m === 'object' && m.id) byId[m.id] = m;
      else if (typeof m === 'string') byId[m] = null;
    });
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((id) => {
        const o = byId[id];
        return o && typeof o === 'object' ? { ...o, id } : { id };
      });
  }

  async function submitProviderForm(ev) {
    ev.preventDefault();
    const id = $('pf-id').value.trim();
    const displayName = $('pf-display').value.trim();
    const baseURL = $('pf-endpoint').value.trim();
    const apiStyle = $('pf-api').value;
    const apiKeyEnv = $('pf-env').value.trim();
    if (!id) {
      toast('请填写模型服务名称（唯一 ID）', 'err');
      return;
    }
    if (!baseURL) {
      toast('请填写接口地址（baseURL）', 'err');
      return;
    }

    const models = modelsFromText($('pf-models').value);
    const next = { ...state.providers };
    const oldId = state.editingProviderId;
    if (oldId && oldId !== id && Object.prototype.hasOwnProperty.call(next, id)) {
      toast(`模型服务「${id}」已存在，请换一个名称`, 'err');
      return;
    }
    // 以原对象为基底合并，保留未知字段（如 displayName/api/apiKeyEnv/baseURL/models 之外的自定义键）
    const base = oldId ? { ...next[oldId] } : {};
    const merged = {
      ...base,
      displayName,
      apiKeyEnv,
      api: apiStyle,
      baseURL,
      models,
    };
    if (oldId && oldId !== id) delete next[oldId]; // 重命名
    next[id] = merged;

    try {
      await api('/api/providers', { method: 'PUT', body: { providers: next } });
      toast(oldId ? `模型服务「${id}」已更新` : `模型服务「${id}」已新增`, 'ok');
      closeProviderForm();
      await loadProviders();
    } catch (err) {
      toast('保存失败：' + err.message, 'err');
    }
  }

  async function deleteProvider(id) {
    if (!window.confirm(`确认删除模型服务「${id}」？此操作会从 settings.yaml 移除该段。`)) return;
    const next = { ...state.providers };
    delete next[id];
    try {
      await api('/api/providers', { method: 'PUT', body: { providers: next } });
      toast(`模型服务「${id}」已删除`, 'ok');
      await loadProviders();
    } catch (err) {
      toast('删除失败：' + err.message, 'err');
    }
  }

  /* ───────────── ② 子代理管理 ───────────── */

  async function loadSubagents() {
    const listEl = $('subagent-list');
    listEl.innerHTML = '<div class="item-empty">加载中…</div>';
    try {
      const data = await api('/api/subagents');
      const list = Array.isArray(data.subagents) ? data.subagents : [];
      // 缓存各子代理字段（供保存时选择可编辑路径）
      state.subagentFields = {};
      list.forEach((sa) => {
        state.subagentFields[sa.id] = sa.fields || [];
      });
      await loadModelCatalog(); // 下拉与来源说明统一用后端聚合目录
      renderSubagents(list);
    } catch (err) {
      listEl.innerHTML = `<div class="item-empty">${esc(err.message)}</div>`;
    }
  }

  /** 汇总所有可选的模型 id（直接用后端 /api/models 聚合结果，不再手工叠加 state.providers 避免重复）。 */
  function collectModelOptions() {
    const set = new Set();
    state.modelCatalog.forEach((m) => {
      if (m && m.model) set.add(m.model);
    });
    return [...set].filter(Boolean).sort();
  }

  /** 模型目录来源说明（添加弹窗 + 子代理编辑区下方），catalog 不可用时显示降级文案。 */
  function renderCatalogHints(data) {
    const hint = $('model-catalog-hint');
    const subHint = $('subagent-catalog-hint');
    if (!hint && !subHint) return;
    const text =
      data && data.catalogLoaded
        ? `模型目录：原厂内置 ${data.builtinCount} 个模型 + 本机 settings 自定义 ${data.settingsCount} 个 provider 模型（可手输任意模型 ID）`
        : '原厂目录不可用，仅显示本机已配置模型';
    if (hint) hint.textContent = text;
    if (subHint) subHint.textContent = text;
  }

  /** 把 /api/models 返回的 providers/modelsByProvider 分组存入 state。
   *  后端缺失该字段时自 state.modelCatalog 兜底聚合：按 provider 分组、settings 源优先。 */
  function applyCatalogGroups(data) {
    if (data && Array.isArray(data.providers)) {
      state.providerOptions = data.providers;
    } else {
      const order = [];
      const srcMap = {};
      state.modelCatalog.forEach((m) => {
        if (!m || !m.provider) return;
        if (!(m.provider in srcMap)) {
          srcMap[m.provider] = m.source || 'builtin';
          order.push(m.provider);
        } else if (m.source === 'settings' && srcMap[m.provider] !== 'settings') {
          srcMap[m.provider] = 'settings';
        }
      });
      state.providerOptions = order.map((p) => ({
        provider: p,
        displayName: p,
        source: srcMap[p],
      }));
    }
    if (data && data.modelsByProvider && typeof data.modelsByProvider === 'object') {
      state.modelsByProvider = data.modelsByProvider;
    } else {
      const mbp = {};
      state.modelCatalog.forEach((m) => {
        if (!m || !m.provider || !m.model) return;
        if (!mbp[m.provider]) mbp[m.provider] = [];
        if (!mbp[m.provider].includes(m.model)) mbp[m.provider].push(m.model);
      });
      state.modelsByProvider = mbp;
    }
    // 后端缺失 modelEfforts 时兜底空对象（前端按"全部模型未声明"→全集+提示处理）
    state.modelEfforts =
      data && data.modelEfforts && typeof data.modelEfforts === 'object' ? data.modelEfforts : {};
  }

  /** provider select 的 option 串：settings 自定义配置在前（后端已排好序），选中项加 selected；
   *  label 末尾附模型数量（B 项）：显示名（id）· 自定义配置（N 模型） / · 原厂内置（N 模型）。 */
  function providerOptionsHtml(selected) {
    const sel = String(selected ?? '');
    return state.providerOptions
      .map((p) => {
        const count = (state.modelsByProvider[p.provider] || []).length;
        const label =
          `${p.displayName || p.provider}（${p.provider}） · ` +
          (p.source === 'settings' ? '自定义配置' : '原厂内置') +
          `（${count} 模型）`;
        return `<option value="${esc(p.provider)}"${p.provider === sel ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('');
  }

  /** 指定 provider 的模型 id 列表（去重保序 + 字典序排序；未收录返回空数组，手输不受影响）。 */
  function modelsForProvider(provider) {
    const list = (provider && state.modelsByProvider[provider]) || [];
    return [...list].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
  }

  /** 把某 provider 的模型候选渲染进指定的 datalist 元素。 */
  function renderProviderDatalist(dlEl, provider) {
    if (!dlEl) return;
    dlEl.innerHTML = modelsForProvider(provider)
      .map((m) => `<option value="${esc(m)}">`)
      .join('');
  }

  /* ───────────── 思考强度联动（D 项）──────────────── */

  /** 某 provider+model 的声明思考级别数组；null/缺失 = 未声明（前端给默认全集+提示）。 */
  function effortLevelsFor(provider, model) {
    if (!provider || !model) return null;
    const byModel = state.modelEfforts[provider];
    if (!byModel || typeof byModel !== 'object') return null;
    const lv = byModel[model];
    return Array.isArray(lv) ? lv : null;
  }

  /** effort select 的 option 串（按模型能力联动）：
   *  - 声明了级别 → 只渲染支持级；current/默认值在其中则选中，否则 '-' 占位（避免误选首项）
   *  - 未声明（null）→ 默认 7 级全集 + 灰色提示项"该模型未声明思考级别（存疑，保存后可能报不支持）"
   *  - '-' 空选项仅当无有效当前值/默认值时出现，保持既有"无 effort"语义（保存时跳过） */
  function effortSelectOptions(provider, model, { current, defaultLevel } = {}) {
    const cur = current === null || current === undefined ? '' : String(current);
    const pref = cur !== '' ? cur : defaultLevel;
    const levels = effortLevelsFor(provider, model);
    const declared = Array.isArray(levels) && levels.length > 0;
    const list = declared ? levels : FULL_EFFORT_LEVELS;
    let chosen = '';
    if (pref !== undefined && pref !== null && pref !== '' && list.includes(String(pref)))
      chosen = String(pref);
    const withSel = list
      .map((l) => `<option value="${l}"${l === chosen ? ' selected' : ''}>${l}</option>`)
      .join('');
    const hint = declared
      ? ''
      : '<option value="" disabled>该模型未声明思考级别（存疑，保存后可能报不支持）</option>';
    const placeholder = chosen === '' ? '<option value="-" selected>-</option>' : '';
    return hint + placeholder + withSel;
  }

  /** 添加弹窗默认 effort：声明列表里有 low → low；否则列表首项；未声明 → low（全集默认，兼容既有行为）。 */
  function defaultEffortFor(provider, model) {
    const levels = effortLevelsFor(provider, model);
    if (Array.isArray(levels) && levels.length) return levels.includes('low') ? 'low' : levels[0];
    return 'low';
  }

  /** 重建某卡片 .sub-effort（provider+model 变化时；选中当前值若支持，否则 '-' 空占位）。 */
  function rebuildCardEffort(card, model) {
    if (!card) return;
    const effortSel = card.querySelector('.sub-effort');
    const provSel = card.querySelector('.sub-provider');
    if (!effortSel) return;
    const provider = provSel ? provSel.value : '';
    const current = effortSel.value && effortSel.value !== '-' ? effortSel.value : '';
    effortSel.innerHTML = effortSelectOptions(provider, model, { current });
  }

  /** 添加弹窗：#add-effort 按 #add-provider + #add-model 联动重建（默认 low/列表首项）。 */
  function renderAddEffort(provider, model) {
    const el = $('add-effort');
    if (!el) return;
    const def = defaultEffortFor(provider, model);
    el.innerHTML = effortSelectOptions(provider, model, { current: def });
  }

  /** 加载 /api/models 聚合列表（原厂内置 + settings 自定义），填充模型下拉与来源说明。 */
  async function loadModelCatalog() {
    let data = null;
    try {
      data = await api('/api/models');
      state.modelCatalog = Array.isArray(data.models) ? data.models : [];
    } catch {
      state.modelCatalog = [];
    }
    applyCatalogGroups(data);
    const dl = $('dl-add-models');
    if (dl) {
      dl.innerHTML = collectModelOptions()
        .map((m) => `<option value="${esc(m)}">`)
        .join('');
    }
    renderCatalogHints(data);
  }

  /** 把后端字段路径（可能带 [n] 列表下标 / config 前缀）归一化为可编辑字段名。
   *  例：[19].config.agentOptions.model → agentOptions.model；[3].reasoningEffort → reasoningEffort。 */
  function normalizeFieldPath(rawPath) {
    const segs = String(rawPath || '')
      .split('.')
      .filter((s) => !/^\[\d+\]$/.test(s));
    if (segs[0] === 'config') segs.shift();
    return segs.join('.');
  }

  /** 选择子代理的可编辑字段路径：model 优先 agentOptions.model，effort 优先 reasoningEffort。 */
  function pickEditPaths(fields) {
    const list = Array.isArray(fields) ? fields : [];
    const map = {}; // 归一化后的字段名 -> 原始字段对象（首个命中）
    list.forEach((f) => {
      const key = normalizeFieldPath(f.path);
      if (!(key in map)) map[key] = f;
    });
    const modelHit = map['agentOptions.model'] || map['model'] || null;
    const modelPath = modelHit ? normalizeFieldPath(modelHit.path) : null;
    const modelValue = modelHit ? modelHit.value : null;
    const effortHit = map['reasoningEffort'] || map['effort'] || map['reasoning'] || null;
    const effortPath = effortHit ? normalizeFieldPath(effortHit.path) : null;
    const effortValue = effortHit ? effortHit.value : null;
    return { modelPath, modelValue, effortPath, effortValue };
  }

  function renderSubagents(list) {
    const listEl = $('subagent-list');
    if (!list.length) {
      listEl.innerHTML =
        '<div class="item-empty">未发现子代理（扫描 ' +
        (state.presetsDir ? esc(state.presetsDir.split('/').pop()) : '预设目录') +
        ' 目录下含 agent.cordis.yml 的 preset）。</div>';
      return;
    }
    listEl.innerHTML = list
      .map((sa) => {
        const { modelValue, effortValue } = pickEditPaths(sa.fields);
        // 编辑走挂载层：仅当 full/agent.cordis.yml 存在 tool-subagent-<id> 挂载块时可保存
        const mount = sa.mountModel || null;
        const editable = Boolean(mount && mount.model);
        const srcBadge =
          sa.modelSource === 'mount'
            ? '<span class="item-badge tag-ok">mount 挂载层</span>'
            : sa.modelSource === 'preset'
              ? '<span class="item-badge tag-accent">preset 标注</span>'
              : sa.modelSource === 'default'
                ? '<span class="item-badge">default（继承默认）</span>'
                : '';
        const eff = sa.effectiveModel || {};
        const effDesc = eff.model
          ? `<code>${esc(eff.provider || '')} / ${esc(eff.model)}</code>（${esc(eff.source || '文件标注')}）`
          : '<code>未配置</code>';
        const mVal = (mount && mount.model) || modelValue || '';
        // Provider 下拉初值：挂载 provider → 生效模型 provider → 第一个 settings 自定义 provider（无则内置首项）
        const mountProvider =
          (mount && mount.provider) ||
          eff.provider ||
          (
            state.providerOptions.find((p) => p.source === 'settings') ||
            state.providerOptions[0] ||
            {}
          ).provider ||
          '';
        const eValRaw = mount ? mount.reasoningEffort : effortValue;
        const eVal = eValRaw !== null && eValRaw !== undefined ? String(eValRaw) : '';
        // D 项：effort 选项按当前 provider+model 的声明级别渲染（未声明 → 全集+提示；值不在支持列表 → '-' 占位）
        const effortOpts = effortSelectOptions(mountProvider, mVal, { current: eVal });
        return `<div class="item-card" data-sub="${esc(sa.id)}">
            <div class="item-head">
              <span class="item-id">${esc(sa.id)}</span>
              <span class="item-badge ${sa.custom ? 'tag-ok' : ''}">${sa.custom ? '自定义' : '原厂'}</span>
              ${esc(sa.name) ? `<span class="item-badge tag-accent">${esc(sa.name)}</span>` : ''}
            </div>
            <div class="item-meta">模型来源：${srcBadge || '<span class="item-badge">none</span>'} 生效模型：${effDesc}</div>
            ${
              editable
                ? `<div class="sub-editor">
                    <div class="sub-editor-row">
                      <label class="field">
                        <span>模型服务（厂商）</span>
                        <select class="sub-provider" data-target="${esc(sa.id)}">${providerOptionsHtml(mountProvider)}</select>
                      </label>
                      <label class="field">
                        <span>模型（可下拉选择或手输）</span>
                        <input type="text" list="dl-models-${esc(sa.id)}" class="sub-model" value="${esc(mVal)}" placeholder="输入模型 ID" spellcheck="false">
                        <datalist id="dl-models-${esc(sa.id)}">${modelsForProvider(mountProvider)
                          .map((m) => `<option value="${esc(m)}">`)
                          .join('')}</datalist>
                      </label>
                      <label class="field">
                        <span>推理强度 reasoningEffort</span>
                        <select class="sub-effort">${effortOpts}</select>
                      </label>
                    </div>
                    <div class="sub-editor-actions">
                      <button type="button" class="primary sm" data-act="save">保存（PUT）</button>
                      <span class="sub-save-status"></span>
                    </div>
                  </div>`
                : `<p class="sub-readonly-note">${
                    sa.modelSource === 'preset'
                      ? '该子代理按 preset 文件标注生效（无挂载块）；config-ui 保存仅编辑挂载层（full/agent.cordis.yml 的 tool-subagent-&lt;id&gt;.agentOptions）。如需独立模型配置，请用「＋添加」创建自定义或在挂载层补充 tool-subagent 块。'
                      : '该子代理未标注模型字段，当前继承 settings.yaml 的 agent-default-model 全局默认；如需独立模型，请在挂载层（full/agent.cordis.yml）添加 tool-subagent-&lt;id&gt; 块的 agentOptions（见 README）。'
                  }</p>`
            }
            ${sa.description ? `<div class="item-meta">${esc(sa.description)}</div>` : ''}
          </div>`;
      })
      .join('');
  }

  async function saveSubagent(card) {
    const id = card.dataset.sub;
    const modelInput = card.querySelector('.sub-model');
    const effortSelect = card.querySelector('.sub-effort');
    const statusEl = card.querySelector('.sub-save-status');
    const body = {};
    if (modelInput) {
      const v = modelInput.value.trim();
      if (!v) {
        toast('模型 ID 不能为空', 'err');
        return;
      }
      body.model = v;
    }
    const providerSelect = card.querySelector('.sub-provider');
    if (providerSelect) {
      const v = providerSelect.value.trim();
      if (v) body.provider = v; // 有值才加（写入挂载层 agentOptions.provider）
    }
    if (effortSelect) {
      const v = effortSelect.value;
      if (v && v !== '-') body.reasoningEffort = v;
    }
    if (!Object.keys(body).length) {
      toast('没有可保存的字段', 'err');
      return;
    }
    if (statusEl) statusEl.textContent = '';
    try {
      const r = await api(`/api/subagents/${encodeURIComponent(id)}`, { method: 'PUT', body });
      const chg = (r.changed || []).map((c) => `${c.key}@L${c.line}`).join(', ');
      toast(`子代理「${id}」已保存到挂载层：${chg || '无变更'}`, 'ok');
      await loadSubagents(); // 回读校验
    } catch (err) {
      toast('保存失败：' + err.message, 'err');
    }
  }

  /* ───────────── 添加子代理（弹窗） ───────────── */

  async function openAddSubagentModal() {
    const modal = $('add-subagent-modal');
    const msgEl = $('add-modal-msg');
    $('add-id').value = '';
    $('add-model').value = '';
    $('add-source').value = 'template';
    $('add-template').value = '';
    msgEl.textContent = '';
    // 模型目录（GET /api/models → state.providerOptions / modelsByProvider）
    await loadModelCatalog();
    // Provider 下拉：settings 自定义 provider 优先（默认选中第一个）；无 settings 时才默认第一个内置厂商
    const defaultProvider =
      (state.providerOptions.find((p) => p.source === 'settings') || state.providerOptions[0] || {})
        .provider || '';
    $('add-provider').innerHTML = providerOptionsHtml(defaultProvider);
    // 模型 datalist 随默认 Provider 联动
    renderProviderDatalist($('dl-add-models'), $('add-provider').value);
    // D 项：#add-effort 随默认 Provider+Model（初始为空）联动渲染（默认 low）
    renderAddEffort($('add-provider').value, $('add-model').value.trim());
    // 模板下拉 = 现有子代理 id（原厂+已自定义）
    try {
      const data = await api('/api/subagents');
      const list = Array.isArray(data.subagents) ? data.subagents : [];
      const tpl = $('add-template');
      tpl.innerHTML = list
        .map(
          (sa) =>
            `<option value="${esc(sa.id)}">${esc(sa.id)}${sa.custom ? '（自定义）' : ''}</option>`,
        )
        .join('');
      if (list.length) tpl.value = list[0].id;
    } catch (err) {
      msgEl.textContent = '读取模板列表失败：' + err.message;
    }
    modal.classList.remove('hidden');
  }

  function closeAddSubagentModal() {
    $('add-subagent-modal').classList.add('hidden');
  }

  async function submitAddSubagent(ev) {
    ev.preventDefault();
    const msgEl = $('add-modal-msg');
    const id = $('add-id').value.trim();
    const provider = $('add-provider').value.trim();
    const model = $('add-model').value.trim();
    const reasoningEffort = $('add-effort').value;
    if (!id) {
      msgEl.textContent = '请填写名称（id）';
      return;
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      msgEl.textContent = 'id 仅允许小写字母/数字/短横线';
      return;
    }
    if (!provider) {
      msgEl.textContent = '请填写模型服务';
      return;
    }
    if (!model) {
      msgEl.textContent = '请填写/选择模型';
      return;
    }
    const source = $('add-source').value;
    const templateId = source === 'template' ? $('add-template').value : undefined;
    const body = { id, source, templateId, agentOptions: { provider, model, reasoningEffort } };
    if (source !== 'template') delete body.templateId;
    const btn = ev.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    msgEl.textContent = '';
    try {
      const r = await api('/api/subagents', { method: 'POST', body });
      msgEl.textContent = '';
      toast(
        `子代理「${r.id}」已创建（${r.source === 'blank' ? '空白' : '模板' + (r.template ? '：' + r.template : '')}）`,
        'ok',
      );
      closeAddSubagentModal();
      await loadSubagents();
    } catch (err) {
      msgEl.textContent = '创建失败：' + err.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ───────────── ③ 密钥管理 ───────────── */

  async function loadKeys() {
    const listEl = $('key-list');
    listEl.innerHTML = '<div class="item-empty">加载中…</div>';
    try {
      const data = await api('/api/keys');
      const keys = Array.isArray(data) ? data : data.keys || [];
      state.keyItems = keys; // 缓存行数据（masked/configured 供「修改」显示当前值掩码参考）
      // 全应用密钥来源提示（后端返回 shellRcFiles / ghHost / ghUser 时展示在密钥区顶部）
      const hintEl = $('key-source-hint');
      if (hintEl) {
        const parts = ['环境变量', '.credentials.yaml', 'dsh.env'];
        if (Array.isArray(data.shellRcFiles) && data.shellRcFiles.length) {
          parts.push(`shell 环境文件（${data.shellRcFiles.join('、')}）`);
        }
        if (data.ghHost) parts.push('GitHub gh 凭据');
        hintEl.textContent =
          parts.length > 3
            ? `密钥来源：${parts.join(' / ')}${data.ghUser ? `；GitHub 凭据来自 gh auth（账号 ${data.ghUser}）` : ''}`
            : '';
      }
      if (!keys.length) {
        listEl.innerHTML =
          '<div class="item-empty">暂无密钥变量（settings.yaml 未声明 apiKeyEnv，凭据文件与 dsh.env 也不存在）。</div>';
        return;
      }
      const srcLabel = (k) => {
        const s = k.source;
        if (s === 'env') return '环境变量';
        if (s === 'credentials.yaml') return '凭据文件';
        if (s === 'dsh.env') return 'dsh.env';
        if (s === 'bashrc') return k.file ? `~/${k.file}` : '环境文件';
        if (s === 'gh') return 'GitHub 凭据';
        return s || '—';
      };
      // 按 category 分组展示：模型服务 → 网络搜索 → GitHub → 其他 → 未分类；组内维持现有 name 排序
      const CATEGORY_ORDER = ['模型服务', '网络搜索', 'GitHub', '其他', '未分类'];
      const groups = new Map();
      for (const cat of CATEGORY_ORDER) groups.set(cat, []);
      for (const k of keys) {
        const cat = k.category || '未分类';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(k);
      }
      const rowHtml = (k) => `<div class="item-card key-row">
            <span class="key-name">${esc(k.name)}</span>
            <span class="key-masked">${k.configured ? esc(k.masked) : '—'}</span>
            <span class="item-badge ${k.source === 'dsh.env' ? 'tag-accent' : 'tag-ok'}">${esc(srcLabel(k))}</span>
            <span class="item-badge ${k.configured ? 'tag-ok' : ''}">${k.configured ? '已配置' : '未配置'}</span>
            <button type="button" class="sm" data-act="edit-key" data-name="${esc(k.name)}">修改</button>
            <button type="button" class="sm danger" data-act="del-key" data-name="${esc(k.name)}">删除</button>
          </div>`;
      listEl.innerHTML = CATEGORY_ORDER.filter((cat) => groups.get(cat).length)
        .map(
          (cat) => `<div class="key-group">
            <h4 class="key-group-title">◈ ${esc(cat)}（${groups.get(cat).length}）</h4>
            ${groups.get(cat).map(rowHtml).join('')}
          </div>`,
        )
        .join('');
    } catch (err) {
      listEl.innerHTML = `<div class="item-empty">${esc(err.message)}</div>`;
    }
  }

  async function submitKeyForm(ev) {
    ev.preventDefault();
    const name = $('kf-name').value.trim();
    const value = $('kf-value').value;
    const msgEl = $('key-form-msg');
    if (!name) {
      toast('请填写变量名', 'err');
      return;
    }
    if (!value) {
      setMsg(msgEl, '值留空 = 不修改（无写入）', 'err');
      return;
    }
    try {
      const r = await api('/api/keys', { method: 'POST', body: { name, value } });
      // 立即清空明文输入，同时清除掩码参考提示
      $('kf-value').value = '';
      const kfCurrent = $('kf-current');
      if (kfCurrent) kfCurrent.textContent = '';
      setMsg(
        msgEl,
        `已保存：${r.name}（${r.replaced ? '覆盖原值' : '新增'}）→ 读回掩码：${maskPreview(value)}`,
        'ok',
      );
      toast(`密钥 ${name} 已保存（仅显示掩码）`, 'ok');
      await loadKeys();
    } catch (err) {
      setMsg(msgEl, '保存失败：' + err.message, 'err');
    }
  }

  /* ───────────── ④ 状态卡片 ───────────── */

  function basename(p) {
    const s = String(p || '');
    const parts = s.split('/').filter(Boolean);
    return parts[parts.length - 1] || s;
  }

  /** 重启 dsh 主服务（C 项）：confirm → POST /api/dsh/restart（后端 spawn 后立即返回）→ toast。 */
  function restartDsh() {
    if (!window.confirm('确认重启 dsh 主服务？当前 dsh 会话会短暂断开，config-ui 不受影响。'))
      return;
    api('/api/dsh/restart', { method: 'POST' })
      .then(() => toast('已发起重启，dsh 约数秒后恢复', 'ok'))
      .catch((err) => toast('重启失败：' + err.message, 'err'));
  }

  async function loadStatus() {
    const el = $('status-card');
    el.innerHTML = '<div class="item-empty">加载中…</div>';
    try {
      const st = await api('/api/status');
      state.presetsDir = st.presetsDir;
      await syncBanner(st);
      const dot = st.running ? 'on' : 'off';
      const runText = st.running ? '运行中' : '未运行';
      el.innerHTML = `
        <div class="status-row">
          <span class="status-label">dsh 服务（探针端口 ${esc(st.dshPort)}）</span>
          <span class="status-value ${st.running ? 'ok' : 'bad'}"><span class="dot ${dot}"></span> ${esc(runText)}</span>
        </div>
        <div class="status-row">
          <span class="status-label">dsh Web 端口</span>
          <span class="status-value mono">${esc(st.dshPort)}</span>
        </div>
        <div class="status-row">
          <span class="status-label">DSH_TRUSTED_HOSTS</span>
          <span class="status-value mono">${st.DSH_TRUSTED_HOSTS ? esc(st.DSH_TRUSTED_HOSTS) : '<span class="bad">未设置（仅本机访问）</span>'}</span>
        </div>
        <div class="status-row">
          <span class="status-label">当前配置目录</span>
          <span class="status-value mono">${esc(basename(st.configDir))}</span>
        </div>
        <div class="status-row">
          <span class="status-label">配置服务端口 / 预设目录</span>
          <span class="status-value mono">${esc(st.port)} / ${esc(basename(st.presetsDir))}</span>
        </div>
        <p class="hint" style="margin-top:6px">完整路径：<code>${esc(st.configDir)}</code><br>说明：dsh 服务探测为 ${esc(st.running ? '可访问（探针成功）' : '不可访问（探针失败，可能未启动）')}，不影响本配置页使用。</p>`;
      const dotEl = $('conn-dot');
      dotEl.className = 'dot on';
      $('conn-text').textContent = '已连接';
    } catch (err) {
      el.innerHTML = `<div class="item-empty">${esc(err.message)}</div>`;
      const dotEl = $('conn-dot');
      dotEl.className = 'dot off';
      $('conn-text').textContent = '连接失败';
    }
  }

  /* ───────────── ⑤ 回滚（可执行操作） ───────────── */

  async function loadRollback() {
    const stEl = $('rollback-status');
    stEl.innerHTML = '<div class="item-empty">加载中…</div>';

    // 填充 harness 下拉（最近 commits）
    const harnessSel = $('rollback-harness-select');
    if (harnessSel) harnessSel.innerHTML = '<option value="">加载中…</option>';
    // 填充 cordis 下拉
    const cordisSel = $('rollback-cordis-select');
    if (cordisSel) cordisSel.innerHTML = '<option value="">加载中…</option>';
    // 填充凭据下拉
    const credSel = $('rollback-cred-select');
    if (credSel) credSel.innerHTML = '<option value="">加载中…</option>';

    try {
      const [st, bk] = await Promise.all([api('/api/rollback'), api('/api/rollback/backups')]);

      // 填充 harness 下拉（最近 commits）
      if (harnessSel && bk.commits && bk.commits.length) {
        harnessSel.innerHTML = bk.commits
          .map((c) => {
            const [hash, ...rest] = c.split(' ');
            const subject = rest.join(' ');
            return `<option value="${esc(hash)}">${esc(hash)} — ${esc(subject)}</option>`;
          })
          .join('');
        // 默认选中 a336607bcb
        const defaultOpt = harnessSel.querySelector('option[value="a336607bcb"]');
        if (defaultOpt) defaultOpt.selected = true;
        else harnessSel.selectedIndex = 0;
      } else if (harnessSel) {
        harnessSel.innerHTML = '<option value="">无可用的版本记录</option>';
      }

      // 填充 cordis 下拉
      if (cordisSel && bk.cordis.length) {
        cordisSel.innerHTML = bk.cordis
          .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`)
          .join('');
      } else if (cordisSel) {
        cordisSel.innerHTML = '<option value="">无备份</option>';
      }

      // 填充凭据下拉
      if (credSel && bk.credentials.length) {
        credSel.innerHTML = bk.credentials
          .map((n) => `<option value="${esc(n)}">${esc(n)}</option>`)
          .join('');
      } else if (credSel) {
        credSel.innerHTML = '<option value="">无备份</option>';
      }

      // 更新状态区
      stEl.innerHTML = `
        <div class="status-row">
          <span class="status-label">harness 当前版本</span>
          <span class="status-value mono">${esc(st.harnessHead || '（非 git 仓库）')}</span>
        </div>
        <div class="status-row">
          <span class="status-label">备份数（配置编排 / 凭据 / 记忆）</span>
          <span class="status-value mono">${esc(st.backupCounts?.cordis ?? 0)} / ${esc(st.backupCounts?.credentials ?? 0)} / ${esc(st.backupCounts?.memory ?? 0)}</span>
        </div>
        <div class="status-row">
          <span class="status-label">git 回滚安全引用</span>
          <span class="status-value mono">${st.rollbackRefs?.length ? esc(st.rollbackRefs.join('；')) : '<span class="bad">无</span>'}</span>
        </div>`;
    } catch (err) {
      // 即使失败也尝试填充已知数据
      stEl.innerHTML = `<div class="item-empty">${esc(err.message)}</div>
        <p class="hint" style="margin-top:8px">提示：dsh 未重启时，运行的是旧版 config-ui，可能没有回滚接口。请先重启 dsh 使新代码生效。</p>`;
      // 确保下拉显示错误信息
      if (harnessSel) harnessSel.innerHTML = '<option value="">加载失败，请刷新重试</option>';
      if (cordisSel) cordisSel.innerHTML = '<option value="">加载失败，请刷新重试</option>';
      if (credSel) credSel.innerHTML = '<option value="">加载失败，请刷新重试</option>';
    }
  }

  function showResult(elId, ok, msg) {
    const el = $(elId);
    if (!el) return;
    el.className = 'msg ' + (ok ? 'ok' : 'err');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  async function doRollback(endpoint, body, resultId, okMsg, errPrefix) {
    const btn = event && event.target;
    if (btn) btn.disabled = true;
    try {
      const r = await api(endpoint, { method: 'POST', body });
      if (r.ok) showResult(resultId, true, okMsg + (r.bak ? ' — 已备份到 ' + esc(r.bak) : ''));
      else showResult(resultId, false, errPrefix + ': 服务器返回 ok=false');
    } catch (e) {
      showResult(resultId, false, errPrefix + ': ' + esc(e.message));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // 事件绑定（在 bindEvents 中调用）
  function bindRollbackEvents() {
    $('btn-rollback-refresh').addEventListener('click', loadRollback);
    $('btn-rollback-harness').addEventListener('click', () => {
      const sel = $('rollback-harness-select');
      const commit = sel?.value || 'a336607bcb';
      if (!window.confirm(`确认回滚代码框架到 ${commit}？当前状态会自动备份。`)) return;
      doRollback(
        '/api/rollback/harness',
        { commit },
        'rollback-harness-result',
        '代码框架已回滚',
        '代码框架回滚失败',
      );
    });
    $('btn-rollback-cordis').addEventListener('click', () => {
      const sel = $('rollback-cordis-select');
      if (!sel || !sel.value) {
        toast('请先选择一个配置编排备份', 'err');
        return;
      }
      if (!window.confirm(`确认回滚配置编排到 ${sel.value}？`)) return;
      doRollback(
        '/api/rollback/cordis',
        { backup_file: sel.value },
        'rollback-cordis-result',
        '配置编排已回滚',
        '配置编排回滚失败',
      );
    });
    $('btn-rollback-credentials').addEventListener('click', () => {
      const sel = $('rollback-cred-select');
      if (!sel || !sel.value) {
        toast('请先选择一个凭据备份', 'err');
        return;
      }
      if (!window.confirm(`确认回滚凭据到 ${sel.value}？重启 dsh 后生效。`)) return;
      doRollback(
        '/api/rollback/credentials',
        { backup_file: sel.value },
        'rollback-credentials-result',
        '凭据密钥已回滚',
        '凭据密钥回滚失败',
      );
    });
    $('btn-rollback-memory').addEventListener('click', () => {
      if (!window.confirm('确认回滚记忆文件到最新快照？当前记忆会被备份。')) return;
      doRollback(
        '/api/rollback/memory',
        {},
        'rollback-memory-result',
        '记忆文件已回滚',
        '记忆文件回滚失败',
      );
    });
    // 更新全部回滚提示文字
    function updateAllHint() {
      const sel = $('rollback-harness-select');
      const commit = sel?.value || 'a336607bcb';
      const hint = $('rollback-all-hint');
      if (hint) hint.textContent = `代码框架 → ${commit}，其他组件使用最新备份`;
    }
    // 监听 harness 选择变化
    $('rollback-harness-select')?.addEventListener('change', updateAllHint);
    updateAllHint();

    $('btn-rollback-all').addEventListener('click', () => {
      const sel = $('rollback-harness-select');
      const commit = sel?.value || 'a336607bcb';
      if (!window.confirm(`⚠️ 确认全部回滚？代码框架回滚到 ${commit}，回滚后需手动重启 dsh。`))
        return;
      showResult('rollback-all-result', false, '执行中…');
      api('/api/rollback/all', { method: 'POST', body: { commit } })
        .then((r) => {
          if (r.ok) showResult('rollback-all-result', true, '一键全量回滚完成，请手动重启 dsh');
          else
            showResult(
              'rollback-all-result',
              false,
              '部分回滚失败: ' +
                JSON.stringify(
                  r.results?.map(
                    (x) =>
                      `${{ harness: '代码框架', cordis: '配置编排', credentials: '凭据', memory: '记忆' }[x.action] || x.action}=${x.ok ? '成功' : x.error}`,
                  ),
                ),
            );
        })
        .catch((e) =>
          showResult('rollback-all-result', false, '一键全量回滚失败: ' + esc(e.message)),
        );
    });
  }

  /* ───────────── 事件绑定 ───────────── */

  function copyText(text) {
    const done = () => toast('已复制到剪贴板', 'ok');
    const fail = () => {
      // 老浏览器回退：临时 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        toast('复制失败，请手动选择复制', 'err');
      }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else fail();
  }

  function bindEvents() {
    // 系统告警横幅：关闭
    $('alert-banner-dismiss').addEventListener('click', hideBanner);

    // 首启 token 复制
    $('btn-copy-token').addEventListener('click', () => {
      if (state.bootToken) copyText(state.bootToken);
    });
    // 进入向导
    $('btn-goto-wizard').addEventListener('click', () => {
      $('view-login').classList.add('hidden');
      openWizard();
    });

    // 登录
    $('login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const t = $('login-token').value.trim();
      if (!t) {
        setMsg($('login-msg'), '请输入访问令牌', 'err');
        return;
      }
      state.token = t;
      try {
        await api('/api/status'); // 校验令牌
        sessionStorage.setItem(TOKEN_KEY, t);
        setMsg($('login-msg'), '');
        showMainView();
      } catch (err) {
        state.token = null;
        setMsg($('login-msg'), err.message, 'err');
      }
    });

    // 向导导航
    document
      .querySelectorAll('#wizard .next')
      .forEach((b) => b.addEventListener('click', () => wizardNext(Number(b.dataset.next) - 1)));
    document
      .querySelectorAll('#wizard .prev')
      .forEach((b) => b.addEventListener('click', () => wizardStep(Number(b.dataset.prev))));
    $('wz-provider-name').addEventListener('input', () => {
      if (!state.wizard.envTouched) {
        const v = $('wz-provider-name').value.trim();
        $('wz-env').value = v ? v.toUpperCase().replace(/[^A-Z0-9_]/g, '_') + '_API_KEY' : '';
      }
    });
    $('wz-env').addEventListener('input', () => {
      state.wizard.envTouched = true;
    });
    $('wz-run-check').addEventListener('click', wizardRunCheck);
    $('wz-finish').addEventListener('click', () => {
      $('wz-env').value = '';
      showMainView();
      switchTab('status');
    });

    // 标签页
    document
      .querySelectorAll('.tab')
      .forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // Provider 表单
    $('btn-provider-new').addEventListener('click', () => openProviderForm(null));
    $('pf-cancel').addEventListener('click', closeProviderForm);
    $('provider-form').addEventListener('submit', submitProviderForm);
    $('provider-list').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'edit') openProviderForm(id);
      else if (btn.dataset.act === 'del') deleteProvider(id);
    });

    // 子代理
    $('btn-subagent-refresh').addEventListener('click', loadSubagents);
    $('subagent-list').addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-act="save"]');
      if (!btn) return;
      saveSubagent(btn.closest('.item-card'));
    });
    // 编辑卡片 change 委托（A/D 项）：
    //  .sub-provider 换厂商 → 清空该卡模型 input 残留值 + 重建独立 dl-models-<id> datalist +
    //                        重建 .sub-effort（model 已空 → 未声明分支：全集+提示+'-'占位）+ toast；
    //  .sub-model 换模型     → 按当前 provider+model 重建该卡 .sub-effort（当前值支持则保留，否则 '-' 空占位）
    $('subagent-list').addEventListener('change', (ev) => {
      const provSel = ev.target.closest('.sub-provider');
      const card = ev.target.closest('.item-card');
      if (provSel && card) {
        const modelInput = card.querySelector('.sub-model');
        const dl = card.querySelector('datalist[id^="dl-models-"]');
        const nprov = provSel.value;
        const mm = modelsForProvider(nprov);
        if (modelInput) {
          modelInput.value = '';
          modelInput.placeholder = mm.length ? `选择或输入 ${nprov} 模型` : '输入模型 ID';
        }
        if (dl) dl.innerHTML = mm.map((m) => `<option value="${esc(m)}">`).join('');
        rebuildCardEffort(card, '');
        toast('已切换厂商，请选择模型');
        return;
      }
      const mIn = ev.target.closest('.sub-model');
      if (mIn && card) rebuildCardEffort(card, mIn.value.trim());
    });

    // 添加子代理
    $('btn-subagent-add').addEventListener('click', openAddSubagentModal);
    $('btn-add-cancel').addEventListener('click', closeAddSubagentModal);
    $('add-subagent-modal').addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) closeAddSubagentModal();
    });
    $('add-subagent-form').addEventListener('submit', submitAddSubagent);
    $('add-source').addEventListener('change', (ev) => {
      const tmplField = $('add-template-field');
      tmplField.style.display = ev.target.value === 'template' ? '' : 'none';
    });
    // 添加弹窗：切换 Provider → 重建 dl-add-models datalist + 清空 #add-model 残留值 + 重建 #add-effort（A/D 项；#add-provider 常驻 DOM，绑定一次即可）
    $('add-provider').addEventListener('change', (ev) => {
      const prov = ev.target.value;
      renderProviderDatalist($('dl-add-models'), prov);
      const mEl = $('add-model');
      if (mEl) mEl.value = '';
      renderAddEffort(prov, '');
      toast('已切换厂商，请选择模型');
    });
    // 添加弹窗：#add-model 变化 → 按当前 provider+model 重建 #add-effort（D 项）
    $('add-model').addEventListener('change', (ev) => {
      renderAddEffort($('add-provider').value, ev.target.value.trim());
    });

    // 密钥
    $('btn-keys-refresh').addEventListener('click', loadKeys);
    $('key-form').addEventListener('submit', submitKeyForm);
    // 密钥行：修改（预填变量名 + 显示原值掩码参考 + 聚焦/滚动/toast）与 删除（confirm → DELETE → toast → 刷新）
    $('key-list').addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const name = btn.dataset.name;
      const kfName = $('kf-name');
      const kfValue = $('kf-value');
      const keyForm = $('key-form');
      const kfCurrent = $('kf-current');
      if (act === 'edit-key') {
        if (kfName) kfName.value = name;
        if (kfCurrent) {
          const item = state.keyItems.find((k) => k.name === name);
          kfCurrent.textContent = item
            ? item.configured
              ? `当前值（掩码）：${item.masked}，粘贴新值保存即覆盖`
              : '该变量当前未配置，可直接填写新值'
            : '';
        }
        if (keyForm) keyForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (kfValue) kfValue.focus();
        toast(`已载入 ${name}，粘贴新值保存即覆盖`, 'ok');
        return;
      }
      if (act === 'del-key') {
        if (
          !window.confirm(
            `确认删除密钥「${name}」？将从凭据文件（和 dsh.env 若有）中移除该条目。环境变量来源的值不受影响。`,
          )
        )
          return;
        try {
          const r = await api('/api/keys', { method: 'DELETE', body: { name } });
          toast(
            r.note || (r.removed ? `已删除 ${name}` : `${name} 未删除`),
            r.removed ? 'ok' : 'err',
          );
          // 若表单正预填该键 → 一并清空残留提示/值
          if (kfName && kfName.value === name) {
            if (kfCurrent) kfCurrent.textContent = '';
            if (kfValue) kfValue.value = '';
          }
          await loadKeys();
        } catch (err) {
          toast('删除失败：' + err.message, 'err');
        }
      }
    });
    // 「修改」后用户清空值输入 → 掩码参考提示随之清除
    const kfValueInput = $('kf-value');
    if (kfValueInput) {
      kfValueInput.addEventListener('input', () => {
        const cur = $('kf-current');
        if (cur && !kfValueInput.value) cur.textContent = '';
      });
    }

    // 状态
    $('btn-status-refresh').addEventListener('click', loadStatus);
    // 重启 dsh 主服务（C 项）：confirm → POST /api/dsh/restart → toast
    $('btn-dsh-restart').addEventListener('click', restartDsh);

    // 回滚事件绑定
    bindRollbackEvents();

    // 退出
    $('btn-logout').addEventListener('click', logout);
  }

  /* ───────────── 启动 ───────────── */

  async function start() {
    bindEvents();
    if (state.token) {
      // 已有会话令牌：先校验，失败则退回登录
      try {
        const st = await api('/api/status');
        await syncBanner(st);
        showMainView();
        return;
      } catch (err) {
        if (!String(err.message).includes('登录已失效')) {
          toast(err.message, 'err');
        }
        showLoginView();
        return;
      }
    }
    showLoginView();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
