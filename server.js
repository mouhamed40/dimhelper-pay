/**
 * ============================================================================
 * DIMhelper Pay × Chargily Pay V2 — نموذج مرجعي لخادم خلفي (Backend Reference)
 * ============================================================================
 *
 * لماذا هذا الملف منفصل عن dimhelper.html؟
 * -----------------------------------------------------------------------
 * لأن استدعاء "إنشاء فاتورة/Checkout" الحقيقي يحتاج API Secret Key، وأي كود
 * يعمل داخل متصفح المستخدم (حتى لو مخفي بجافاسكريبت) يمكن قراءته من تبويب
 * Network في أدوات المطوّر. لذلك Chargily نفسها توصي بشدة بعدم استدعاء
 * Checkout API مباشرة من الواجهة الأمامية.
 *
 * هذا الملف Node.js/Express جاهز كنقطة انطلاق حقيقية، ويطابق تماماً الحقول
 * التي يُدخلها المدير في صفحة "إعدادات الدفع الإلكتروني" داخل dimhelper.html:
 *   - وضع العمل (Test/Live)          → CHARGILY_MODE
 *   - API Secret Key                  → CHARGILY_SECRET_KEY (test أو live)
 *   - Success URL / Failure URL       → يُمرَّران من الواجهة الأمامية أو من .env
 *   - Webhook Endpoint                → المسار /webhooks/chargily في هذا الملف
 *   - طريقة الدفع الافتراضية / اللغة / توزيع الرسوم → تُمرَّر ضمن جسم الطلب
 *
 * تثبيت المتطلبات:
 *   npm install express dotenv
 *
 * تشغيل:
 *   node chargily-backend-reference.js
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// ── إعدادات Chargily — تُقرأ من متغيرات البيئة (.env)، ولا تُكتب أبداً في الكود مباشرة ──
const CHARGILY_MODE = (process.env.CHARGILY_MODE === 'live') ? 'live' : 'test';
const CHARGILY_SECRET_KEY = process.env.CHARGILY_SECRET_KEY || ''; // مفتاح Test أو Live حسب الوضع
const CHARGILY_BASE_URL = CHARGILY_MODE === 'live'
  ? 'https://pay.chargily.net/api/v2/'
  : 'https://pay.chargily.net/test/api/v2/';

if (!CHARGILY_SECRET_KEY) {
  console.warn('⚠️  CHARGILY_SECRET_KEY غير مضبوط في متغيرات البيئة — لن تعمل استدعاءات الدفع.');
}

// ── CORS: يسمح لواجهة dimhelper.html (متصفح المدير) بنداء هذا الخادم مباشرة ──
// بدون هذا، سيرفض المتصفح طلب fetch() القادم من صفحة "إعدادات الدفع الإلكتروني"
// برسالة CORS في الـ Console حتى لو كان الخادم يعمل بشكل صحيح.
// اضبط ALLOWED_ORIGIN في .env بنطاق تطبيقك الفعلي — لا تتركه '*' في وضع الإنتاج (Live).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204); // رد فوري على طلب preflight
  next();
});

// ⚠️ مهم جداً: مسار الـ Webhook يحتاج الجسم الخام (raw body) للتحقق من التوقيع بدقة،
// لذلك نعرّف express.raw() لهذا المسار تحديداً *قبل* express.json() العام.
app.post('/webhooks/chargily', express.raw({ type: 'application/json' }), handleWebhook);
app.use(express.json());

// ── صفحتا "تم الدفع بنجاح" و"لم يكتمل الدفع" — تُعرَضان لولي الأمر بعد إتمام/فشل الدفع ──
// (لا حاجة لموقع منفصل — نفس هذا الخادم يعرضهما مباشرة)
app.get('/payment-success', (req, res) => res.sendFile(__dirname + '/public/success.html'));
app.get('/payment-failed', (req, res) => res.sendFile(__dirname + '/public/failure.html'));

// ============================================================================
// 1) إنشاء Checkout — يُستدعى من الواجهة الخلفية لنظامك (وليس من متصفح الولي مباشرة
//    بدون مرور عبر هذا الخادم) عند طلب "تسديد الاشتراك أونلاين"
// ============================================================================
app.post('/api/payments/create-checkout', async (req, res) => {
  try {
    const {
      amount,               // المبلغ بالدينار الجزائري (رقم صحيح، بدون فواصل عشرية)
      childRef,             // معرّف الطفل/السجل في DIMhelper (لربط الفاتورة بالسجل الصحيح)
      successUrl,           // من إعدادات الروضة (chargilySuccessUrl)
      failureUrl,           // من إعدادات الروضة (chargilyFailureUrl)
      webhookUrl,           // من إعدادات الروضة (chargilyWebhookUrl) — يجب أن يشير لهذا الخادم
      paymentMethod,        // 'edahabia' | 'cib' | undefined (يترك الاختيار للولي)
      locale,               // 'ar' | 'en' | 'fr'
      feeAllocation,        // 'merchant' | 'customer' | 'split'
    } = req.body || {};

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'amount غير صالح' });
    }
    if (!CHARGILY_SECRET_KEY) {
      return res.status(500).json({ error: 'الخادم غير مهيّأ بمفتاح Chargily السري' });
    }

    // ملاحظة: توثيق Chargily V2 يدعم إنشاء Checkout مباشرة بمبلغ وعملة (بدون منتج مسبق)
    // إضافة لدعم Items/Price IDs — نستخدم هنا الصيغة المباشرة بالمبلغ لأنها الأنسب
    // لحالة "تسديد اشتراك بمبلغ متغيّر لكل طفل".
    const payload = {
      amount: Number(amount),
      currency: 'dzd', // Chargily Pay V2 تدعم DZD فقط حالياً
      payment_method: paymentMethod || undefined, // إن تُرك فارغاً، يختار الولي من صفحة الدفع
      success_url: successUrl,
      failure_url: failureUrl,
      webhook_endpoint: webhookUrl,
      locale: locale || 'ar',
      chargily_pay_fees_allocation: feeAllocation || 'merchant',
      metadata: { childRef: String(childRef || '') }, // لربط إشعار الـ Webhook بالسجل الصحيح لاحقاً
    };

    const chargilyRes = await fetch(CHARGILY_BASE_URL + 'checkouts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + CHARGILY_SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await chargilyRes.json();
    if (!chargilyRes.ok) {
      console.error('Chargily create-checkout error:', data);
      return res.status(chargilyRes.status).json({ error: 'فشل إنشاء عملية الدفع', details: data });
    }

    // data.checkout_url هو الرابط الذي تُوجَّه إليه صفحة الدفع في الواجهة
    return res.json({ checkoutUrl: data.checkout_url, checkoutId: data.id });
  } catch (err) {
    console.error('create-checkout exception:', err);
    return res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

// ============================================================================
// 2) استقبال إشعارات Chargily (Webhook) — يُحدَّث حالة الفاتورة في DIMhelper هنا
//    التحقق من التوقيع إلزامي: بدونه، أي شخص يقدر يزوّر إشعار "تم الدفع بنجاح"
// ============================================================================
function handleWebhook(req, res) {
  const signature = req.get('signature') || '';
  const rawBody = req.body; // Buffer خام (بفضل express.raw أعلاه)

  if (!signature) {
    console.warn('Webhook مرفوض: بدون ترويسة signature');
    return res.sendStatus(400);
  }

  const computedSignature = crypto
    .createHmac('sha256', CHARGILY_SECRET_KEY)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const computedBuf = Buffer.from(computedSignature, 'utf8');

  const isValid = sigBuf.length === computedBuf.length &&
    crypto.timingSafeEqual(sigBuf, computedBuf);

  if (!isValid) {
    console.warn('Webhook مرفوض: توقيع غير مطابق — قد تكون محاولة تزوير');
    return res.sendStatus(403);
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch (e) { return res.sendStatus(400); }

  const type = event?.type;
  const checkout = event?.data;

  switch (type) {
    case 'checkout.paid':
      // ✅ TODO: حدّث حالة الاشتراك/الفاتورة في قاعدة بيانات DIMhelper الخاصة بك
      // مثال: findChildByRef(checkout.metadata.childRef) → mark as paid → إرسال إشعار واتساب
      console.log('✅ دفع ناجح — checkout:', checkout?.id, 'metadata:', checkout?.metadata);
      break;
    case 'checkout.failed':
      console.log('❌ فشل الدفع — checkout:', checkout?.id);
      break;
    case 'checkout.expired':
      console.log('⏳ انتهت صلاحية عملية الدفع — checkout:', checkout?.id);
      break;
    default:
      console.log('حدث Chargily غير معروف:', type);
  }

  // إلزامي: الرد بـ 200 لتأكيد الاستلام، وإلا Chargily تعيد المحاولة عدة مرات
  return res.sendStatus(200);
}

// ============================================================================
// 3) فحص سريع لصحة المفتاح (نظير زر "اختبار الاتصال" في الواجهة، لكن من الخادم)
// ============================================================================
app.get('/api/payments/health', async (req, res) => {
  try {
    const r = await fetch(CHARGILY_BASE_URL + 'balance', {
      headers: { 'Authorization': 'Bearer ' + CHARGILY_SECRET_KEY },
    });
    if (r.ok) return res.json({ ok: true, mode: CHARGILY_MODE });
    return res.status(r.status).json({ ok: false, mode: CHARGILY_MODE });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'تعذّر الوصول إلى Chargily' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 خادم DIMhelper Pay يعمل على المنفذ ${PORT} — وضع Chargily: ${CHARGILY_MODE}`);
});

/**
 * ── ملف .env المقترح (لا يُرفع أبداً إلى Git — أضفه إلى .gitignore) ──
 *
 * CHARGILY_MODE=test
 * CHARGILY_SECRET_KEY=test_sk_xxxxxxxxxxxxxxxxxxxxxxxx
 * ALLOWED_ORIGIN=https://your-dimhelper-domain.com
 * PORT=4000
 */
