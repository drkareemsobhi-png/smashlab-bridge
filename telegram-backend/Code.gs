var SHEET_NAME = 'Orders';
var TIMEZONE = 'Africa/Cairo';
var WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw-AO-CWhoeev6PS16QKic0XzDCFYiMaCJgxavn9IbF2eVdea7cN6gX5GUXgf_TD2LT/exec';

var COL = {
  ORDER_ID: 12,
  STATUS: 13,
  STAFF: 14,
  DECIDED_AT: 15,
  TG_CHAT: 16,
  TG_MESSAGE: 17
};

var HEADERS = [
  'التاريخ والوقت', 'الأصناف', 'عدد القطع', 'الأوردر (ج)',
  'التوصيل (ج)', 'الإجمالي (ج)', 'المنطقة', 'العنوان',
  'اللوكيشن', 'ملاحظات', 'المصدر', 'رقم الأوردر',
  'حالة الأوردر', 'بواسطة', 'وقت القرار',
  'Telegram Chat ID', 'Telegram Message ID',
  'اسم العميل', 'رقم الموبايل'
];

// مواعيد استقبال الأوردرات: من 14:30 (شامل) حتى 23:30 (غير شامل) بتوقيت القاهرة.
// ORDER_MODE في Script Properties: AUTO (افتراضي) / OPEN (فتح يدوي) / CLOSED (قفل يدوي).
var OPEN_MINUTE = 14 * 60 + 30;
var CLOSE_MINUTE = 23 * 60 + 30;

function orderMode_() {
  var mode = (PropertiesService.getScriptProperties().getProperty('ORDER_MODE') || 'AUTO').toUpperCase();
  return mode === 'OPEN' || mode === 'CLOSED' ? mode : 'AUTO';
}

function isOpenNow_() {
  var mode = orderMode_();
  if (mode === 'OPEN') return true;
  if (mode === 'CLOSED') return false;
  var time = Utilities.formatDate(new Date(), TIMEZONE, 'H:mm').split(':');
  var minuteOfDay = Number(time[0]) * 60 + Number(time[1]);
  return minuteOfDay >= OPEN_MINUTE && minuteOfDay < CLOSE_MINUTE;
}

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (payload.callback_query) {
      return handleCallback_(payload.callback_query);
    }

    if (payload.message) {
      return handleTelegramMessage_(payload.message);
    }

    return handleOrder_(payload);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput('SmashLab orders webhook OK');
}

function handleOrder_(d) {
  // فحص المواعيد النهائي على السيرفر — الواجهة بتفحص برضه، بس دي الحماية الحقيقية.
  // فحص المواعيد لا يطبق على Telegram callbacks (بتتحول لـ handleCallback_ قبل الوصول هنا).
  if (!isOpenNow_()) {
    return json_({ ok: false, code: 'CLOSED', error: 'استقبال الأوردرات متوقف حاليًا.' });
  }

  var customerName = text_(d.customer_name).replace(/\s+/g, ' ').trim();
  if (customerName.length < 2) {
    return json_({ ok: false, code: 'NO_NAME', error: 'اكتب اسمك عشان نعرف نأكد الأوردر معاك.' });
  }
  var customerPhone = text_(d.phone || d.customer_phone);

  var itemsList = Array.isArray(d.items) ? d.items : [];
  if (!itemsList.length) {
    throw new Error('Order payload has no items.');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  ensureHeaders_(sh);

  var now = new Date();
  var orderId = makeOrderId_(now);
  var row = sh.getLastRow() + 1;
  var items = itemsList.map(function(it) {
    return number_(it.qty) + 'x ' + text_(it.name) + (it.opt ? ' (' + text_(it.opt) + ')' : '');
  }).join(' | ');
  var qty = itemsList.reduce(function(sum, it) {
    return sum + number_(it.qty);
  }, 0);

  sh.getRange(row, 1, 1, HEADERS.length).setValues([[
    formatDate_(now),
    items,
    qty,
    number_(d.subtotal),
    number_(d.delivery),
    number_(d.total),
    text_(d.area),
    text_(d.address),
    text_(d.gps),
    text_(d.notes),
    text_(d.src),
    orderId,
    'جديد',
    '',
    '',
    '',
    '',
    customerName,
    customerPhone
  ]]);

  var cfg = getTelegramConfig_();
  if (cfg.token && cfg.chat) {
    var sent = telegramCall_('sendMessage', {
      chat_id: cfg.chat,
      text: buildOrderMessage_(d, orderId),
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ قبول الأوردر', callback_data: callbackData_('accept', row, orderId) },
          { text: '❌ رفض الأوردر', callback_data: callbackData_('reject', row, orderId) }
        ]]
      }
    }, cfg.token);

    if (sent.ok && sent.result) {
      sh.getRange(row, COL.TG_CHAT, 1, 2).setValues([[
        String(sent.result.chat.id),
        sent.result.message_id
      ]]);
    } else {
      console.error('Telegram sendMessage failed: ' + JSON.stringify(sent));
    }
  }

  return json_({ ok: true, order_id: orderId, row: row });
}

