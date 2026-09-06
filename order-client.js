(function (global) {
  'use strict';

  var PENDING_KEY = 'smashlab_pending_order_v1';
  // إيصال آخر أوردر ناجح — بيفضل متخزن عشان الصفحة تفتكر إن العميل طلب فعلًا
  // بعد أي ريفريش، فما يعيدش الطلب وهو فاكر إنه ضاع.
  var RECEIPT_KEY = 'smashlab_last_order_v1';
  var RECEIPT_TTL_MS = 45 * 60 * 1000;
  var CHECK_DELAYS = [400, 900, 1600, 2600, 4000];

  function createClientOrderId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'slw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 18);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function persistPending(webhook, payload) {
    try {
      global.localStorage.setItem(PENDING_KEY, JSON.stringify({
        webhook: webhook,
        payload: payload,
        created_at: Date.now()
      }));
    } catch (err) {}
  }

  function clearPending(clientOrderId) {
    try {
      var saved = JSON.parse(global.localStorage.getItem(PENDING_KEY) || 'null');
      if (!saved || !saved.payload || saved.payload.client_order_id === clientOrderId) {
        global.localStorage.removeItem(PENDING_KEY);
      }
    } catch (err) {
      try { global.localStorage.removeItem(PENDING_KEY); } catch (ignored) {}
    }
  }

  function rememberReceipt(orderId, options) {
    try {
      global.localStorage.setItem(RECEIPT_KEY, JSON.stringify({
        order_id: orderId || '',
        total: options && options.total != null ? String(options.total) : '',
        at: Date.now()
      }));
    } catch (err) {}
  }

  function readReceipt() {
    try {
      var saved = JSON.parse(global.localStorage.getItem(RECEIPT_KEY) || 'null');
      if (!saved || typeof saved.at !== 'number' || saved.dismissed) return null;
      if (Date.now() - saved.at >= RECEIPT_TTL_MS) {
        global.localStorage.removeItem(RECEIPT_KEY);
        return null;
      }
      return saved;
    } catch (err) {
      return null;
    }
  }

  function dismissReceipt() {
    try {
      var saved = JSON.parse(global.localStorage.getItem(RECEIPT_KEY) || 'null');
      if (saved) {
        saved.dismissed = true;
        global.localStorage.setItem(RECEIPT_KEY, JSON.stringify(saved));
      }
    } catch (err) {}
  }

  function sinceLabel(at) {
    var mins = Math.floor((Date.now() - at) / 60000);
    if (mins < 1) return 'من شوية';
    if (mins === 1) return 'من دقيقة';
    if (mins === 2) return 'من دقيقتين';
    if (mins <= 10) return 'من ' + mins + ' دقايق';
    return 'من ' + mins + ' دقيقة';
  }

  function renderReceiptBanner() {
    if (!global.document || !document.body) return null;
    if (document.getElementById('slReceiptBanner')) return null;
    var saved = readReceipt();
    if (!saved) return null;

    var bar = document.createElement('div');
    bar.id = 'slReceiptBanner';
    bar.setAttribute('style',
      'position:relative;background:#0f7a3d;color:#fff;font-family:Cairo,sans-serif;' +
      'direction:rtl;text-align:center;padding:12px 44px 13px;line-height:1.75;' +
      'font-size:14px;font-weight:700;z-index:60');
    bar.innerHTML =
      '<div style="font-size:15px;font-weight:900">✅ أوردرك اتسجل عندنا ' +
      escapeHtml(sinceLabel(saved.at)) + '</div>' +
      (saved.order_id
        ? '<div style="font-size:12.5px;font-weight:700;opacity:.92;margin-top:2px">رقم الأوردر: ' +
          escapeHtml(saved.order_id) + '</div>'
        : '') +
      '<div style="font-size:12.5px;font-weight:600;opacity:.92;margin-top:3px">' +
      'بنجهّزه دلوقتي — مش محتاج تطلب تاني. ' +
      'لو عايز أوردر إضافي كمّل عادي.</div>' +
      '<button type="button" id="slReceiptClose" aria-label="إخفاء" ' +
      'style="position:absolute;top:8px;left:10px;background:transparent;border:0;color:#fff;' +
      'font-size:20px;line-height:1;font-weight:900;cursor:pointer;opacity:.85;padding:2px 6px">×</button>';

    document.body.insertBefore(bar, document.body.firstChild);
    var close = document.getElementById('slReceiptClose');
    if (close) {
      close.addEventListener('click', function () {
        dismissReceipt();
        if (bar.parentNode) bar.parentNode.removeChild(bar);
      });
    }
    return bar;
  }

  function initReceiptBanner() {
    if (!global.document) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderReceiptBanner);
    } else {
      renderReceiptBanner();
    }
  }

  function sendPayload(webhook, payload) {
    var body = JSON.stringify(payload);
    var queued = false;
    try {
      queued = global.navigator.sendBeacon(
        webhook,
        new Blob([body], { type: 'text/plain;charset=UTF-8' })
      );
    } catch (err) {}

    if (!queued && typeof global.fetch === 'function') {
      try {
        global.fetch(webhook, {
          method: 'POST',
          mode: 'no-cors',
          keepalive: true,
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: body
        }).catch(function () {});
        queued = true;
      } catch (err) {}
    }
    return queued;
  }

  function checkReceiptOnce(webhook, clientOrderId) {
    return new Promise(function (resolve) {
      var callback = 'slReceipt_' + Math.random().toString(36).slice(2, 18);
      var script = document.createElement('script');
      var finished = false;
      var timer;

      function cleanup(result) {
        if (finished) return;
        finished = true;
        global.clearTimeout(timer);
        try { delete global[callback]; } catch (err) { global[callback] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        resolve(result || null);
      }

      global[callback] = function (result) { cleanup(result); };
      script.async = true;
      script.onerror = function () { cleanup(null); };
      script.src = webhook + '?action=order_status&client_order_id=' +
        encodeURIComponent(clientOrderId) + '&callback=' + encodeURIComponent(callback) +
        '&_=' + Date.now();
      timer = global.setTimeout(function () { cleanup(null); }, 6000);
      document.head.appendChild(script);
    });
  }

  function waitForReceipt(webhook, clientOrderId, attempt) {
    var index = attempt || 0;
    return new Promise(function (resolve) {
      global.setTimeout(resolve, CHECK_DELAYS[index] || 0);
    }).then(function () {
      return checkReceiptOnce(webhook, clientOrderId);
    }).then(function (result) {
      if (result && result.received) return result;
      if (index >= CHECK_DELAYS.length - 1) return result || { received: false };
      return waitForReceipt(webhook, clientOrderId, index + 1);
    });
  }

  function renderSending(container) {
    container.innerHTML =
      '<div style="text-align:center;padding:34px 10px 20px">' +
      '<div style="font-size:52px;line-height:1">⏳</div>' +
      '<h3 style="justify-content:center;margin:18px 0 8px">بنتأكد إن أوردرك وصل...</h3>' +
      '<p style="font-size:14.5px;opacity:.75;line-height:1.9">استنى ثواني وماتقفلش الصفحة.</p>' +
      '</div>';
  }

  function renderSuccess(container, options, receipt) {
    var orderId = receipt && receipt.order_id ? receipt.order_id : '';
    rememberReceipt(orderId, options);
    container.innerHTML =
      '<div style="text-align:center;padding:34px 10px 20px">' +
      '<div style="font-size:56px;line-height:1">✅</div>' +
      '<h3 style="justify-content:center;margin:18px 0 8px">استلمنا أوردرك!</h3>' +
      (orderId ? '<p style="font-size:13px;font-weight:900;margin-bottom:6px">رقم الأوردر: ' + escapeHtml(orderId) + '</p>' : '') +
      '<p style="font-size:16px;font-weight:800;margin-bottom:6px">الإجمالي: ' + escapeHtml(options.total) + ' جنيه — الدفع كاش عند الاستلام</p>' +
      '<p style="font-size:14.5px;opacity:.75;line-height:1.9">تمام يا ' + escapeHtml(options.name) +
      '! أوردرك اتسجل وجاري تأكيده وتجهيزه،<br>والدليفري يوصلك على ' + escapeHtml(options.area) + '.</p>' +
      '<button class="wabtn" style="margin-top:22px" onclick="location.reload()">تمام 👌</button>' +
      '</div>';
  }

  function renderUnconfirmed(container, retry) {
    container.innerHTML =
      '<div style="text-align:center;padding:34px 10px 20px">' +
      '<div style="font-size:56px;line-height:1">⚠️</div>' +
      '<h3 style="justify-content:center;margin:18px 0 8px">لسه مقدرناش نتأكد إن الأوردر وصل</h3>' +
      '<p style="font-size:14.5px;opacity:.8;line-height:1.9">اضغط إعادة الإرسال. نفس الأوردر مش هيتكرر حتى لو اتبعت أكتر من مرة.</p>' +
      '<button class="wabtn" id="retryOrderDelivery" style="margin-top:18px">إعادة الإرسال</button>' +
      '</div>';
    document.getElementById('retryOrderDelivery').addEventListener('click', retry);
  }

  function submitWithConfirmation(options) {
    var payload = options.payload;
    payload.client_order_id = payload.client_order_id || createClientOrderId();
    persistPending(options.webhook, payload);
    var confirmed = false;

    function attempt() {
      renderSending(options.container);
      sendPayload(options.webhook, payload);
      waitForReceipt(options.webhook, payload.client_order_id, 0).then(function (receipt) {
        if (receipt && receipt.received) {
          clearPending(payload.client_order_id);
          renderSuccess(options.container, options, receipt);
          if (!confirmed && typeof options.onConfirmed === 'function') {
            confirmed = true;
            options.onConfirmed(receipt);
          }
          return;
        }
        renderUnconfirmed(options.container, attempt);
      });
    }

    attempt();
    return payload.client_order_id;
  }

  global.SmashLabOrders = {
    createClientOrderId: createClientOrderId,
    sendPayload: sendPayload,
    checkReceiptOnce: checkReceiptOnce,
    waitForReceipt: waitForReceipt,
    submitWithConfirmation: submitWithConfirmation,
    rememberReceipt: rememberReceipt,
    readReceipt: readReceipt,
    dismissReceipt: dismissReceipt,
    renderReceiptBanner: renderReceiptBanner
  };

  initReceiptBanner();
})(window);
