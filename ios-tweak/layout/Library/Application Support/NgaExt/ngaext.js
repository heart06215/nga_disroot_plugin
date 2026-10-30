/*
 * NGAExt iOS 注入脚本（WKWebView / iOS 15+）
 *
 * 与 Android 版的差异：
 *  - 原生化请求改为 WKScriptMessageHandler：window.webkit.messageHandlers.ngaext
 *  - 解密在 JS 侧完成（WebCrypto + DecompressionStream），原生只负责绕过 CORS 抓取密文
 *  - DecompressionStream('deflate-raw') 需要 iOS 16.4+；更低系统需要补 JS inflate
 *
 * 说明：这是未在 iOS 实机验证的移植骨架，NGA iOS 客户端的 DOM 结构可能与
 * Android 端不同，必要时调整 .columnItem / .articleBlock 选择器。
 */
(function () {
  if (window.__ngaext_init) { try { window.__ngaext.scan(); } catch (e) {} return; }
  window.__ngaext_init = true;

  var PREVIEW = 800;
  var MAX_LINKS_PER_BLOCK = 120;
  var MAX_CARDS = 240;
  var TEXT_CAP = 200000;
  var CONCURRENCY = 4;
  var REQUEST_TIMEOUT = 45000;
  var HANDLER = 'ngaext';
  var STYLE_ID = 'ngaext-ios-style';
  var STORE_KEY = 'ngaext.ios.pwstore.v1';

  var callbacks = {};
  var cache = {};
  var queue = [];
  var inflight = 0;
  var seq = 0;

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
    var m = text.match(/密码[^A-Za-z0-9]{0,8}([A-Za-z0-9!@#$%^&*_\-]{2,40})(?![A-Za-z0-9.\/])/);
    if (!m) return '';
    var v = m[1];
    if (/^(bin|paste|http|https|www|disroot|org|com|net|cn)$/i.test(v)) return '';
    return v;
  }
  function isStickyPassword(text) {
    return /密码[^。\n]{0,10}(全|都|统一|均)|(后面|以下|之后|接下来)[^。\n]{0,10}密码/.test(text);
  }

  function loadStore() {
    try { var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return (s && typeof s === 'object') ? s : {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
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
  function rememberPw(key, p) {
    if (!key || !p || p.length < 3) return;
    var s = loadStore(); var e = s[key] || { sticky: '', pws: [] };
    if (!Array.isArray(e.pws)) e.pws = [];
    if (e.pws.indexOf(p) < 0) { e.pws.push(p); while (e.pws.length > 20) e.pws.shift(); }
    s[key] = e;
    var keys = Object.keys(s);
    while (keys.length > 5) { delete s[keys[0]]; keys = Object.keys(s); }
    saveStore(s);
  }
  function setStickyPw(key, p) {
    if (!key) return;
    var s = loadStore(); var e = s[key] || { sticky: '', pws: [] };
    e.sticky = p; s[key] = e; saveStore(s);
  }
  function candidatesFor(floorPw, sticky, memory) {
    var out = [];
    function add(p) { if (p && out.indexOf(p) < 0 && out.length < 5) out.push(p); }
    add(floorPw); add(sticky);
    for (var i = (memory || []).length - 1; i >= 0; i--) add(memory[i]);
    return out;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.ngaext-card{position:relative;margin:10px 2px 8px;padding:13px 15px 12px 17px;' +
      'background:linear-gradient(180deg,#FDF9F1,#FAF3E6);border:1px solid #D8BE84;' +
      'border-radius:9px;box-shadow:0 2px 10px rgba(160,120,40,.14);color:#2F271C;' +
      'font-size:15px;line-height:1.72;font-family:-apple-system,sans-serif;overflow:hidden;}' +
      '.ngaext-head{display:flex;align-items:center;gap:7px;margin-bottom:7px;padding-bottom:7px;' +
      'border-bottom:1px solid rgba(200,164,77,.3);}' +
      '.ngaext-title{font-size:13px;font-weight:700;color:#8A6A22;}' +
      '.ngaext-idx{margin-left:auto;font-size:11px;color:#A08B63;}' +
      '.ngaext-mode{width:24px;height:24px;padding:0;border:1px solid #D8BE84;border-radius:50%;' +
      'background:#FFFDF8;color:#8A6A22;font-size:13px;}' +
      '.ngaext-body{white-space:pre-wrap;word-break:break-word;}' +
      '.ngaext-foot{margin-top:10px;padding-top:6px;border-top:1px dashed rgba(200,164,77,.4);' +
      'font-size:12px;color:#8B7857;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.ngaext-tag{color:#A98530;font-weight:600;}' +
      '.ngaext-src{margin-right:auto;}' +
      '.ngaext-act{background:transparent;border:0;color:#8A6A22;font-size:12px;padding:2px 4px;}' +
      '.ngaext-err{color:#9A3B2E;font-size:13px;}' +
      '.ngaext-load{color:#8B7857;font-size:13px;}' +
      'html.ngaext-night .ngaext-card{background:#241F19;border-color:#6B5730;color:#E9DFCB;}' +
      'html.ngaext-night .ngaext-title{color:#D8B45F;}html.ngaext-night .ngaext-body{color:#E9DFCB;}' +
      'html.ngaext-night .ngaext-mode{background:#2A241C;border-color:#6B5730;color:#D8B45F;}';
    (document.head || document.documentElement).appendChild(st);
  }
  function isDark() { try { return localStorage.getItem('ngaext.dark') === '1'; } catch (e) { return false; } }
  function toggleDark() {
    var on = !isDark();
    try { localStorage.setItem('ngaext.dark', on ? '1' : '0'); } catch (e) {}
    try { document.documentElement.classList.toggle('ngaext-night', on); } catch (e) {}
    var btns = document.querySelectorAll('.ngaext-mode');
    for (var i = 0; i < btns.length; i++) btns[i].textContent = on ? '☀' : '☾';
  }

  function makeCard(label) {
    ensureStyle();
    var card = document.createElement('div');
    card.className = 'ngaext-card';
    card.innerHTML =
      '<div class="ngaext-head"><span class="ngaext-title">网页文本已转译到此处</span>' +
      '<span class="ngaext-idx">' + (label || '') + '</span>' +
      '<button class="ngaext-mode">' + (isDark() ? '☀' : '☾') + '</button></div>' +
      '<div class="ngaext-main"><div class="ngaext-load">正在解析外链…</div></div>' +
      '<div class="ngaext-foot"><span class="ngaext-tag">解析中</span><span class="ngaext-src"></span></div>';
    card.querySelector('.ngaext-mode').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); toggleDark();
    });
    return card;
  }
  function addAction(foot, label, handler) {
    var b = document.createElement('button');
    b.className = 'ngaext-act'; b.textContent = label;
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); handler(); });
    foot.appendChild(b);
  }
  function fillCard(card, payload, ctx) {
    try {
      if (!card || !card.parentNode) return;
      var main = card.querySelector('.ngaext-main');
      var tag = card.querySelector('.ngaext-tag');
      var src = card.querySelector('.ngaext-src');
      var foot = card.querySelector('.ngaext-foot');
      var old = foot.querySelectorAll('.ngaext-act');
      for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
      if (!payload || !payload.ok) {
        tag.textContent = '解析失败';
        main.innerHTML = '<div class="ngaext-err"></div>';
        main.querySelector('.ngaext-err').textContent = (payload && payload.error) || '未知错误';
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
      if (ctx && ctx.url) addAction(foot, '原链', function () { openUrl(ctx.url); });
      if (full.length <= PREVIEW) {
        main.innerHTML = '<div class="ngaext-body"></div>';
        main.querySelector('.ngaext-body').textContent = full;
      } else {
        main.innerHTML = '<div class="ngaext-body"></div><button class="ngaext-act more">展开全文（共 ' +
          full.length + ' 字）</button>';
        var body = main.querySelector('.ngaext-body');
        var more = main.querySelector('.more');
        body.textContent = full.substring(0, PREVIEW);
        more.addEventListener('click', function () { body.textContent = full; more.style.display = 'none'; });
      }
    } catch (e) {}
  }
  function copyText(text, tag) {
    var old = tag.textContent;
    function done(ok) { tag.textContent = ok ? '已复制' : '复制失败'; setTimeout(function () { tag.textContent = old; }, 1200); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea'); ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy'); document.body.removeChild(ta); done(ok);
    } catch (e) { done(false); }
  }
  function openUrl(url) { try { window.open(url, '_blank'); } catch (e) {} }
  function textOf(el) {
    try {
      var clone = el.cloneNode(true);
      var cards = clone.querySelectorAll('.ngaext-card');
      for (var i = 0; i < cards.length; i++) if (cards[i].parentNode) cards[i].parentNode.removeChild(cards[i]);
      return clone.textContent || '';
    } catch (e) { return el.textContent || ''; }
  }
  function cardCount() { return document.querySelectorAll('.ngaext-card').length; }

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

  function nativeRequest(cbId, url, pws) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[HANDLER]) {
      window.webkit.messageHandlers[HANDLER].postMessage({ cbId: cbId, url: url, passwords: pws });
      return;
    }
    if (window.NgaExtBridge && window.NgaExtBridge.request) {
      window.NgaExtBridge.request(cbId, url, JSON.stringify(pws));
      return;
    }
    throw new Error('原生桥接不可用');
  }
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
        nativeRequest(job.cbId, job.url, job.pws || []);
        armTimeout(job.cbId, cb);
      } catch (e) {
        inflight--;
        fillCard(cb.card, { ok: false, error: String(e.message || e) }, cb);
        delete callbacks[job.cbId];
      }
    }
  }

  function onResult(cbId, jsonStr) {
    var cb = callbacks[cbId];
    if (!cb) return;
    delete callbacks[cbId];
    if (cb.timer) clearTimeout(cb.timer);
    inflight = Math.max(0, inflight - 1);
    var msg;
    try { msg = JSON.parse(jsonStr); } catch (e) { msg = { ok: false, error: '结果解析失败' }; }
    if (!msg || !msg.ok) {
      fillCard(cb.card, { ok: false, error: (msg && msg.error) || '抓取失败' }, cb);
      pump();
      return;
    }
    PrivateBin.decrypt(msg.body, cb.url, cb.pws).then(function (payload) {
      if (payload && payload.ok) cache[cb.url] = payload;
      fillCard(cb.card, payload, cb);
      pump();
    }).catch(function (e) {
      fillCard(cb.card, { ok: false, error: String(e && e.message || e) }, cb);
      pump();
    });
  }

  function scan() {
    try {
      var scope = document.querySelectorAll('.columnItem');
      var byItem = scope.length > 0;
      var units = byItem ? scope : document.querySelectorAll('.articleBlock');
      var tkey = threadKey();
      var store = loadStore();
      var entry = store[tkey] || { sticky: '', pws: [] };
      var stickyPw = entry.sticky || '';
      for (var i = 0; i < units.length; i++) {
        var unit = units[i];
        if (unit.getAttribute('data-ngaext')) continue;
        var text = textOf(unit);
        var pwd = findPassword(text);
        if (pwd) {
          rememberPw(tkey, pwd);
          if (isStickyPassword(text)) { stickyPw = pwd; setStickyPw(tkey, pwd); }
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
          anchor = card; made++;
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

  /* ---------- PrivateBin v2 解密（WebCrypto） ---------- */
  var PrivateBin = (function () {
    var B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    function b64(s) {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    function b58(s) {
      var n = 0n, base = 58n;
      for (var i = 0; i < s.length; i++) {
        var d = B58.indexOf(s.charAt(i));
        if (d < 0) throw new Error('非法 base58');
        n = n * base + BigInt(d);
      }
      var hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
      var mag = hex === '00' || hex === '0' ? new Uint8Array(0) : new Uint8Array(hex.match(/../g).map(function (h) { return parseInt(h, 16); }));
      var zeros = 0; while (zeros < s.length && s.charAt(zeros) === '1') zeros++;
      var out = new Uint8Array(zeros + mag.length);
      out.set(mag, zeros);
      return out;
    }
    function pad32(b) {
      if (b.length === 32) return b;
      if (b.length > 32) return null;
      var o = new Uint8Array(32); o.set(b, 32 - b.length); return o;
    }
    function keyLengths(frag) {
      var out = [], cands = [44, 43, 45, 46];
      for (var i = 0; i < cands.length; i++) {
        var l = cands[i]; if (l > frag.length) continue;
        try { if (b58(frag.slice(0, l)).length === 32) out.push(l); } catch (e) {}
      }
      if (!out.length) { out = [Math.min(46, frag.length), 44, 43, 45]; }
      return out;
    }
    function extractArray(s, start) {
      if (start < 0 || s.charAt(start) !== '[') return null;
      var depth = 0, inStr = false, esc = false;
      for (var i = start; i < s.length; i++) {
        var c = s.charAt(i);
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') inStr = true;
          else if (c === '[') depth++;
          else if (c === ']') { depth--; if (depth === 0) return s.substring(start, i + 1); }
        }
      }
      return null;
    }
    function unescape(s) { return s.replace(/\\\//g, '/'); }
    async function inflateRaw(bytes) {
      if (typeof DecompressionStream === 'undefined') throw new Error('需要 iOS 16.4+（DecompressionStream）');
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    function pasteOf(text) {
      try { var j = JSON.parse(text); if (j && typeof j.paste === 'string') return j.paste; } catch (e) {}
      return text;
    }
    function domainOf(url) { try { return new URL(url).host; } catch (e) { return 'unknown'; } }
    async function decrypt(jsonText, url, pws) {
      var hash = url.indexOf('#'); if (hash < 0) throw new Error('链接缺少密钥');
      var frag = url.slice(hash + 1);
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(frag)) throw new Error('旧版 v1 格式暂不支持');
      var raw = jsonText.replace(/^\uFEFF/, '');
      var obj = JSON.parse(raw);
      if (!obj.adata || !obj.ct) throw new Error('不是有效的 PrivateBin 响应');
      var adata = obj.adata, inner = adata[0];
      var iv = b64(inner[0]), salt = b64(inner[1]);
      var iter = inner[2], bits = inner[3], compression = inner[7];
      var aStart = raw.indexOf('[', raw.indexOf('"adata"'));
      var aadText = unescape(extractArray(raw, aStart) || '');
      var ct = b64(obj.ct);
      var aad = new TextEncoder().encode(aadText);
      var lens = keyLengths(frag);
      var list = (pws || []).filter(Boolean); list.push('');
      var last = null;
      for (var li = 0; li < lens.length; li++) {
        var kb = pad32(b58(frag.slice(0, lens[li])));
        if (!kb) continue;
        for (var pi = 0; pi < list.length; pi++) {
          try {
            var pw = new TextEncoder().encode(list[pi] || '');
            var secret = new Uint8Array(kb.length + pw.length);
            secret.set(kb, 0); secret.set(pw, kb.length);
            var base = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
            var derived = await crypto.subtle.deriveBits(
              { name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, base, bits);
            var aes = await crypto.subtle.importKey('raw', new Uint8Array(derived), 'AES-GCM', false, ['decrypt']);
            var plain = new Uint8Array(await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: iv, additionalData: aad, tagLength: 128 }, aes, ct));
            if (compression === 'zlib') plain = await inflateRaw(plain);
            var text = new TextDecoder().decode(plain);
            var body = pasteOf(text);
            return { ok: true, text: body, domain: domainOf(url), chars: body.length };
          } catch (e) { last = e; }
        }
      }
      var msg = last && last.message ? last.message : '';
      if (/authenticate|tag|operation/i.test(msg)) throw new Error('密码不匹配或密钥不完整');
      throw new Error(msg || '解密失败');
    }
    return { decrypt: decrypt, keyLengths: keyLengths, b58: b58 };
  })();

  window.__ngaext = {
    scan: scan,
    onResult: onResult,
    toggleDark: toggleDark,
    _dbg: { threadKey: threadKey, links: findLinks, pw: findPassword, cardCount: cardCount },
    _privatebin: PrivateBin
  };

  var autoStarted = false;
  function startAuto() {
    if (autoStarted || !document.body) return;
    autoStarted = true;
    try { new MutationObserver(function () { scan(); }).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    setInterval(scan, 1200);
  }
  var _scan = scan;
  scan = function () { startAuto(); _scan(); };
  window.__ngaext.scan = scan;
  scan();
  document.addEventListener('DOMContentLoaded', function () { scan(); });
})();
