import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const CODE_PATH = new URL('../telegram-backend/Code.gs', import.meta.url);

class MockRange {
  constructor(sheet, row, column, rows = 1, columns = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rows = rows;
    this.columns = columns;
  }

  setValues(values) {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) {
        this.sheet.setCell(this.row + r, this.column + c, values[r][c]);
      }
    }
    return this;
  }

  getValues() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.columns }, (_, c) =>
        this.sheet.getCell(this.row + r, this.column + c)
      )
    );
  }

  getDisplayValues() {
    return this.getValues().map((row) => row.map((value) => {
      if (value == null) return '';
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }));
  }

  getValue() {
    return this.getValues()[0][0];
  }

  getDisplayValue() {
    return this.getDisplayValues()[0][0];
  }
}

class MockSheet {
  constructor() {
    this.cells = [];
  }

  setCell(row, column, value) {
    if (!this.cells[row - 1]) this.cells[row - 1] = [];
    this.cells[row - 1][column - 1] = value;
  }

  getCell(row, column) {
    return this.cells[row - 1]?.[column - 1] ?? '';
  }

  getRange(row, column, rows, columns) {
    return new MockRange(this, row, column, rows, columns);
  }

  getLastRow() {
    for (let index = this.cells.length - 1; index >= 0; index -= 1) {
      if ((this.cells[index] || []).some((value) => value !== '' && value != null)) {
        return index + 1;
      }
    }
    return 0;
  }

  setFrozenRows() {}
}

function response(body) {
  return {
    getContentText: () => JSON.stringify(body),
    getResponseCode: () => 200
  };
}

async function createHarness(options = {}) {
  const source = await readFile(CODE_PATH, 'utf8');
  const sheet = new MockSheet();
  const fetchCalls = [];
  const fetchResults = [...(options.fetchResults || [{
    ok: true,
    result: { chat: { id: 'staff-chat' }, message_id: 101 }
  }])];
  const properties = new Map([
    ['ORDER_MODE', 'OPEN'],
    ['TG_TOKEN', 'test-token'],
    ['TG_CHAT', 'staff-chat']
  ]);
  let lockAvailable = options.lockAvailable !== false;
  let uuidCounter = 0;

  const spreadsheet = {
    getSheetByName: () => sheet,
    insertSheet: () => sheet
  };
  const scriptProperties = {
    getProperty: (key) => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value)),
    deleteProperty: (key) => properties.delete(key)
  };
  const output = (text) => ({
    text: String(text),
    mimeType: null,
    setMimeType(type) {
      this.mimeType = type;
      return this;
    },
    getContent() {
      return this.text;
    }
  });

  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => scriptProperties },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => lockAvailable,
        releaseLock: () => {}
      })
    },
    Utilities: {
      formatDate: (_date, _timezone, pattern) => {
        if (pattern === 'H:mm') return '15:00';
        if (pattern === 'yyMMdd-HHmmss') return '260807-150000';
        return '2026-08-07 15:00:00';
      },
      getUuid: () => `${(++uuidCounter).toString(16).padStart(4, '0')}0000-0000-4000-8000-000000000000`
    },
    UrlFetchApp: {
      fetch: (url, request) => {
        fetchCalls.push({ url, request });
        const next = fetchResults.length ? fetchResults.shift() : {
          ok: true,
          result: { chat: { id: 'staff-chat' }, message_id: 100 + fetchCalls.length }
        };
        if (next instanceof Error) throw next;
        return response(next);
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json', JAVASCRIPT: 'application/javascript' },
      createTextOutput: output
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      newTrigger: () => ({
        timeBased: () => ({
          everyMinutes: () => ({ create: () => ({}) })
        })
      })
    }
  });

  vm.runInContext(source, context, { filename: 'Code.gs' });

  return {
    context,
    sheet,
    fetchCalls,
    properties,
    setLockAvailable(value) { lockAvailable = value; }
  };
}

function payload(clientOrderId = 'client_order_00000001') {
  return {
    customer_name: 'Kareem Sobhi',
    phone: '01000000000',
    client_order_id: clientOrderId,
    items: [{ name: 'Classic Smash', qty: 1, price: 90 }],
    subtotal: 90,
    delivery: 30,
    total: 120,
    area: 'Nasr City',
    address: 'Test address',
    src: 'test'
  };
}

function jsonResult(output) {
  return JSON.parse(output.getContent());
}

test('repeating the same client order stores and sends only once', async () => {
  const harness = await createHarness();
  const first = jsonResult(harness.context.handleOrder_(payload()));
  const second = jsonResult(harness.context.handleOrder_(payload()));

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.order_id, first.order_id);
  assert.equal(harness.sheet.getLastRow(), 2);
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.sheet.getCell(2, 21), 'SENT');
  assert.equal(harness.sheet.getCell(2, 22), 1);
});

