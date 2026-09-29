/* SmashLab — تبديل اللغة عربي / English
   العربي هو الافتراضي. الإنجليزي بيتفعل بزرار EN أو بلينك ?lang=en، والاختيار بيتحفظ على الجهاز.
   مهم: الترجمة للعرض بس — الأوردر اللي بيروح للمطبخ (الأصناف، الاختيارات، المنطقة) بيفضل عربي دايمًا. */
(function (global) {
  'use strict';

  var KEY = 'smashlab_lang';

  function detect() {
    var q = null;
    try { q = new URLSearchParams(global.location.search).get('lang'); } catch (e) {}
    if (q === 'en' || q === 'ar') {
      try { global.localStorage.setItem(KEY, q); } catch (e) {}
      return q;
    }
    try { if (global.localStorage.getItem(KEY) === 'en') return 'en'; } catch (e) {}
    return 'ar';
  }

  var lang = detect();

  var DICT = {
    // الأقسام
    'سماش برجر ساندويتش': 'Smash Burger Sandwiches',
    'ستيك': 'Steak',
    'فرايد تشيكن': 'Fried Chicken',
    'حار أو أوريجنال': 'Spicy or Original',
    'ريزو': 'Rizo',
    'الأصناف الجانبية': 'Sides',
    'الإضافات': 'Add-ons',
    'ديزرت': 'Dessert',
    'مشروبات': 'Drinks',

    // الأصناف
    'كلاسيك سماش': 'Classic Smash',
    'باربكيو سماش': 'BBQ Smash',
    'مشروم سماش': 'Mushroom Smash',
    'بيف بيكون سماش': 'Beef Bacon Smash',
    'سويت شيلي سماش': 'Sweet Chili Smash',
    'ترافل مشروم سماش': 'Truffle Mushroom Smash',
    'سيراتشا مايو سماش': 'Sriracha Mayo Smash',
    'فيلي تشيز ستيك': 'Philly Cheesesteak',
    'كلاسيك تشيكن': 'Classic Chicken',
    'باربكيو تشيكن': 'BBQ Chicken',
    'رانش تشيكن': 'Ranch Chicken',
    'سويت شيلي تشيكن': 'Sweet Chili Chicken',
    'تركي تشيكن': 'Turkey Chicken',
    'ترافل مشروم تشيكن': 'Truffle Mushroom Chicken',
    'سيراتشا مايو تشيكن': 'Sriracha Mayo Chicken',
    'بطاطس محمرة': 'French Fries',
    'بطاطس بالجبنة': 'Cheese Fries',
    'استريبس الدجاج': 'Chicken Strips',
    'إضافة صوص': 'Extra Sauce',
    'نوتيلا كرانش': 'Nutella Crunch',
    'مياه': 'Water',
    'مشروب غازي': 'Soft Drink',

    // الأوصاف الكاملة
    'شرائح لحم بقري متبلة متشوحة على الجريل مع البصل المكرمل وصوص المشروم مغطاة بالجبنة السايحة جوه عيش البريوش':
      'Seasoned beef slices seared on the grill with caramelized onions and mushroom sauce, topped with melted cheese in a brioche bun',
    'أرز بسمتي أصفر متبل مع قطع فراخ كريسبي مقرمشة، مع صوص كريمي غني ولمسة من الصوص الخاص.':
      'Seasoned yellow basmati rice with crunchy crispy chicken pieces, a rich creamy sauce and a touch of our special sauce.',
    'تقدم مع صوص من اختيارك': 'Served with a sauce of your choice',

    // مكونات (الأوصاف المفصولة بـ " - ")
    'قطعة برجر': 'Beef patty',
    'صدر دجاج كرسبي': 'Crispy chicken breast',
    'جبنة': 'Cheese',
    'جبنة شيدر': 'Cheddar cheese',
    'خس': 'Lettuce',
    'خيار مخلل': 'Pickles',
    'طماطم': 'Tomato',
    'مايونيز': 'Mayo',
    'مشروم': 'Mushrooms',
    'بيف بيكون': 'Beef bacon',
    'تركي': 'Turkey',
    'باربكيو صوص': 'BBQ sauce',
    'سويت شيلي صوص': 'Sweet chili sauce',
    'رانش صوص': 'Ranch sauce',
    'صوص كوكتيل': 'Cocktail sauce',
    'صوص مشروم ترافل': 'Truffle mushroom sauce',
    'صوص سيراتشا مايو': 'Sriracha mayo sauce',
    'عيش بريوش': 'Brioche bun',
    'نوتيلا': 'Nutella',
    'شرايح موز': 'Banana slices',
    'صوص كراميل': 'Caramel sauce',
    'بسكويت مقرمش': 'Crunchy biscuits',

    // الاختيارات والأحجام
    'أوريجنال': 'Original',
    'حار': 'Spicy',
    'رانش': 'Ranch',
    'باربكيو': 'BBQ',
    'سويت شيلي': 'Sweet Chili',
    'كاتشب': 'Ketchup',
    'تيكساس': 'Texas',
    'شيدر': 'Cheddar',
    'سنجل': 'Single',
    'دابل': 'Double',
    'تريبل': 'Triple',

    // مناطق التوصيل
    'دار الاشارة': 'Dar El Eshara',
    'دار المدفعية': 'Dar El Madfaeya',
    'سيتي ستارز': 'City Stars',
    'عمارات السعودية مدينة نصر': 'Saudi Buildings, Nasr City',
    'عمارات رامو': 'Ramo Buildings',
    'عمارات الفرسان': 'El Forsan Buildings',
    'نادي الفروسية': 'Equestrian Club',
    'السبع عمارات': 'El Sabaa Emarat',
    'تيفولي دووم': 'Tivoli Dome',
    'احمد فخري': 'Ahmed Fakhry',
    'مكرم عبيد': 'Makram Ebeid',
    'عباس العقاد': 'Abbas El Akkad',
    'الميرغني': 'El Merghany',
    'عمر ابن الخطاب': 'Omar Ibn El Khattab',
    'مستشفي الطيران': 'Air Force Hospital',
    'ميدان تريومف': 'Triumph Square',
    'سانت فاتيما': 'St. Fatima',
    'عمار بن ياسر': 'Ammar Ibn Yasser',
    'ميدان الحجاز': 'El Hegaz Square',
    'ميدان سفير': 'Safir Square',
    'ميدان المحكمة': 'El Mahkama Square',
    'ميدان صلاح الدين': 'Salah El Din Square',
    'ميدان الاسماعيلية': 'El Ismailia Square',
    'الطيران': 'El Tayaran St.',
    'حسن المأمون': 'Hassan El Maamoun',
    'حسن الشريف': 'Hassan El Sherif',
    'مصطفي النحاس': 'Mostafa El Nahas',
    'سمير عبدالرؤف': 'Samir Abdel Raouf',
    'الحديقة الدولية': 'International Garden',
    'الحي السابع': '7th District',
    'حي السفارات': 'Embassies District',
    'الحي الثامن': '8th District',
    'التبة': 'El Tabba',
    'احمد الزمر': 'Ahmed El Zomor',
    'الكوربة': 'El Korba',
    'ميدان روكسي': 'Roxy Square',
    'الخليفة المأمون': 'El Khalifa El Maamoun',
    'عمارات العبور': 'El Obour Buildings',
    'عبد الحميد بدوي': 'Abdel Hamid Badawy',
    'الشيراتون': 'Sheraton',
    'الحي العاشر': '10th District',
    'حي الواحة': 'El Waha District',
    'زهراء مدينة نصر': 'Zahraa Nasr City',
    'منشية البكري': 'Manshiyet El Bakry',
    'حدائق القبة': 'Hadayek El Kobba',
    'النزهة الجديدة': 'New Nozha',
    'جاردينيا': 'Gardenia',
    'تاج سلطان': 'Taj Sultan',
    'العباسية': 'Abbassia',
    'حلمية الزيتون': 'Helmeyet El Zeitoun',
    'جسر السويس': 'Gesr El Suez',
    'المطرية': 'El Matareya',
    'التجمع الاول': '1st Settlement',
    'التجمع الخامس': '5th Settlement',
    'التجمع الثالث': '3rd Settlement',
    'الرحاب': 'Al Rehab'
  };

  function isEn() { return lang === 'en'; }

  // ترجمة كلمة/جملة من الداتا — لو مش في القاموس بترجع زي ما هي
  function tr(s) {
    if (!isEn() || s == null) return s;
    var k = String(s);
    return Object.prototype.hasOwnProperty.call(DICT, k) ? DICT[k] : k;
  }

  // وصف صنف: جملة كاملة من القاموس، أو مكونات مفصولة بـ " - "
  function trDesc(s) {
    if (!isEn() || !s) return s;
    if (Object.prototype.hasOwnProperty.call(DICT, s)) return DICT[s];
    return String(s).split(' - ').map(tr).join(' · ');
  }

  // اختيارات الصنف في السلة ("حار · دابل")
  function trOpt(s) {
    if (!isEn() || !s) return s;
    return String(s).split(' · ').map(tr).join(' · ');
  }

  // نص واجهة: عربي أو إنجليزي
  function L(ar, en) { return isEn() ? en : ar; }

  function money(n) { return isEn() ? n + ' EGP' : n + ' ج'; }

  function applyStatic() {
    var doc = global.document;
    if (!doc) return;
    var root = doc.documentElement;
    root.setAttribute('lang', lang);
    root.setAttribute('dir', isEn() ? 'ltr' : 'rtl');

    var els = doc.querySelectorAll('[data-en]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.hasAttribute('data-ar')) el.setAttribute('data-ar', el.innerHTML);
      el.innerHTML = isEn() ? el.getAttribute('data-en') : el.getAttribute('data-ar');
    }
    var phs = doc.querySelectorAll('[data-en-ph]');
    for (var j = 0; j < phs.length; j++) {
      var p = phs[j];
      if (!p.hasAttribute('data-ar-ph')) p.setAttribute('data-ar-ph', p.getAttribute('placeholder') || '');
      p.setAttribute('placeholder', isEn() ? p.getAttribute('data-en-ph') : p.getAttribute('data-ar-ph'));
    }
    var btns = doc.querySelectorAll('.lang-toggle');
    for (var k = 0; k < btns.length; k++) {
      btns[k].textContent = isEn() ? 'عربي' : 'EN';
      btns[k].setAttribute('lang', isEn() ? 'ar' : 'en');
      btns[k].setAttribute('aria-label', isEn() ? 'التحويل للعربي' : 'Switch to English');
    }
  }

  function setLang(next) {
    if (next !== 'en' && next !== 'ar') return;
    lang = next;
    try { global.localStorage.setItem(KEY, lang); } catch (e) {}
    applyStatic();
    // الصفحة بتعيد رسم الأجزاء الديناميكية (المنيو، السلة، المناطق) من غير ما السلة تضيع
    if (typeof global.onLangChange === 'function') {
      try { global.onLangChange(lang); } catch (e) {}
    }
  }

  function bindToggles() {
    var doc = global.document;
    if (!doc) return;
    doc.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.lang-toggle') : null;
      if (!b) return;
      e.preventDefault();
      setLang(isEn() ? 'ar' : 'en');
    });
  }

  global.SLi18n = {
    lang: function () { return lang; },
    isEn: isEn,
    tr: tr,
    trDesc: trDesc,
    trOpt: trOpt,
    L: L,
    money: money,
    setLang: setLang,
    apply: applyStatic
  };

  bindToggles();
  // الملف بيتحمّل آخر الـbody قبل سكريبتات الصفحة، فالعناصر الثابتة موجودة بالفعل
  applyStatic();
})(window);
