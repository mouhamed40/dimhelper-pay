# خادم DIMhelper Pay الخلفي (الوسيط الآمن مع Chargily)

هذا خادم Node.js بسيط، وظيفته الوحيدة: يستقبل طلب "أنشئ رابط دفع" من تطبيق DIMhelper،
يتصل هو بـ Chargily (بمفتاحك السري المخفي)، ويرجّع رابط دفع حقيقي.

---

## 1) شغّله على جهازك (للتجربة فقط)

يحتاج جهازك [Node.js](https://nodejs.org) مثبّت (نسخة 18 فما فوق).

```bash
cd chargily-backend
npm install
cp .env.example .env
```

افتح ملف `.env` واملأ:
- `CHARGILY_SECRET_KEY` → مفتاحك السري من لوحة Chargily (Developers Corner → API Keys)
- خلّي `CHARGILY_MODE=test` مبدئياً

شغّل الخادم:
```bash
npm start
```

لو ظهرت رسالة `🚀 خادم DIMhelper Pay يعمل على المنفذ 4000` فهو خدام.

اختبره من متصفح آخر تبويب:
```
http://localhost:4000/api/payments/health
```
لو رجّع `{"ok":true}` فمفتاحك صحيح والخادم متصل بـ Chargily فعلياً. 🎉

⚠️ **ملاحظة:** `localhost` يخدم على جهازك فقط — تطبيق DIMhelper (لو مفتوح من متصفح على
جهاز/موبايل آخر) ما يقدرش يوصله. للاستعمال الحقيقي، لازم "تنشره" على الإنترنت (الخطوة 2).

---

## 2) انشره على الإنترنت (باش يخدم بجد مع أولياء الأمور)

أسهل طريقة مجانية للبداية: **Render.com**

1. حط هاذ المجلد فمستودع GitHub (بدون ملف `.env` — محمي أصلاً بـ `.gitignore`)
2. سجّل فـ [render.com](https://render.com) بحساب GitHub
3. **New +** → **Web Service** → اختر المستودع
4. Build Command: `npm install`
5. Start Command: `npm start`
6. فقسم **Environment Variables**، ضيف نفس متغيرات ملف `.env`:
   - `CHARGILY_MODE` = `test`
   - `CHARGILY_SECRET_KEY` = مفتاحك السري
   - `ALLOWED_ORIGIN` = نطاق تطبيقك (أو `*` مؤقتاً)
7. اضغط **Create Web Service** — بعد دقائق يعطيك رابط مثل:
   `https://dimhelper-pay-backend.onrender.com`

بدائل أخرى تخدم بنفس الطريقة تقريباً: **Railway.app**، **Fly.io**، أو أي VPS جزائري/دولي.

---

## 3) اربطه بتطبيق DIMhelper

فصفحة **إعدادات الدفع الإلكتروني** فالتطبيق:
- **رابط خادم الدفع الخلفي** → الصق رابط Render (مثال: `https://dimhelper-pay-backend.onrender.com`)
- **Webhook Endpoint** → `https://dimhelper-pay-backend.onrender.com/webhooks/chargily`

ثم فلوحة تحكم Chargily نفسها:
- Developers Corner → أضف نفس رابط الـ Webhook أعلاه

---

## الملفات

| الملف | الوظيفة |
|---|---|
| `server.js` | الخادم نفسه — إنشاء روابط الدفع + استقبال إشعارات Chargily |
| `.env.example` | نموذج لمتغيرات البيئة (انسخه إلى `.env` واملأه) |
| `.gitignore` | يمنع رفع `.env` والمفتاح السري بالخطأ إلى GitHub |

## أمان

- المفتاح السري **لا يوجد إلا فمتغيرات البيئة** على الخادم — لا يظهر أبداً فأي كود
  يعمل داخل متصفح المستخدم.
- توقيع كل Webhook يُتحقق منه (HMAC) قبل تحديث أي حالة دفع — يمنع أي محاولة تزوير
  "الدفع نجح" من طرف خارجي.
