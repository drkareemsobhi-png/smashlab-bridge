(function (global) {
  'use strict';

  var PENDING_KEY = 'smashlab_pending_order_v1';
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
    submitWithConfirmation: submitWithConfirmation
  };
})(window);