test('different client order ids receive separate rows', async () => {
  const harness = await createHarness();
  const first = jsonResult(harness.context.handleOrder_(payload('client_order_00000001')));
  const second = jsonResult(harness.context.handleOrder_(payload('client_order_00000002')));

  assert.equal(first.row, 2);
  assert.equal(second.row, 3);
  assert.notEqual(first.order_id, second.order_id);
  assert.equal(harness.sheet.getLastRow(), 3);
  assert.equal(harness.fetchCalls.length, 2);
});

test('busy order lock rejects safely without writing a row', async () => {
  const harness = await createHarness({ lockAvailable: false });
  const result = jsonResult(harness.context.handleOrder_(payload()));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'BUSY');
  assert.equal(harness.sheet.getLastRow(), 0);
  assert.equal(harness.fetchCalls.length, 0);
});

test('invalid customer name and client id are rejected before storage', async () => {
  const harness = await createHarness();
  const noName = payload();
  noName.customer_name = ' ';
  const invalidId = payload('short');

  assert.equal(jsonResult(harness.context.handleOrder_(noName)).code, 'NO_NAME');
  assert.equal(jsonResult(harness.context.handleOrder_(invalidId)).code, 'INVALID_ORDER_ID');
  assert.equal(harness.sheet.getLastRow(), 0);
  assert.equal(harness.fetchCalls.length, 0);
});

test('failed Telegram delivery is retried without duplicating the order', async () => {
  const harness = await createHarness({ fetchResults: [
    { ok: false, description: 'temporary outage' },
    { ok: true, result: { chat: { id: 'staff-chat' }, message_id: 202 } }
  ] });
  const order = jsonResult(harness.context.handleOrder_(payload()));

  assert.equal(order.ok, true);
  assert.equal(order.telegram_status, 'RETRY');
  assert.equal(harness.sheet.getCell(2, 21), 'RETRY');
  assert.equal(harness.sheet.getCell(2, 22), 1);

  const retry = harness.context.retryPendingTelegram();
  assert.equal(retry.ok, true);
  assert.equal(retry.attempted, 1);
  assert.equal(harness.sheet.getLastRow(), 2);
  assert.equal(harness.fetchCalls.length, 2);
  assert.equal(harness.sheet.getCell(2, 21), 'SENT');
  assert.equal(harness.sheet.getCell(2, 22), 2);
  assert.equal(harness.sheet.getCell(2, 17), 202);
});

