import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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
  assert.match(worker, /smashlab-app-v8/);
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
  assert.equal(storage.size, 0);
});
