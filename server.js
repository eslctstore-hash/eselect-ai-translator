/**
 * eSelect | إي سيلكت
 * Smart AI Product Translator & Categorizer v5.0
 * إعداد: سالم السليمي | https://eselect.store
 */

import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json());

// ================== البيئة ==================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE = "eselect.store";

// ================== تحميل الملفات ==================
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = fs.existsSync("./typeMap.json")
  ? JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"))
  : {};
const cachePath = "./cache.json";
if (!fs.existsSync("./logs")) fs.mkdirSync("./logs");
if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, "{}");
let cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));

const log = (msg) => {
  const time = new Date().toISOString();
  fs.appendFileSync("./logs/actions.log", `[${time}] ${msg}\n`);
  console.log(msg);
};

// ================== دوال المساعدة ==================
function cleanText(txt) {
  return txt
    .replace(/[*#:\-]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/(العنوان|عنوان المنتج|الوصف)[:：]?\s*/gi, "")
    .trim();
}

async function generateSmartHandle(title) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Generate a short English SEO handle (max 50 chars, lowercase, hyphen separated, no symbols).",
          },
          { role: "user", content: title },
        ],
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    return res.data.choices[0].message.content
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .substring(0, 50);
  } catch {
    return title.toLowerCase().replace(/\s+/g, "-").substring(0, 50);
  }
}

// ================== التشكيلات ==================
function detectCollectionWeighted(title, description) {
  let best = "منتجات متنوعة",
    bestScore = 0;

  for (const c of collections) {
    let score = 0;
    for (const k of c.keywords) {
      const regex = new RegExp(`\\b${k}\\b`, "i");
      score += (title.match(regex) || []).length * 3;
      score += (description.match(regex) || []).length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = c.title;
    }
  }
  return { best, score: bestScore };
}

// ================== fallback عبر GPT ==================
async function aiFallbackCategorization(title, description) {
  const prompt = `
صنف المنتج التالي ضمن إحدى التشكيلات بدقة:
${collections.map((c) => `- ${c.title}`).join("\n")}
العنوان: ${title}
الوصف: ${description}
أجب فقط باسم التشكيلة الأنسب دون شرح.
`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت خبير تصنيف منتجات." },
        { role: "user", content: prompt },
      ],
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  return res.data.choices[0].message.content.trim();
}

// ================== إنشاء محتوى احترافي ==================
async function generateArabicContent(title, description) {
  const prompt = `
أعد صياغة العنوان والوصف التاليين بأسلوب تسويقي احترافي جذاب بالعربية،
كأنك كاتب محتوى إعلاني محترف في التسويق الإلكتروني (SEO + مبيعات).
- استخدم جمل طبيعية واضحة.
- لا تستخدم كلمات مثل "العنوان" أو "الوصف".
- لا تكتب رموز تنسيق.
العنوان: ${title}
الوصف: ${description}
`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "أنت خبير تسويق وكتابة محتوى منتجات." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  const content = cleanText(res.data.choices[0].message.content);
  const lines = content.split("\n").filter(Boolean);
  const arabicTitle = cleanText(lines[0]).slice(0, 80);
  const arabicDesc = cleanText(lines.slice(1).join(" "));

  return { arabicTitle, arabicDesc };
}

// ================== ترجمة الـ Variants ==================
async function translateVariants(variants = []) {
  const translated = [];
  for (const v of variants) {
    const prompt = `ترجم النصوص التالية للعربية فقط بدون أي رموز أو شرح:\n${JSON.stringify(
      v,
      null,
      2
    )}`;
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "أنت مترجم عربي محترف." },
          { role: "user", content: prompt },
        ],
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    try {
      translated.push(JSON.parse(res.data.choices[0].message.content));
    } catch {
      translated.push(v);
    }
  }
  return translated;
}

// ================== تحديث المنتج ==================
async function processProduct(product) {
  const { id, title, body_html, variants } = product;
  if (product.tags?.includes("AI-Optimized")) return;

  if (cache[id]) {
    log(`⚡ المنتج ${title} موجود مسبقًا`);
    return;
  }

  // إنشاء نص عربي احترافي
  const { arabicTitle, arabicDesc } = await generateArabicContent(
    title,
    body_html || ""
  );

  // تصنيف
  let { best, score } = detectCollectionWeighted(arabicTitle, arabicDesc);
  if (score < 5)
    best = await aiFallbackCategorization(arabicTitle, arabicDesc);

  const productType = typeMap[best] || "منتجات متنوعة";
  const handle = await generateSmartHandle(arabicTitle);
  const translatedVariants = await translateVariants(variants);

  // استخراج زمن التوصيل
  let delivery = null;
  const match = arabicDesc.match(/(\d+)[\s\-–إلىto]+(\d+)\s*(يوم|أيام)/);
  if (match) delivery = `${match[1]}-${match[2]} أيام`;

  // إرسال إلى Shopify
  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    handle,
    product_type: productType,
    variants: translatedVariants,
    tags: `${product.tags || ""}, AI-Optimized, ${best}`,
    metafields: delivery
      ? [
          {
            namespace: "custom",
            key: "delivery_days",
            value: delivery,
            type: "single_line_text_field",
          },
        ]
      : [],
  };

  const url = `https://${SHOPIFY_STORE}/admin/api/2024-07/products/${id}.json`;
  await axios.put(
    url,
    { product: payload },
    { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
  );

  cache[id] = { collection: best, type: productType };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log(`🎯 تم تحسين "${arabicTitle}" وتصنيفه ضمن "${best}"`);
}

// ================== Webhooks ==================
app.post("/webhook/product-created", async (req, res) => {
  try {
    log(`🆕 منتج جديد: ${req.body.title}`);
    await processProduct(req.body);
    res.sendStatus(200);
  } catch (e) {
    log(`❌ خطأ أثناء إنشاء المنتج: ${e.message}`);
    res.sendStatus(500);
  }
});

app.post("/webhook/product-updated", async (req, res) => {
  try {
    log(`♻️ تحديث منتج: ${req.body.title}`);
    await processProduct(req.body);
    res.sendStatus(200);
  } catch (e) {
    log(`❌ خطأ أثناء تحديث المنتج: ${e.message}`);
    res.sendStatus(500);
  }
});

// ================== اختبار السيرفر ==================
app.get("/", (req, res) =>
  res.send("🚀 eSelect AI Translator & Categorizer v5.0 is running")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`✅ Server running on port ${PORT}`));