test('order status endpoint returns a verifiable JSONP receipt', async () => {
  const harness = await createHarness();
  const order = jsonResult(harness.context.handleOrder_(payload()));
  const result = harness.context.doGet({ parameter: {
    action: 'order_status',
    client_order_id: 'client_order_00000001',
    callback: 'receiptCallback'
  } });

  assert.equal(result.mimeType, 'application/javascript');
  assert.match(result.getContent(), /^receiptCallback\(/);
  assert.match(result.getContent(), /\"received\":true/);
  assert.match(result.getContent(), new RegExp(order.order_id));
});

test('repeated Telegram decisions cannot change an already handled order', async () => {
  const harness = await createHarness();
  const order = jsonResult(harness.context.handleOrder_(payload()));
  const callback = {
    id: 'callback-1',
    data: `sl|a|${order.row}|${order.order_id}`,
    from: { id: 55, first_name: 'Staff' },
    message: {
      message_id: 101,
      chat: { id: 'staff-chat' },
      text: 'Order notification'
    }
  };

  const first = jsonResult(harness.context.handleCallback_(callback));
  callback.id = 'callback-2';
  callback.data = `sl|r|${order.row}|${order.order_id}`;
  const second = jsonResult(harness.context.handleCallback_(callback));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.already_decided, true);
  assert.equal(harness.sheet.getCell(order.row, 13), first.status);
  assert.match(harness.sheet.getCell(order.row, 14), /Staff/);
});

// ---- التحقق من الأسعار على السيرفر ----

function arabicPayload(overrides = {}) {
  return Object.assign({
    customer_name: 'Kareem Sobhi',
    phone: '01000000000',
    client_order_id: 'client_order_pricing_01',
    items: [
      { name: 'كلاسيك سماش', opt: 'سنجل', qty: 2, price: 90 },
      { name: 'كلاسيك تشيكن', opt: 'حار · دابل', qty: 1, price: 140 },
      { name: 'مشروب غازي', opt: '', qty: 1, price: 20 }
    ],
    subtotal: 340,
    delivery: 60,
    total: 400,
    area: 'ميدان روكسي',
    address: 'Test address',
    notes: '',
    src: 'test'
  }, overrides);
}

function sentText(harness, index = 0) {
  return JSON.parse(harness.fetchCalls[index].request.payload).text;
}

test('a correctly priced order passes the server price check untouched', async () => {
  const harness = await createHarness();
  const result = jsonResult(harness.context.handleOrder_(arabicPayload()));

  assert.equal(result.ok, true);
  assert.equal(result.price_check, 'OK');
  assert.equal(harness.sheet.getCell(2, 4), 340);
  assert.equal(harness.sheet.getCell(2, 5), 60);
  assert.equal(harness.sheet.getCell(2, 6), 400);
  assert.equal(harness.sheet.getCell(2, 10), '');
  assert.doesNotMatch(sentText(harness), /⚠️/);
  assert.match(sentText(harness), /الإجمالي النهائي: 400 جنيه/);
});

test('tampered prices are recalculated from the menu and flagged, never rejected', async () => {
  const harness = await createHarness();
  const tampered = arabicPayload({
    items: [{ name: 'ترافل مشروم سماش', opt: 'تريبل', qty: 1, price: 1 }],
    subtotal: 1,
    delivery: 0,
    total: 1,
    area: 'التجمع الخامس',
    notes: 'من غير بصل'
  });
  const result = jsonResult(harness.context.handleOrder_(tampered));

  assert.equal(result.ok, true);
  assert.equal(result.price_check, 'CORRECTED');
  assert.equal(harness.sheet.getCell(2, 4), 230);
  assert.equal(harness.sheet.getCell(2, 5), 130);
  assert.equal(harness.sheet.getCell(2, 6), 360);
  assert.match(harness.sheet.getCell(2, 10), /^⚠️ تنبيه أسعار/);
  assert.match(harness.sheet.getCell(2, 10), /من غير بصل$/);
  const text = sentText(harness);
  assert.match(text, /^🍔 أوردر جديد — SmashLab\n🧾 رقم الأوردر: [^\n]+\n\n⚠️ تنبيه أسعار/);
  assert.match(text, /الإجمالي: الموقع 1ج والصحيح 360ج/);
  assert.match(text, /ترافل مشروم سماش \(تريبل\) — 230ج/);
  assert.match(text, /الإجمالي النهائي: 360 جنيه/);
});

test('the BEKO10 discount from the site is accepted by the server check', async () => {
  const harness = await createHarness();
  const result = jsonResult(harness.context.handleOrder_(arabicPayload({
    subtotal: 306,
    total: 366,
    notes: '🎟 كود BEKO10 — خصم 10%: الأوردر قبل الخصم 340ج − 34ج = 306ج'
  })));

  assert.equal(result.price_check, 'OK');
  assert.equal(harness.sheet.getCell(2, 6), 366);
});

test('unknown items, areas and bad quantities keep the order but mark it unverified', async () => {
  const harness = await createHarness();
  const result = jsonResult(harness.context.handleOrder_(arabicPayload({
    items: [
      { name: 'صنف مش موجود', opt: '', qty: 1, price: 5 },
      { name: 'كلاسيك سماش', opt: 'سنجل', qty: -3, price: 90 }
    ],
    subtotal: 5,
    delivery: 10,
    total: 15,
    area: 'منطقة وهمية'
  })));

  assert.equal(result.ok, true);
  assert.equal(result.price_check, 'UNVERIFIED');
  assert.equal(harness.sheet.getCell(2, 6), 15);
  const text = sentText(harness);
  assert.match(text, /مقدرناش نتحقق من الأسعار/);
  assert.match(text, /صنف مش في قايمة الأسعار: صنف مش موجود/);
  assert.match(text, /كمية غير منطقية: كلاسيك سماش × -3/);
  assert.match(text, /منطقة مش في قايمة التوصيل: منطقة وهمية/);
});

test('server price list matches the menu, zones and coupons on every order page', async () => {
  const harness = await createHarness();
  const server = harness.context;
  const pages = ['order.html', 'app.html', 'order-preview.html'];

  for (const page of pages) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    const grab = (pattern) => {
      const match = html.match(pattern);
      assert.ok(match, `${page}: ${pattern}`);
      return match[0];
    };
    const site = vm.createContext({});
    vm.runInContext([
      grab(/var SANDWICH_UPGRADES = [^\n]+/),
      grab(/var PREMIUM_UPGRADES {2}= [^\n]+/),
      grab(/var MENU = \[[\s\S]*?\n\];/),
      grab(/var ZONES=\[[\s\S]*?\n\];/),
      grab(/var COUPONS = [^\n]+/),
      'this.MENU = MENU; this.ZONES = ZONES; this.COUPONS = COUPONS;'
    ].join('\n'), site);

    const siteItems = {};
    site.MENU.forEach((category) => category.items.forEach((item) => {
      const sizes = {};
      (item.sizes || []).forEach((size) => { sizes[size.name] = size.price; });
      siteItems[item.name] = { price: item.price, sizes };
    }));
    const serverItems = {};
    Object.keys(server.MENU_PRICES).forEach((name) => {
      const entry = server.MENU_PRICES[name];
      serverItems[name] = { price: entry.price, sizes: Object.assign({}, entry.sizes || {}) };
    });
    assert.deepEqual(serverItems, siteItems, `${page}: MENU vs MENU_PRICES`);

    const siteZones = {};
    site.ZONES.forEach((zone) => { siteZones[zone[0]] = zone[1]; });
    assert.deepEqual(Object.assign({}, server.ZONE_FEES), siteZones, `${page}: ZONES vs ZONE_FEES`);
    assert.deepEqual(Object.assign({}, server.COUPON_RATES), Object.assign({}, site.COUPONS), `${page}: COUPONS vs COUPON_RATES`);
  }
});