function handleCallback_(query) {
  var cfg = getTelegramConfig_();
  var message = query.message || {};
  var chat = message.chat || {};
  var from = query.from || {};
  var parsed = parseCallbackData_(query.data);

  if (!cfg.token || !cfg.chat || String(chat.id) !== String(cfg.chat)) {
    answerCallback_(query.id, 'غير مصرح باستخدام أزرار الأوردرات.', true, cfg.token);
    return json_({ ok: false, error: 'unauthorized_chat' });
  }

  if (!parsed) {
    answerCallback_(query.id, 'بيانات الأوردر غير صالحة.', true, cfg.token);
    return json_({ ok: false, error: 'invalid_callback' });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    answerCallback_(query.id, 'في موظف بيتعامل مع الأوردر دلوقتي. جرّب تاني.', false, cfg.token);
    return json_({ ok: false, error: 'busy' });
  }

  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sh || parsed.row < 2 || parsed.row > sh.getLastRow()) {
      answerCallback_(query.id, 'الأوردر مش موجود في الشيت.', true, cfg.token);
      return json_({ ok: false, error: 'order_not_found' });
    }

    var storedOrderId = String(sh.getRange(parsed.row, COL.ORDER_ID).getDisplayValue());
    var currentStatus = String(sh.getRange(parsed.row, COL.STATUS).getDisplayValue() || 'جديد');

    if (storedOrderId !== parsed.orderId) {
      answerCallback_(query.id, 'رقم الأوردر غير مطابق.', true, cfg.token);
      return json_({ ok: false, error: 'order_mismatch' });
    }

    if (currentStatus !== 'جديد') {
      answerCallback_(query.id, 'تم التعامل مع الأوردر بالفعل: ' + currentStatus, false, cfg.token);
      return json_({ ok: true, already_decided: true, status: currentStatus });
    }

    var status = parsed.action === 'accept' ? 'مقبول' : 'مرفوض';
    var staffName = telegramName_(from);
    var decidedAt = formatDate_(new Date());

    sh.getRange(parsed.row, COL.STATUS, 1, 3).setValues([[
      status,
      staffName,
      decidedAt
    ]]);

    var statusIcon = status === 'مقبول' ? '✅' : '❌';
    var cleanText = String(message.text || '').replace(/\n?🟡 الحالة: جديد\s*$/, '');
    var finalText = cleanText + '\n\n' + statusIcon + ' الحالة: ' + status +
      '\n👤 بواسطة: ' + staffName +
      '\n🕒 الوقت: ' + decidedAt;

    var edited = telegramCall_('editMessageText', {
      chat_id: chat.id,
      message_id: message.message_id,
      text: finalText,
      reply_markup: { inline_keyboard: [] }
    }, cfg.token);

    if (!edited.ok) {
      telegramCall_('editMessageReplyMarkup', {
        chat_id: chat.id,
        message_id: message.message_id,
        reply_markup: { inline_keyboard: [] }
      }, cfg.token);
      console.error('Telegram editMessageText failed: ' + JSON.stringify(edited));
    }

    answerCallback_(
      query.id,
      status === 'مقبول' ? 'تم قبول الأوردر ✅' : 'تم رفض الأوردر ❌',
      false,
      cfg.token
    );

    return json_({ ok: true, status: status, staff: staffName });
  } finally {
    lock.releaseLock();
  }
}

function handleTelegramMessage_(message) {
  var cfg = getTelegramConfig_();
  var chat = message.chat || {};
  var command = String(message.text || '').split('@')[0].trim();

  if (String(chat.id) === String(cfg.chat) && (command === '/setup' || command === '/status')) {
    telegramCall_('sendMessage', {
      chat_id: chat.id,
      text: '✅ SmashLab Orders Bot شغّال\nالأوردرات الجديدة هتوصل هنا بأزرار القبول والرفض.'
    }, cfg.token);
  }

  return json_({ ok: true });
}

