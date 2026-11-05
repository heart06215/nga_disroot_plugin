import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createCipheriv, webcrypto } from 'node:crypto';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58encode(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b === 0) out = '1' + out;
    else break;
  }
  return out;
}

function makeElement(tag) {
  const e = {
    tagName: tag || 'DIV',
    nodeType: 1,
    parentNode: null,
    children: [],
    attributes: {},
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    cloneNode() { return this; },
    addEventListener() {},
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; this.children.splice(Math.max(0, this.children.indexOf(ref)), 0, c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    getAttribute(k) { return this.attributes[k] == null ? null : this.attributes[k]; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    closest() { return null; },
    focus() {},
    click() {}
  };
  return e;
}

function loadPlugin(file, options = {}) {
  const title = makeElement('DIV');
  title.textContent = options.title || '测试帖子标题';
  const column = options.column ? makeElement('DIV') : null;
  if (column) column.classList.add('columnItem');
  const doc = {
    documentElement: makeElement('HTML'),
    head: makeElement('HEAD'),
    body: makeElement('BODY'),
    title: '',
    createElement: makeElement,
    getElementById() { return null; },
    querySelector(sel) {
      if (sel.indexOf('articleTitle') >= 0 || sel.indexOf('titleBlock') >= 0 || sel === '.title') return title;
      if (sel === '.columnItem') return column;
      if (sel === '.wrapBox') return null;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const store = new Map();
  const win = {
    __NGAEXT: undefined,
    NgaExtBridge: undefined,
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    document: doc
  };
  win.window = win;
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; } observe() {} };
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
  globalThis.Blob = Blob;
  globalThis.Response = Response;
  globalThis.DecompressionStream = DecompressionStream;
  globalThis.atob = atob;
  globalThis.btoa = btoa;
  globalThis.URL = URL;

  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  return win.__ngaext;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function testDetection(plugin, label) {
  const links = [];
  for (let i = 0; i < 100; i++) {
    const id = (i + 1).toString(16).padStart(16, '0');
    let key = '';
    for (let j = 0; j < 44; j++) key += B58[(i * 7 + j * 13) % 58];
    links.push('https://bin.disroot.org/?' + id + '#' + key);
  }
  links.push('https://paste.to/?0123456789abcdef#' + '1'.repeat(44));
  const out = plugin._dbg.links(links.join(' '));
  assert(out.length === 101, label + ': expected 101 links, got ' + out.length);
  const hosts = new Set(out.map((u) => new URL(u).host));
  assert(hosts.has('bin.disroot.org'), label + ': disroot host missing');
  assert(hosts.has('paste.to'), label + ': paste.to host missing');

  const pw = plugin._dbg.pw('密码: abc12345');
  assert(pw === 'abc12345', label + ': password detection failed: ' + pw);
}

async function makePaste() {
  const key = webcrypto.getRandomValues(new Uint8Array(32));
  const salt = webcrypto.getRandomValues(new Uint8Array(12));
  const iv = webcrypto.getRandomValues(new Uint8Array(16));
  const iterations = 2000;
  const aadArr = [[Buffer.from(iv).toString('base64'), Buffer.from(salt).toString('base64'), iterations, 256, 128, 'aes', 'gcm', 'zlib'], 'plaintext', 0, 0];
  const aadText = JSON.stringify(aadArr);
  const base = await webcrypto.subtle.importKey('raw', key, 'PBKDF2', false, ['deriveBits']);
  const derived = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256);
  const plain = zlib.deflateRawSync(Buffer.from(JSON.stringify({ paste: 'Hello PrivateBin from CI' }), 'utf8'));
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(derived), Buffer.from(iv));
  cipher.setAAD(Buffer.from(aadText, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    json: JSON.stringify({ ct: ct.toString('base64'), adata: aadArr, meta: { created: 0 } }),
    url: 'https://paste.to/?0123456789abcdef#' + b58encode(key)
  };
}

async function main() {
  const android = loadPlugin('ngaext/app/src/main/assets/ngaext.js');
  testDetection(android, 'android');
  assert(android._dbg.threadKey().indexOf('测试帖子标题') >= 0, 'android: stable title thread key failed');

  const ios = loadPlugin('ios-tweak/ngaext.js');
  testDetection(ios, 'ios');

  const paste = await makePaste();
  const out = await ios._privatebin.decrypt(paste.json, paste.url, []);
  assert(out && out.ok && out.text === 'Hello PrivateBin from CI', 'ios: PrivateBin decrypt failed: ' + JSON.stringify(out));

  console.log('js_core: OK (detection, passwords, thread key, PrivateBin decrypt)');
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
