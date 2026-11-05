(function () {
  if (window.__ngaext_init) { try { window.__ngaext.scan(); } catch (e) {} return; }
  window.__ngaext_init = true;

  var PREVIEW = 800;
  var MAX_LINKS_PER_BLOCK = 300;
  var MAX_CARDS = 600;
  var TEXT_CAP = 200000;
  var CONCURRENCY = 6;
  var BRIDGE = 'NgaExtBridge';
  var STYLE_ID = 'ngaext-style-v7';
  // v2：旧版本默认暗色偏好不再沿用，新安装/未设置时默认白色
  var DARK_KEY = 'ngaext.dark.v2';
  var PREVIEW_KEY = 'ngaext.preview';
  var SHOW_FULL_KEY = 'ngaext.showFull';
  var LAST_THREAD_KEY = 'ngaext.lastThreadKey';
  var REPO_URL = 'https://github.com/heart06215/nga_disroot_plugin';
  var REQUEST_TIMEOUT = 45000;

  var callbacks = {};
  var cache = {};
  var queue = [];
  var inflight = 0;
  var seq = 0;
  var stickyPw = '';
  var serviceNoticeShown = false;
  var capNoticeShown = false;

  var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  /* ---------- 夜色模式（全局，持久化） ---------- */
  function isDark() {
    try { return localStorage.getItem(DARK_KEY) === '1'; } catch (e) { return false; }
  }
  function applyDark(on) {
    try {
      if (on) document.documentElement.classList.add('ngaext-night');
      else document.documentElement.classList.remove('ngaext-night');
    } catch (e) {}
    var btns = document.querySelectorAll('.ngaext-mode');
    for (var i = 0; i < btns.length; i++) btns[i].textContent = on ? '☀' : '☾';
  }
  function toggleDark() {
    var on = !isDark();
    try { localStorage.setItem(DARK_KEY, on ? '1' : '0'); } catch (e) {}
    applyDark(on);
  }
  applyDark(isDark());

  function previewLen() {
    try {
      var v = parseInt(localStorage.getItem(PREVIEW_KEY) || '800', 10);
      if (v >= 200 && v <= 20000) return v;
    } catch (e) {}
    return PREVIEW;
  }

  function showFull() {
    try { return localStorage.getItem(SHOW_FULL_KEY) === '1'; } catch (e) { return false; }
  }

  /* ---------- 指纹识别 ---------- */
  function normalizeWide(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c >= 0xFF01 && c <= 0xFF5E) { out += String.fromCharCode(c - 0xFEE0); continue; }
      if (c === 0x3000) { out += ' '; continue; }
      out += text.charAt(i);
    }
    return out;
  }
  function compactOf(text) { return normalizeWide(text).replace(/[^A-Za-z0-9?#]/g, ''); }

  function findLinks(text) {
    var compact = compactOf(text);
    if (!/dis|pasteto/i.test(compact)) return [];
    var re = /\?([0-9a-fA-F]{16})#([1-9A-HJ-NP-Za-km-z]{20,60})/g;
    var byId = {}, hostById = {}, order = [], m;
    while ((m = re.exec(compact)) !== null) {
      var id = m[1].toLowerCase();
      var key = m[2].substring(0, 46);
      var before = compact.slice(Math.max(0, m.index - 48), m.index);
      var host = 'bin.disroot.org';
      if (/pastedisroot/i.test(before)) host = 'paste.disroot.org';
      else if (/pasteto/i.test(before)) host = 'paste.to';
      if (!byId[id]) { byId[id] = key; hostById[id] = host; order.push(id); }
      else if (key.length > byId[id].length) { byId[id] = key; hostById[id] = host; }
    }
    var out = [];
    for (var i = 0; i < order.length && out.length < MAX_LINKS_PER_BLOCK; i++) {
      out.push('https://' + hostById[order[i]] + '/?' + order[i] + '#' + byId[order[i]]);
    }
    return out;
  }

  function findPassword(text) {
    // 排除 "密码：bin.disroot.org/..." 这类把域名当密码的情况
    var m = text.match(/密码[^A-Za-z0-9]{0,8}([A-Za-z0-9!@#$%^&*_\-]{2,40})(?![A-Za-z0-9.\/])/);
    if (!m) return '';
    var v = m[1];
    if (/^(bin|paste|http|https|www|disroot|org|com|net|cn)$/i.test(v)) return '';
    return v;
  }

  /** 「后面的密码全都是 xx」这类全局声明 */
  function isStickyPassword(text) {
    return /密码[^。\n]{0,10}(全|都|统一|均)|(后面|以下|之后|接下来)[^。\n]{0,10}密码/.test(text);
  }

  /* ---------- 按帖子隔离的密码记忆 ---------- */
  var STORE_KEY = 'ngaext.pwstore.v3';

  function loadStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return (s && typeof s === 'object') ? s : {};
    } catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function clearPasswordStore() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  /** 用稳定标题/楼主 UID 做帖子标识，翻页时复用最近一次 key */
  function threadKey() {
    try {
      var title = document.querySelector('.articleTitle, .titleBlock, .wrapBox h1, .title');
      if (title) {
        var tt = (title.textContent || '').replace(/\s+/g, ' ').trim();
        if (tt.length >= 2) {
          var tk = 't' + tt.slice(0, 60);
          try { localStorage.setItem(LAST_THREAD_KEY, tk); } catch (e) {}
          return tk;
        }
      }
      var first = document.querySelector('.columnItem');
      var last = '';
      try { last = localStorage.getItem(LAST_THREAD_KEY) || ''; } catch (e) {}
      if (last) return last;
      if (!first) return '';
      var m = (first.innerHTML || '').match(/doAction\(304,\[\s*'(\d+)'\s*\]\)/);
      if (m) {
        var uk = 'u' + m[1];
        try { localStorage.setItem(LAST_THREAD_KEY, uk); } catch (e) {}
        return uk;
      }
      var t = (first.textContent || '').replace(/\s+/g, '');
      return t ? 'h' + t.slice(0, 24) : '';
    } catch (e) { return ''; }
  }

  function threadEntry(key) {
    if (!key) return { sticky: '', pws: [] };
    var s = loadStore();
    var e = s[key];
    if (!e || typeof e !== 'object') return { sticky: '', pws: [] };
    return { sticky: e.sticky || '', pws: Array.isArray(e.pws) ? e.pws : [] };
  }

  function rememberPw(key, p) {
    if (!key || !p || p.length < 3) return;
    var s = loadStore();
    var e = s[key] || { sticky: '', pws: [] };
    if (!Array.isArray(e.pws)) e.pws = [];
    if (e.pws.indexOf(p) < 0) {
      e.pws.push(p);
      while (e.pws.length > 50) e.pws.shift();
    }
    s[key] = e;
    var keys = Object.keys(s);
    while (keys.length > 10) { delete s[keys[0]]; keys = Object.keys(s); }
    saveStore(s);
  }

  function setStickyPw(key, p) {
    if (!key) return;
    var s = loadStore();
    var e = s[key] || { sticky: '', pws: [] };
    e.sticky = p;
    s[key] = e;
    saveStore(s);
  }

  function candidatesFor(floorPw, sticky, memory) {
    var out = [];
    function add(p) { if (p && out.indexOf(p) < 0 && out.length < 5) out.push(p); }
    add(floorPw);
    add(sticky);
    var mem = memory || [];
    for (var i = mem.length - 1; i >= 0; i--) add(mem[i]);
    return out;
  }

  function showVersionBanner() {
    var v = window.NGAEXT_VER;
    if (!v || v.ok) return;
    if (document.getElementById('ngaext-ver')) return;
    ensureStyle();
    var d = document.createElement('div');
    d.className = 'ngaext-card';
    d.id = 'ngaext-ver';
    d.innerHTML = '<div class="ngaext-head"><span class="ngaext-dot"></span>' +
      '<span class="ngaext-title">插件未适配当前 NGA 版本</span></div>' +
      '<div class="ngaext-body">当前 NGA ' + (v.name || '') + '（' + (v.code || '?') + '），' +
      '插件按 ' + (v.targetName || '') + ' 开发，部分楼层可能解析不出来。</div>';
    var host = document.querySelector('.wrapBox') || document.body;
    if (host) host.insertBefore(d, host.firstChild);
  }

  function textOf(el) {
    try {
      // 首次扫描时楼层里还没有卡片，直接取 textContent，避免每个楼层都 clone 一整棵 DOM
      if (!el.querySelector || !el.querySelector('.ngaext-card')) return el.textContent || '';
      var clone = el.cloneNode(true);
      var cards = clone.querySelectorAll('.ngaext-card');
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].parentNode) cards[i].parentNode.removeChild(cards[i]);
      }
      return clone.textContent || '';
    } catch (e) { return el.textContent || ''; }
  }

  function cardCount() {
    var n = document.querySelectorAll('.ngaext-card').length;
    return document.getElementById('ngaext-ver') ? n - 1 : n;
  }

  /* ---------- 样式 ---------- */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '.ngaext-card{position:relative;margin:10px auto 8px auto;max-width:960px;padding:13px 15px 12px 17px;',
      'background:linear-gradient(180deg,#FDF9F1 0%,#FAF3E6 100%) !important;',
      'border:1px solid #D8BE84 !important;border-radius:9px !important;',
      'box-shadow:0 2px 10px rgba(160,120,40,.14), inset 0 1px 0 #FFFDF8 !important;',
      'color:#2F271C !important;font-size:15px !important;line-height:1.72 !important;',
      'font-family:-apple-system,"Noto Sans SC",sans-serif !important;text-align:left !important;overflow:hidden;}',
      '.ngaext-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;',
      'background:linear-gradient(180deg,#E3C87F 0%,#C8A44D 55%,#B08A32 100%);}',
      '.ngaext-card:after{content:"";position:absolute;left:5px;right:5px;top:5px;bottom:5px;',
      'border:1px solid rgba(200,164,77,.34);border-radius:6px;pointer-events:none;}',
      '.ngaext-head{display:flex;align-items:center;gap:7px;margin:0 0 7px 0;padding-bottom:7px;',
      'border-bottom:1px solid rgba(200,164,77,.30);}',
      '.ngaext-dot{width:7px;height:7px;background:#C8A44D;transform:rotate(45deg);flex:0 0 auto;}',
      '.ngaext-title{font-size:13px !important;font-weight:700 !important;letter-spacing:.4px;color:#8A6A22 !important;}',
      '.ngaext-idx{margin-left:auto;font-size:11px !important;color:#A08B63 !important;}',
      '.ngaext-mode{flex:0 0 auto;width:24px;height:24px;line-height:22px;padding:0;text-align:center;',
      'background:#FFFDF8 !important;border:1px solid #D8BE84 !important;border-radius:50% !important;',
      'color:#8A6A22 !important;font-size:13px !important;cursor:pointer;}',
      '.ngaext-body{position:relative;z-index:1;color:#33291C !important;white-space:pre-wrap;word-break:break-word;}',
      '.ngaext-fade{position:absolute;left:0;right:0;bottom:0;height:64px;pointer-events:none;',
      'background:linear-gradient(180deg,rgba(250,243,230,0) 0%,rgba(250,243,230,.92) 70%,#FAF3E6 100%);}',
      '.ngaext-more{position:relative;z-index:2;display:block;width:100%;margin:10px 0 0 0;padding:9px 12px;',
      'background:#FFFDF8 !important;border:1px solid #D8BE84 !important;border-radius:7px !important;',
      'color:#8A6A22 !important;font-size:13px !important;font-weight:600;letter-spacing:.3px;',
      'cursor:pointer;text-align:center;font-family:inherit !important;}',
      '.ngaext-foot{margin-top:10px;padding-top:6px;border-top:1px dashed rgba(200,164,77,.40);',
      'font-size:12px !important;color:#8B7857 !important;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.ngaext-tag{color:#A98530 !important;font-weight:600;}',
      '.ngaext-src{margin-right:auto;}',
      '.ngaext-act{background:transparent !important;border:0 !important;color:#8A6A22 !important;',
      'font-size:12px !important;padding:2px 4px !important;cursor:pointer;font-family:inherit !important;}',
      '.ngaext-err{color:#9A3B2E !important;font-size:13px !important;}',
      '.ngaext-load{color:#8B7857 !important;font-size:13px !important;}',
      '.ngaext-wrap{position:relative;}',
      '.ngaext-settings{flex:0 0 auto;width:24px;height:24px;line-height:22px;padding:0;margin-left:2px;text-align:center;',
      'background:#FFFDF8 !important;border:1px solid #D8BE84 !important;border-radius:50% !important;',
      'color:#8A6A22 !important;font-size:13px !important;cursor:pointer;}',
      '.ngaext-notice{margin:10px 8px;padding:12px 14px;border:1px solid #D8BE84;border-radius:8px;',
      'background:#FFF8E8;color:#5C4B33;font-size:13px;line-height:1.6;}',
      '.ngaext-notice b{color:#9A3B2E;}',
      '.ngaext-notice button{margin-top:6px;padding:5px 10px;border:1px solid #D8BE84;border-radius:6px;',
      'background:#FFFDF8;color:#8A6A22;font-size:12px;}',
      '.ngaext-pwbox{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}',
      '.ngaext-pwbox input{flex:1;min-width:120px;padding:7px 8px;border:1px solid #D8BE84;border-radius:6px;',
      'background:#FFFDF8;color:#2F271C;font-size:13px;}',
      '.ngaext-pwbox button{padding:7px 10px;border:1px solid #D8BE84;border-radius:6px;background:#FFFDF8;',
      'color:#8A6A22;font-size:12px;}',
      '.ngaext-settings-panel{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);',
      'z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.ngaext-settings-box{width:86%;max-width:420px;max-height:80vh;overflow:auto;background:#FBF7F0;',
      'border:1px solid #D8BE84;border-radius:12px;padding:16px;color:#2F271C;font-size:14px;line-height:1.6;}',
      '.ngaext-settings-box h3{margin:0 0 8px 0;font-size:17px;color:#2F271C;}',
      '.ngaext-settings-row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;}',
      '.ngaext-set-btn{padding:6px 10px;border:1px solid #D8BE84;border-radius:6px;background:#FFFDF8;',
      'color:#8A6A22;font-size:12px;}',
      '.ngaext-set-btn.on{background:#8A6A22;color:#FFFDF8;}',
      '.ngaext-settings-highlight{display:flex;align-items:center;justify-content:space-between;gap:10px;',
      'margin:10px 0 12px 0;padding:12px;border:2px solid #C8A44D;border-radius:9px;',
      'background:linear-gradient(180deg,#FFF6D9 0%,#FFEDBB 100%);}',
      '.ngaext-settings-highlight b{display:block;font-size:15px;color:#6B4E12;}',
      '.ngaext-settings-sub{font-size:11px;color:#8B7857;line-height:1.4;margin-top:3px;}',
      '.ngaext-full-toggle{flex:0 0 auto;min-width:64px;padding:8px 10px;font-weight:700;}',
      '.ngaext-set-link{display:block;margin:8px 0;color:#8A6A22;font-size:13px;word-break:break-all;}',
      '.ngaext-settings-close{float:right;border:0;background:transparent;font-size:18px;color:#8A6A22;cursor:pointer;}',

      'html.ngaext-night .ngaext-card{background:linear-gradient(180deg,#241F19 0%,#1C1813 100%) !important;',
      'border-color:#6B5730 !important;color:#E9DFCB !important;',
      'box-shadow:0 2px 12px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.04) !important;}',
      'html.ngaext-night .ngaext-card:after{border-color:rgba(216,180,95,.28);}',
      'html.ngaext-night .ngaext-title{color:#D8B45F !important;}',
      'html.ngaext-night .ngaext-idx{color:#9A8A6C !important;}',
      'html.ngaext-night .ngaext-body{color:#E9DFCB !important;}',
      'html.ngaext-night .ngaext-head{border-bottom-color:rgba(216,180,95,.22);}',
      'html.ngaext-night .ngaext-foot{border-top-color:rgba(216,180,95,.26);color:#A8987A !important;}',
      'html.ngaext-night .ngaext-tag{color:#D8B45F !important;}',
      'html.ngaext-night .ngaext-mode,html.ngaext-night .ngaext-more{background:#2A241C !important;',
      'border-color:#6B5730 !important;color:#D8B45F !important;}',
      'html.ngaext-night .ngaext-act{color:#C9A85F !important;}',
      'html.ngaext-night .ngaext-fade{background:linear-gradient(180deg,rgba(28,24,19,0) 0%,rgba(28,24,19,.92) 70%,#1C1813 100%);}',
      'html.ngaext-night .ngaext-err{color:#E08A7A !important;}',
      'html.ngaext-night .ngaext-load{color:#A8987A !important;}',
      'html.ngaext-night .ngaext-settings,html.ngaext-night .ngaext-set-btn,html.ngaext-night .ngaext-pwbox button,',
      'html.ngaext-night .ngaext-notice button{background:#2A241C !important;border-color:#6B5730 !important;color:#D8B45F !important;}',
      'html.ngaext-night .ngaext-notice{background:#2A241C;border-color:#6B5730;color:#E9DFCB;}',
      'html.ngaext-night .ngaext-pwbox input{background:#2A241C;border-color:#6B5730;color:#E9DFCB;}',
      'html.ngaext-night .ngaext-settings-box{background:#1C1813;border-color:#6B5730;color:#E9DFCB;}',
      'html.ngaext-night .ngaext-settings-box h3{color:#E9DFCB;}',
      'html.ngaext-night .ngaext-settings-highlight{background:#2A241C;border-color:#6B5730;}',
      'html.ngaext-night .ngaext-settings-highlight b{color:#F0D58A;}',
      'html.ngaext-night .ngaext-settings-sub{color:#A8987A;}',
      'html.ngaext-night .ngaext-set-btn.on{background:#D8B45F;color:#1C1813;}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- 卡片 ---------- */
  function makeCard(idxLabel) {
    ensureStyle();
    var card = document.createElement('div');
    card.className = 'ngaext-card';
    card.innerHTML =
      '<div class="ngaext-head"><span class="ngaext-dot"></span>' +
      '<span class="ngaext-title">网页文本已转译到此处</span>' +
      '<span class="ngaext-idx">' + (idxLabel || '') + '</span>' +
      '<button class="ngaext-mode" title="切换夜色模式">' + (isDark() ? '☀' : '☾') + '</button>' +
      '<button class="ngaext-settings" title="插件设置">⚙</button></div>' +
      '<div class="ngaext-main"><div class="ngaext-load">正在解析外链…</div></div>' +
      '<div class="ngaext-foot"><span class="ngaext-tag">解析中</span><span class="ngaext-src"></span></div>';
    var btn = card.querySelector('.ngaext-mode');
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); toggleDark();
    });
    var setBtn = card.querySelector('.ngaext-settings');
    if (setBtn) {
      setBtn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); openSettings();
      });
    }
    return card;
  }

  function addAction(foot, label, handler) {
    var b = document.createElement('button');
    b.className = 'ngaext-act';
    b.textContent = label;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); handler(); });
    foot.appendChild(b);
    return b;
  }

  function showServiceNotice(detail) {
    if (serviceNoticeShown) return;
    serviceNoticeShown = true;
    try {
      var host = document.querySelector('.wrapBox') || document.body;
      if (!host) return;
      var box = document.createElement('div');
      box.className = 'ngaext-notice';
      box.innerHTML = '<div><b>无法检测到 disroot 内容。</b></div>' +
        '<div>请先确认 disroot 服务是否正常（可搜索 disroot 状态），或重装 NGA 和插件后重试。</div>' +
        '<div style="font-size:12px;opacity:.75;margin-top:4px;"></div>' +
        '<button type="button">知道了</button>';
      var d = box.querySelector('div[style]');
      if (d) d.textContent = detail || '';
      box.querySelector('button').addEventListener('click', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      });
      host.insertBefore(box, host.firstChild);
    } catch (e) {}
  }

  function showCapNotice() {
    if (capNoticeShown) return;
    capNoticeShown = true;
    try {
      var host = document.querySelector('.wrapBox') || document.body;
      if (!host) return;
      var box = document.createElement('div');
      box.className = 'ngaext-notice';
      box.innerHTML = '<div><b>本页链接较多，只解析了前面的内容。</b></div>' +
        '<div>单楼层最多 ' + MAX_LINKS_PER_BLOCK + ' 条、整页最多 ' + MAX_CARDS + ' 条，请分页查看。</div>' +
        '<button type="button">知道了</button>';
      box.querySelector('button').addEventListener('click', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      });
      host.insertBefore(box, host.firstChild);
    } catch (e) {}
  }

  function showPasswordInput(card, ctx) {
    try {
      var main = card.querySelector('.ngaext-main');
      if (!main) return;
      var old = main.querySelector('.ngaext-pwbox');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var box = document.createElement('div');
      box.className = 'ngaext-pwbox';
      var input = document.createElement('input');
      input.type = 'password';
      input.placeholder = '输入本帖密码';
      input.autocomplete = 'off';
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = '确定';
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      box.appendChild(input);
      box.appendChild(ok);
      box.appendChild(cancel);
      main.appendChild(box);
      input.focus();
      ok.addEventListener('click', function () {
        var pw = (input.value || '').trim();
        if (!pw) { input.focus(); return; }
        var tk = threadKey();
        if (tk) rememberPw(tk, pw);
        ctx.pws = [pw].concat(ctx.pws || []);
        if (box.parentNode) box.parentNode.removeChild(box);
        retry(card, ctx);
      });
      cancel.addEventListener('click', function () {
        if (box.parentNode) box.parentNode.removeChild(box);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
      });
    } catch (e) {}
  }

  function openSettings() {
    try {
      var old = document.getElementById('ngaext-settings-panel');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var panel = document.createElement('div');
      panel.id = 'ngaext-settings-panel';
      panel.className = 'ngaext-settings-panel';
      panel.innerHTML =
        '<div class="ngaext-settings-box">' +
        '<button class="ngaext-settings-close" type="button">×</button>' +
        '<h3>NGA 转译设置</h3>' +
        '<div class="ngaext-settings-highlight">' +
        '<div><b>直接显示全文</b><div class="ngaext-settings-sub">开启后卡片不再折叠，正文直接展示完整内容</div></div>' +
        '<button class="ngaext-set-btn ngaext-full-toggle" data-full type="button"></button></div>' +
        '<div style="font-size:12px;color:#8B7857;">GitHub 仓库</div>' +
        '<a class="ngaext-set-link" href="' + REPO_URL + '" target="_blank" rel="noopener">' + REPO_URL + '</a>' +
        '<div style="font-size:12px;color:#8B7857;">支持站点：bin.disroot.org / paste.disroot.org / paste.to</div>' +
        '<div class="ngaext-settings-row"><span>夜色模式</span><button class="ngaext-set-btn" data-dark type="button"></button></div>' +
        '<div class="ngaext-settings-row"><span>正文预览</span>' +
        '<button class="ngaext-set-btn" data-pv="800" type="button">800 字</button>' +
        '<button class="ngaext-set-btn" data-pv="3000" type="button">3000 字</button>' +
        '<button class="ngaext-set-btn" data-pv="8000" type="button">8000 字</button></div>' +
        '<div class="ngaext-settings-row">' +
        '<button class="ngaext-set-btn" data-cache type="button">清理解密缓存</button>' +
        '<button class="ngaext-set-btn" data-pw type="button">清除密码记忆</button></div>' +
        '<div style="font-size:12px;color:#8B7857;margin-top:8px;">退出帖子会自动清理解密缓存；密码只保存在本机。</div>' +
        '<div class="ngaext-settings-status" style="font-size:12px;color:#2E7D4F;margin-top:6px;"></div>' +
        '</div>';
      document.body.appendChild(panel);

      var status = panel.querySelector('.ngaext-settings-status');
      var darkBtn = panel.querySelector('[data-dark]');
      darkBtn.textContent = isDark() ? '已开启' : '已关闭';
      darkBtn.classList.toggle('on', isDark());
      darkBtn.addEventListener('click', function () {
        toggleDark();
        darkBtn.textContent = isDark() ? '已开启' : '已关闭';
        darkBtn.classList.toggle('on', isDark());
      });

      var fullBtn = panel.querySelector('[data-full]');
      function paintFull() {
        fullBtn.textContent = showFull() ? '已开启' : '已关闭';
        fullBtn.classList.toggle('on', showFull());
      }
      paintFull();
      fullBtn.addEventListener('click', function () {
        var on = !showFull();
        try { localStorage.setItem(SHOW_FULL_KEY, on ? '1' : '0'); } catch (e) {}
        paintFull();
        if (on) {
          // 立即把当前已有的折叠卡片展开，不只影响后续卡片
          var more = document.querySelectorAll('.ngaext-more');
          for (var m = 0; m < more.length; m++) {
            try { more[m].click(); } catch (e) {}
          }
        }
        status.textContent = on
          ? '已开启：当前和后续卡片都直接显示全文。'
          : '已关闭：后续卡片恢复按预览长度折叠。';
      });

      var pvBtns = panel.querySelectorAll('[data-pv]');
      for (var i = 0; i < pvBtns.length; i++) {
        pvBtns[i].classList.toggle('on', parseInt(pvBtns[i].getAttribute('data-pv'), 10) === previewLen());
        pvBtns[i].addEventListener('click', function () {
          var v = this.getAttribute('data-pv');
          try { localStorage.setItem(PREVIEW_KEY, v); } catch (e) {}
          for (var j = 0; j < pvBtns.length; j++) pvBtns[j].classList.remove('on');
          this.classList.add('on');
          status.textContent = '预览长度已改为 ' + v + ' 字，新解析的卡片生效。';
        });
      }

      panel.querySelector('[data-cache]').addEventListener('click', function () {
        try {
          if (window[BRIDGE] && window[BRIDGE].clearCache) window[BRIDGE].clearCache();
          cache = {};
          status.textContent = '解密缓存已清理。';
        } catch (e) { status.textContent = '清理失败，请重试。'; }
      });
      panel.querySelector('[data-pw]').addEventListener('click', function () {
        clearPasswordStore();
        stickyPw = '';
        status.textContent = '本机密码记忆已清除。';
      });
      panel.querySelector('.ngaext-settings-close').addEventListener('click', function () {
        if (panel.parentNode) panel.parentNode.removeChild(panel);
      });
      panel.addEventListener('click', function (e) {
        if (e.target === panel) panel.parentNode.removeChild(panel);
      });
    } catch (e) {}
  }

  function fillCard(card, payload, ctx) {
    try {
      if (!card || !card.parentNode) return;
      var main = card.querySelector('.ngaext-main');
      var tag = card.querySelector('.ngaext-tag');
      var src = card.querySelector('.ngaext-src');
      var foot = card.querySelector('.ngaext-foot');
      if (!main || !tag || !src) return;

      var old = foot.querySelectorAll('.ngaext-act');
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);

      if (!payload || !payload.ok) {
        tag.textContent = '解析失败';
        main.innerHTML = '<div class="ngaext-err"></div>';
        var errText = (payload && payload.error) || '未知错误';
        var e = main.querySelector('.ngaext-err');
        if (e) e.textContent = errText;
        src.textContent = '';
        if (/PrivateBin|维护|HTTP|Failed to connect|UnknownHost|连接|超时/i.test(errText)) {
          showServiceNotice(errText);
        }
        if (ctx && ctx.url) {
          addAction(foot, '输入密码', function () { showPasswordInput(card, ctx); });
          addAction(foot, '重试', function () { retry(card, ctx); });
          addAction(foot, '打开原链', function () { openUrl(ctx.url); });
        }
        return;
      }

      var full = String(payload.text || '');
      if (full.length > TEXT_CAP) full = full.substring(0, TEXT_CAP) + '\n\n…（内容过长，已截断）';
      tag.textContent = '已本地解密';
      src.textContent = (payload.domain || '') + ' · ' + full.length + ' 字';

      addAction(foot, '复制', function () { copyText(full, tag); });
      if (ctx && ctx.url) {
        addAction(foot, '原链', function () { openUrl(ctx.url); });
      }

      var preview = previewLen();
      if (showFull() || full.length <= preview) {
        main.innerHTML = '<div class="ngaext-body"></div>';
        main.querySelector('.ngaext-body').textContent = full;
        return;
      }

      main.innerHTML = '<div class="ngaext-wrap"><div class="ngaext-body"></div><div class="ngaext-fade"></div></div>' +
        '<button class="ngaext-more">展开全文（共 ' + full.length + ' 字）</button>';
      var body = main.querySelector('.ngaext-body');
      var fade = main.querySelector('.ngaext-fade');
      var more = main.querySelector('.ngaext-more');
      body.textContent = full.substring(0, preview);
      more.addEventListener('click', function () {
        body.textContent = full;
        fade.style.display = 'none';
        more.style.display = 'none';
        src.textContent = (payload.domain || '') + ' · 全文 ' + full.length + ' 字';
      });
    } catch (e) {}
  }

  function copyText(text, tag) {
    function done(ok) {
      var old = tag.textContent;
      tag.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { tag.textContent = old; }, 1200);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      done(ok);
    } catch (e) { done(false); }
  }

  function openUrl(url) {
    try {
      var a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {}
  }

  function retry(card, ctx) {
    var main = card.querySelector('.ngaext-main');
    var tag = card.querySelector('.ngaext-tag');
    var foot = card.querySelector('.ngaext-foot');
    var acts = foot.querySelectorAll('.ngaext-act');
    for (var i = 0; i < acts.length; i++) acts[i].parentNode.removeChild(acts[i]);
    main.innerHTML = '<div class="ngaext-load">正在重试…</div>';
    tag.textContent = '解析中';
    delete cache[ctx.url];
    var cbId = 'cb' + (++seq);
    callbacks[cbId] = { card: card, url: ctx.url, pws: ctx.pws || [] };
    queue.push({ cbId: cbId, url: ctx.url, pws: ctx.pws || [] });
    pump();
  }

  /* ---------- 调度 ---------- */
  function armTimeout(cbId, cb) {
    cb.timer = setTimeout(function () {
      var c = callbacks[cbId];
      if (!c) return;
      delete callbacks[cbId];
      inflight = Math.max(0, inflight - 1);
      fillCard(c.card, { ok: false, error: '解析超时，请重试' }, c);
      pump();
    }, REQUEST_TIMEOUT);
  }

  function pump() {
    while (inflight < CONCURRENCY && queue.length > 0) {
      var job = queue.shift();
      var cb = callbacks[job.cbId];
      if (!cb) continue;
      inflight++;
      try {
        window[BRIDGE].request(job.cbId, job.url, JSON.stringify(job.pws || []));
        armTimeout(job.cbId, cb);
      } catch (e) {
        inflight--;
        if (cb) fillCard(cb.card, { ok: false, error: '桥接调用失败' }, cb);
        delete callbacks[job.cbId];
      }
    }
  }

  function onResult(cbId, jsonStr) {
    var cb = callbacks[cbId];
    if (!cb) return; // 已超时或已处理，避免重复递减 inflight
    delete callbacks[cbId];
    if (cb.timer) clearTimeout(cb.timer);
    inflight = Math.max(0, inflight - 1);
    try {
      var payload;
      try { payload = JSON.parse(jsonStr); } catch (e) { payload = { ok: false, error: '结果解析失败' }; }
      if (payload && payload.ok) cache[cb.url] = payload;
      fillCard(cb.card, payload, cb);
    } catch (e) {
    } finally {
      pump();
    }
  }

  function isNestedUnit(node) {
    return !!(node && node.nodeType === 1 && node.classList &&
      (node.classList.contains('commentItem') || node.classList.contains('replyItem') ||
       node.classList.contains('subCommentItem') || node.classList.contains('subFloorItem') ||
       node.classList.contains('comment-item') || node.classList.contains('reply-item') ||
       node.classList.contains('comment') || node.classList.contains('reply') ||
       node.classList.contains('subcomment') || node.classList.contains('subreply')));
  }

  function insideColumn(node) {
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('columnItem')) return true;
      node = node.parentNode;
    }
    return false;
  }

  function hasNestedUnitAncestor(node) {
    node = node && node.parentNode;
    while (node && node !== document.body) {
      if (isNestedUnit(node)) return true;
      node = node.parentNode;
    }
    return false;
  }

  /** 楼层 + 独立楼中楼容器；楼中楼若在楼层内部，文本已随楼层一起扫描 */
  function collectUnits() {
    var out = [];
    var cols = document.querySelectorAll('.columnItem');
    for (var i = 0; i < cols.length; i++) out.push({ el: cols[i], byItem: true });

    var extra = document.querySelectorAll('.commentItem,.replyItem,.subCommentItem,.subFloorItem,.comment-item,.reply-item,.comment,.reply,.subcomment,.subreply');
    for (var j = 0; j < extra.length; j++) {
      var el = extra[j];
      if (insideColumn(el) || hasNestedUnitAncestor(el)) continue;
      out.push({ el: el, byItem: false });
    }

    if (out.length === 0) {
      var blocks = document.querySelectorAll('.articleBlock');
      for (var k = 0; k < blocks.length; k++) out.push({ el: blocks[k], byItem: false });
    }
    return out;
  }

  function scan() {
    try {
      showVersionBanner();
      var units = collectUnits();

      var tkey = threadKey();
      var entry = threadEntry(tkey);
      var stickyPw = entry.sticky;
      var capped = false;

      for (var i = 0; i < units.length; i++) {
        var unit = units[i].el;
        var byItem = units[i].byItem;
        if (unit.getAttribute('data-ngaext')) continue;

        var text = textOf(unit);

        var pwd = findPassword(text);
        if (pwd) {
          rememberPw(tkey, pwd);
          if (isStickyPassword(text)) {
            stickyPw = pwd;
            setStickyPw(tkey, pwd);
          }
          if (!entry.pws) entry.pws = [];
          if (entry.pws.indexOf(pwd) < 0) entry.pws.push(pwd);
        }

        var links = findLinks(text);
        if (links.length >= MAX_LINKS_PER_BLOCK) capped = true;
        if (links.length === 0) { unit.setAttribute('data-ngaext', 'none'); continue; }

        var pws = candidatesFor(pwd, stickyPw, entry.pws);
        var anchor = byItem ? (unit.querySelector('.articleBlock') || unit) : unit;
        if (!anchor || !anchor.parentNode) continue;
        var made = 0;
        for (var k = 0; k < links.length; k++) {
          if (cardCount() >= MAX_CARDS) { capped = true; break; }
          var url = links[k];
          var card = makeCard(links.length > 1 ? ('外链 ' + (k + 1) + '/' + links.length) : '');
          anchor.parentNode.insertBefore(card, anchor.nextSibling);
          anchor = card;
          made++;

          var cached = cache[url];
          if (cached) { fillCard(card, cached, { url: url, pws: pws }); continue; }

          var cbId = 'cb' + (++seq);
          callbacks[cbId] = { card: card, url: url, pws: pws };
          queue.push({ cbId: cbId, url: url, pws: pws });
        }
        unit.setAttribute('data-ngaext', made > 0 ? 'pending' : 'skipped');
      }
      if (capped) showCapNotice();
      pump();
    } catch (e) {}
  }

  window.__ngaext = {
    scan: scan,
    onResult: onResult,
    toggleDark: toggleDark,
    _dbg: { threadKey: threadKey, entry: threadEntry, cands: candidatesFor, pw: findPassword,
            links: findLinks, cardCount: cardCount }
  };

  function unitOf(node) {
    var block = null;
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList) {
        if (node.classList.contains('columnItem')) return node;
        if (!block && node.classList.contains('articleBlock')) block = node;
        if (!block && isNestedUnit(node) && !insideColumn(node)) block = node;
      }
      node = node.parentNode;
    }
    return block;
  }

  function insideCard(node) {
    while (node && node !== document.body) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('ngaext-card')) return true;
      node = node.parentNode;
    }
    return false;
  }

  function isCardNode(node) {
    return node && node.nodeType === 1 && node.classList && node.classList.contains('ngaext-card');
  }

  function isMediaNode(node) {
    return node && node.nodeType === 1 &&
      /^(IMG|PICTURE|SOURCE|SVG|CANVAS|VIDEO|AUDIO|IFRAME)$/.test(node.tagName || '');
  }

  /** 楼层内容变化后先移除旧卡片，避免重复插入 */
  function removeCardsFor(unit) {
    if (unit.querySelectorAll) {
      var cards = unit.querySelectorAll('.ngaext-card');
      for (var i = cards.length - 1; i >= 0; i--) {
        if (cards[i].parentNode) cards[i].parentNode.removeChild(cards[i]);
      }
    }
    var n = unit.nextElementSibling;
    while (n && isCardNode(n)) {
      var next = n.nextElementSibling;
      n.parentNode.removeChild(n);
      n = next;
    }
  }

  /** 页面自身刷新楼层内容时清掉标记，让 scan 重新识别；忽略插件自己插/删卡片产生的变更 */
  function onMutations(muts) {
    var dirty = [];
    var relevant = false;
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (insideCard(m.target)) continue;
      if (m.type === 'childList' && (m.addedNodes.length + m.removedNodes.length) > 0) {
        var onlyCards = true;
        for (var a = 0; a < m.addedNodes.length; a++) {
          var an = m.addedNodes[a];
          if (!isCardNode(an) && !isMediaNode(an)) { onlyCards = false; break; }
        }
        if (onlyCards) {
          for (var r = 0; r < m.removedNodes.length; r++) {
            var rn = m.removedNodes[r];
            if (!isCardNode(rn) && !isMediaNode(rn)) { onlyCards = false; break; }
          }
        }
        if (onlyCards) continue;
      }
      relevant = true;
      var u = unitOf(m.target);
      if (u) dirty.push(u);
    }
    if (!relevant) return;
    for (var k = 0; k < dirty.length; k++) {
      removeCardsFor(dirty[k]);
      dirty[k].removeAttribute('data-ngaext');
    }
    scan();
  }

  var autoStarted = false;
  function startAuto() {
    if (autoStarted || !document.body) return;
    autoStarted = true;
    try {
      new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (e) {}
    setInterval(scan, 1200);
  }

  var _scan = scan;
  scan = function () { startAuto(); _scan(); };
  window.__ngaext.scan = scan;

  scan();
  document.addEventListener('DOMContentLoaded', function () { scan(); });
})();