function setupTelegramWebhook() {
  var cfg = getTelegramConfig_();
  if (!cfg.token || !cfg.chat) {
    throw new Error('Set TG_TOKEN and TG_CHAT in Script Properties first.');
  }

  var response = telegramCall_('setWebhook', {
    url: WEB_APP_URL,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  }, cfg.token);

  if (!response.ok) {
    throw new Error('setWebhook failed: ' + JSON.stringify(response));
  }

  console.log(JSON.stringify(response));
  return response;
}

function getTelegramWebhookInfo() {
  var cfg = getTelegramConfig_();
  var response = telegramCall_('getWebhookInfo', {}, cfg.token);
  console.log(JSON.stringify(response));
  return response;
}

function ensureHeaders_(sh) {
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    return;
  }

  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.setFrozenRows(1);
}

function buildOrderMessage_(d, orderId) {
  var lines = ['🍔 أوردر جديد — SmashLab', '🧾 رقم الأوردر: ' + orderId, ''];
  var name = text_(d.customer_name).replace(/\s+/g, ' ').trim();
  var phone = text_(d.phone || d.customer_phone);
  if (name) lines.push('👤 الاسم: ' + name);
  if (phone) lines.push('📞 الموبايل: ' + phone);
  if (name || phone) lines.push('');

  (d.items || []).forEach(function(it) {
    lines.push(
      '• ' + number_(it.qty) + '× ' + text_(it.name) +
      (it.opt ? ' (' + text_(it.opt) + ')' : '') +
      ' — ' + (number_(it.qty) * number_(it.price)) + 'ج'
    );
  });

  lines.push('');
  lines.push('الأوردر: ' + number_(d.subtotal) + 'ج');
  lines.push('التوصيل: ' + number_(d.delivery) + 'ج');
  lines.push('الإجمالي النهائي: ' + number_(d.total) + ' جنيه');
  lines.push('📍 المنطقة: ' + text_(d.area));
  lines.push('🏠 العنوان: ' + text_(d.address));
  if (d.gps) lines.push('🗺 اللوكيشن: ' + text_(d.gps));
  if (d.notes) lines.push('📝 ملاحظات: ' + text_(d.notes));
  lines.push('');
  lines.push('🟡 الحالة: جديد');

  return lines.join('\n');
}

function callbackData_(action, row, orderId) {
  return ['sl', action === 'accept' ? 'a' : 'r', row, orderId].join('|');
}

function parseCallbackData_(data) {
  var parts = String(data || '').split('|');
  if (parts.length !== 4 || parts[0] !== 'sl') return null;
  if (parts[1] !== 'a' && parts[1] !== 'r') return null;

  var row = Number(parts[2]);
  if (!Number.isInteger(row) || row < 2) return null;

  return {
    action: parts[1] === 'a' ? 'accept' : 'reject',
    row: row,
    orderId: parts[3]
  };
}

function answerCallback_(callbackId, text, showAlert, token) {
  if (!callbackId || !token) return;
  telegramCall_('answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text,
    show_alert: Boolean(showAlert)
  }, token);
}

function telegramCall_(method, payload, token) {
  if (!token) return { ok: false, description: 'Missing Telegram token.' };

  var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });

  try {
    return JSON.parse(response.getContentText());
  } catch (err) {
    return {
      ok: false,
      description: 'Telegram returned a non-JSON response.',
      status: response.getResponseCode()
    };
  }
}

function getTelegramConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    token: props.getProperty('TG_TOKEN') || '',
    chat: props.getProperty('TG_CHAT') || ''
  };
}

function makeOrderId_(date) {
  var stamp = Utilities.formatDate(date, TIMEZONE, 'yyMMdd-HHmmss');
  var suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 4).toUpperCase();
  return 'SL-' + stamp + '-' + suffix;
}

function telegramName_(from) {
  var fullName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  if (from.username) {
    return (fullName ? fullName + ' ' : '') + '(@' + from.username + ')';
  }
  return fullName || ('Telegram user ' + String(from.id || 'unknown'));
}

function formatDate_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function number_(value) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text_(value) {
  return value == null ? '' : String(value).trim();
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
