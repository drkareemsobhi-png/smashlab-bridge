import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const ORDER_PAGES = ['order.html', 'order-preview.html', 'app.html'];

test('all order pages use the shared confirmed-delivery client', async () => {
  for (const filename of ORDER_PAGES) {
    const html = await readFile(new URL(filename, ROOT), 'utf8');
    assert.match(html, /<script src="order-client\.js"><\/script>/, filename);
    assert.match(html, /SmashLabOrders\.createClientOrderId\(\)/, filename);
    assert.match(html, /SmashLabOrders\.submitWithConfirmation\(/, filename);
    assert.match(html, /client_order_id:/, filename);
    assert.doesNotMatch(html, /navigator\.sendBeacon/, filename);

    // Mandatory production safeguards must survive future edits.
    assert.match(html, /id="cname"/, filename);
    assert.match(html, /closedBar/, filename);
    assert.match(html, /customer_name/, filename);
  }
});

test('service worker ships and caches the reliability client', async () => {
  const worker = await readFile(new URL('sw.js', ROOT), 'utf8');
  // Cache name is version-bumped on every asset change — assert the shape, not the number,
  // so a routine bump does not turn the publish gate red.
  assert.match(worker, /var CACHE = 'smashlab-app-v\d+';/);
  assert.match(worker, /order-client\.js/);
});

test('browser client reports success only after a backend receipt', async () => {
  const source = await readFile(new URL('order-client.js', ROOT), 'utf8');
  const sent = [];
  const storage = new Map();
  const container = { innerHTML: '' };
  const head = {
    appendChild(script) {
      script.parentNode = head;
      const callback = new URL(script.src).searchParams.get('callback');
      setTimeout(() => windowObject[callback]({
        ok: true,
        received: true,
        order_id: 'SL-TEST-001',
        telegram_status: 'SENT'
      }), 0);
    },
    removeChild(script) {
      script.parentNode = null;
    }
  };
  const documentObject = {
    head,
    createElement: () => ({ parentNode: null }),
    getElementById: () => ({ addEventListener: () => {} })
  };
  const windowObject = {
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    navigator: {
      sendBeacon: (url, body) => {
        sent.push({ url, body });
        return true;
      }
    },
    localStorage: {
      setItem: (key, value) => storage.set(key, value),
      getItem: (key) => storage.get(key) || null,
      removeItem: (key) => storage.delete(key)
    },
    setTimeout: (callback, delay) => setTimeout(callback, delay >= 6000 ? 50 : 0),
    clearTimeout,
    fetch: undefined
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentObject,
    Blob,
    Date,
    Math,
    Promise,
    encodeURIComponent,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source, context, { filename: 'order-client.js' });

  let confirmedReceipt;
  const confirmed = new Promise((resolve) => {
    windowObject.SmashLabOrders.submitWithConfirmation({
      webhook: 'https://example.test/exec',
      payload: { customer_name: 'Kareem', items: [{ name: 'Burger', qty: 1 }] },
      container,
      total: 120,
      name: 'Kareem',
      area: 'Nasr City',
      onConfirmed(receipt) {
        confirmedReceipt = receipt;
        resolve();
      }
    });
  });

  await confirmed;
  assert.equal(sent.length, 1);
  assert.equal(confirmedReceipt.order_id, 'SL-TEST-001');
  assert.match(container.innerHTML, /SL-TEST-001/);
  // الوقت المتوقع لازم يفضل ظاهر في شاشة النجاح.
  assert.match(container.innerHTML, /الوقت المتوقع لاستلام الأوردر: (<span[^>]*>)?من 60 إلى 70 دقيقة/);

  // الأوردر المعلّق لازم يتمسح عشان ما يتبعتش تاني.
  assert.equal(storage.has('smashlab_pending_order_v1'), false);

  // لكن لازم يفضل إيصال بالأوردر الناجح — من غيره الصفحة بتنسى بعد أي
  // ريفريش والعميل بيعيد الطلب وهو فاكر إنه ضاع (اتكرر 1 و 6 سبتمبر 2026).
  const receipt = JSON.parse(storage.get('smashlab_last_order_v1'));
  assert.equal(receipt.order_id, 'SL-TEST-001');
  assert.equal(typeof receipt.at, 'number');
});

// بصمة المنيو: لو اتغير سعر/صنف/اختيار/منطقة/كود في الصفحات من غير ما MENU_VERSION يتزوّد،
// الصفحات اللي مفتوحة عند العملاء مش هتعرف إنها قديمة. الاختبار ده بيوقع لحد ما تزوّد النسخة.
// لما يوقع: غيّر MENU_VERSION في الصفحات التلاتة + menu-version.txt لنسخة جديدة، وحدّث الرقمين هنا.
const MENU_FINGERPRINT = { version: '2026-11-02', sha256: 'd100487e0bae3840c9e481a1a165acf0d57aae985e0c036046dbb650af8bc3ae' };

async function menuFingerprint(filename) {
  const html = await readFile(new URL(filename, ROOT), 'utf8');
  const grab = (pattern) => {
    const match = html.match(pattern);
    assert.ok(match, `${filename}: ${pattern}`);
    return match[0];
  };
  const context = vm.createContext({});
  vm.runInContext([
    grab(/var MENU_VERSION = [^\n]+/),
    grab(/var SANDWICH_UPGRADES = [^\n]+/),
    grab(/var SANDWICH_PLUS_UPGRADES = [^\n]+/),
    grab(/var PREMIUM_UPGRADES {2}= [^\n]+/),
    grab(/var MENU = \[[\s\S]*?\n\];/),
    grab(/var ZONES=\[[\s\S]*?\n\];/),
    grab(/var COUPONS = [^\n]+/),
    'this.out = { version: MENU_VERSION, data: JSON.stringify({ MENU: MENU.map(function (c) { return c.items.map(function (it) { return [it.id, it.name, it.price, it.sizes || null, it.opts || null, it.opts2 || null]; }); }), ZONES: ZONES, COUPONS: COUPONS }) };'
  ].join('\n'), context);
  return { version: context.out.version, sha256: createHash('sha256').update(context.out.data).digest('hex') };
}

test('menu version matches the live version file and is bumped with every menu change', async () => {
  const fileVersion = (await readFile(new URL('menu-version.txt', ROOT), 'utf8')).trim();
  for (const filename of ORDER_PAGES) {
    const html = await readFile(new URL(filename, ROOT), 'utf8');
    const fp = await menuFingerprint(filename);
    assert.equal(fp.version, fileVersion, `${filename}: MENU_VERSION لازم تطابق menu-version.txt`);
    assert.deepEqual(fp, MENU_FINGERPRINT, `${filename}: المنيو اتغير — زوّد MENU_VERSION + menu-version.txt وحدّث MENU_FINGERPRINT`);
    // الفحص لازم يحصل قبل ما الأوردر يتبعت، والسلة ترجع بعد الريفريش.
    const send = html.indexOf('SmashLabOrders.submitWithConfirmation(');
    const check = html.indexOf('if(!menuChecked){ checkMenuThenSend(this); return; }');
    assert.ok(check > 0 && check < send, filename);
    assert.match(html, /\nrestoreDraft\(\);/, filename);
  }
});

test('stale-menu check: detects a new version, never blocks on network failure, and keeps the cart', async () => {
  const source = await readFile(new URL('order-client.js', ROOT), 'utf8');
  const session = new Map();
  let reply = () => Promise.resolve({ ok: true, text: () => Promise.resolve('2026-11-02\n') });
  const windowObject = {
    fetch: (...args) => reply(...args),
    sessionStorage: {
      setItem: (k, v) => session.set(k, v),
      getItem: (k) => session.get(k) || null,
      removeItem: (k) => session.delete(k)
    },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    setTimeout, clearTimeout
  };
  const context = vm.createContext({
    window: windowObject,
    document: { getElementById: () => null },
    Date, Math, JSON, Promise, encodeURIComponent, setTimeout, clearTimeout
  });
  vm.runInContext(source, context, { filename: 'order-client.js' });
  const api = windowObject.SmashLabOrders;

  assert.equal(await api.isMenuStale('2026-11-02'), false);
  assert.equal(await api.isMenuStale('2026-11-01'), true);
  reply = () => Promise.reject(new Error('offline'));
  assert.equal(await api.isMenuStale('2026-11-01'), false);
  reply = () => Promise.resolve({ ok: false, text: () => Promise.resolve('') });
  assert.equal(await api.isMenuStale('2026-11-01'), false);

  const draft = { lines: [['bacon|||دابل', 2]], fields: { cname: 'Amr' }, coupon: '', gps: null };
  assert.equal(api.saveDraft(draft), true);
  assert.deepEqual(JSON.parse(JSON.stringify(api.takeDraft())), draft);
  assert.equal(api.takeDraft(), null, 'المسودة بتتقرا مرة واحدة بس');
});
