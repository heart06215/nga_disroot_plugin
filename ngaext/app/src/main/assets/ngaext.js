(function () {
  if (window.__ngaext_init) { try { window.__ngaext.scan(); } catch (e) {} return; }
  window.__ngaext_init = true;

  var PREVIEW = 800;
  var MAX_LINKS_PER_BLOCK = 120;
  var MAX_CARDS = 240;
  var TEXT_CAP = 200000;
  var CONCURRENCY = 6;
  var BRIDGE = 'NgaExtBridge';
  var STYLE_ID = 'ngaext-style-v7';
  var DARK_KEY = 'ngaext.dark';
  var REQUEST_TIMEOUT = 45000;

  var callbacks = {};
  var cache = {};
  var queue = [];
  var inflight = 0;
  var seq = 0;
  var stickyPw = '';

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

  /** 用楼主 UID 当帖子标识：同帖翻页稳定，换帖必变 */
  function threadKey() {
    try {
      var first = document.querySelector('.columnItem');
      if (!first) return '';
      var m = (first.innerHTML || '').match(/doAction\(304,\[\s*'(\d+)'\s*\]\)/);
      if (m) return 'u' + m[1];
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
      while (e.pws.length > 20) e.pws.shift();
    }
    s[key] = e;
    var keys = Object.keys(s);
    while (keys.length > 5) { delete s[keys[0]]; keys = Object.keys(s); }
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
      '.ngaext-card{position:relative;margin:10px 2px 8px 2px;padding:13px 15px 12px 17px;',
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
      'html.ngaext-night .ngaext-load{color:#A8987A !important;}'
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
      '<button class="ngaext-mode" title="切换夜色模式">' + (isDark() ? '☀' : '☾') + '</button></div>' +
      '<div class="ngaext-main"><div class="ngaext-load">正在解析外链…</div></div>' +
      '<div class="ngaext-foot"><span class="ngaext-tag">解析中</span><span class="ngaext-src"></span></div>';
    var btn = card.querySelector('.ngaext-mode');
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); toggleDark();
    });
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
        var e = main.querySelector('.ngaext-err');
        if (e) e.textContent = (payload && payload.error) || '未知错误';
        src.textContent = '';
        if (ctx && ctx.url) {
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

      if (full.length <= PREVIEW) {
        main.innerHTML = '<div class="ngaext-body"></div>';
        main.querySelector('.ngaext-body').textContent = full;
        return;
      }

      main.innerHTML = '<div class="ngaext-wrap"><div class="ngaext-body"></div><div class="ngaext-fade"></div></div>' +
        '<button class="ngaext-more">展开全文（共 ' + full.length + ' 字）</button>';
      var body = main.querySelector('.ngaext-body');
      var fade = main.querySelector('.ngaext-fade');
      var more = main.querySelector('.ngaext-more');
      body.textContent = full.substring(0, PREVIEW);
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

  function scan() {
    try {
      showVersionBanner();
      var scope = document.querySelectorAll('.columnItem');
      var byItem = scope.length > 0;
      var units = byItem ? scope : document.querySelectorAll('.articleBlock');

      var tkey = threadKey();
      var entry = threadEntry(tkey);
      var stickyPw = entry.sticky;

      for (var i = 0; i < units.length; i++) {
        var unit = units[i];
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
        if (links.length === 0) { unit.setAttribute('data-ngaext', 'none'); continue; }

        var pws = candidatesFor(pwd, stickyPw, entry.pws);
        var anchor = byItem ? (unit.querySelector('.articleBlock') || unit) : unit;
        var made = 0;
        for (var k = 0; k < links.length; k++) {
          if (cardCount() >= MAX_CARDS) break;
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
