/**
 * eSelect | إي سيلكت
 * Shopify AI Categorizer & Arabic Translator v5.0
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

// ================== ENV ==================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL || "https://eselect.store";

// ================== LOAD FILES ==================
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"));
const cachePath = "./cache.json";
let cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
  : {};

if (!fs.existsSync("./logs")) fs.mkdirSync("./logs");
const log = (msg) => {
  const time = new Date().toISOString();
  fs.appendFileSync("./logs/actions.log", `[${time}] ${msg}\n`);
  console.log(msg);
};

// ================== HELPERS ==================
function extractDeliveryDays(text) {
  if (!text) return null;
  const patterns = [
    /(\d+)\s*-\s*(\d+)\s*(day|days|business days)/i,
    /delivery[:\s]*(\d+)\s*-\s*(\d+)/i,
    /ships\s*in\s*(\d+)\s*-\s*(\d+)/i,
    /(\d+)\s*to\s*(\d+)\s*(day|days)/i,
  ];
  for (const p of patterns) {
    const match = text.match(p);
    if (match) {
      const from = match[1];
      const to = match[2];
      return `من ${from} إلى ${to} أيام`;
    }
  }
  return null;
}

// ✅ تحويل إنجليزي إلى عربي (للخيارات)
async function translateText(text) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "ترجم النص التالي إلى العربية فقط دون شرح." },
          { role: "user", content: text },
        ],
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return res.data.choices[0].message.content.trim();
  } catch {
    return text;
  }
}

// ✅ إنشاء عنوان وصفي واقعي
async function generateProductTitle(title, desc) {
  const prompt = `
أعد صياغة العنوان التالي ليكون واضحًا ودقيقًا يصف المنتج الحقيقي فقط دون عبارات تسويقية.
استخدم كلمات مثل (هاتف، سماعة، ثلاجة، كاميرا...) واجعله بالعربية الواضحة.
العنوان: ${title}
الوصف: ${desc}
`;
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت كاتب منتجات متخصص بالعربية." },
        { role: "user", content: prompt },
      ],
      max_tokens: 150,
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return res.data.choices[0].message.content.replace(/\n/g, "").trim();
}

// ✅ إنشاء وصف تسويقي احترافي بالعربية
async function generateArabicDesc(title, description) {
  const prompt = `
ترجم النص التالي إلى العربية الفصحى بأسلوب تسويقي واضح ومهني بحدود 250 كلمة، دون رموز أو علامات خاصة:
${title}
${description}
`;
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت متخصص تسويق عربي." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return res.data.choices[0].message.content.replace(/\*|\#|\-/g, "").trim();
}

// ✅ تحديد التشكيلة (Collection)
function detectCollectionWeighted(title, desc) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;

  for (const c of collections) {
    let score = 0;
    for (const k of c.keywords) {
      const regex = new RegExp(`\\b${k}\\b`, "i");
      const titleMatch = (title.match(regex) || []).length * 3;
      const descMatch = (desc.match(regex) || []).length * 1;
      score += titleMatch + descMatch;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c.title;
    }
  }

  return { bestMatch, confidence: bestScore };
}

// ✅ GPT fallback عند الغموض
async function aiFallbackCategorization(title, desc) {
  const prompt = `
صنف المنتج التالي ضمن واحدة فقط من هذه التشكيلات:
${collections.map((c) => `- ${c.title}`).join("\n")}
العنوان: ${title}
الوصف: ${desc}
أجب فقط باسم التشكيلة المناسبة.
`;
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت مساعد تصنيف منتجات." },
        { role: "user", content: prompt },
      ],
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return res.data.choices[0].message.content.trim();
}

// ✅ المعالجة الكاملة للمنتج
async function processProduct(product) {
  const { id, title, body_html, variants = [], tags } = product;
  if (tags?.includes("AI-Optimized")) return;

  log(`🚀 معالجة المنتج: ${title}`);

  const arabicTitle = await generateProductTitle(title, body_html || "");
  const arabicDesc = await generateArabicDesc(title, body_html || "");
  const deliveryDays = extractDeliveryDays(body_html || "");

  // تحديد التشكيلة
  let { bestMatch, confidence } = detectCollectionWeighted(arabicTitle, arabicDesc);
  if (confidence < 5) bestMatch = await aiFallbackCategorization(arabicTitle, arabicDesc);
  const productType = typeMap[bestMatch] || "منتجات متنوعة";

  // ترجمة الـ Variants
  const translatedOptions = [];
  for (const opt of product.options || []) {
    const newName = await translateText(opt.name);
    const newValues = await Promise.all(opt.values.map(v => translateText(v)));
    translatedOptions.push({ name: newName, values: newValues });
  }

  // ترجمة الوسوم للعربية
  const arabicTags = await translateText(tags || "");

  // تحديث المنتج في Shopify
  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    product_type: productType,
    tags: `${arabicTags}, ${bestMatch}, AI-Optimized`,
    options: translatedOptions,
    metafields: [
      {
        namespace: "custom",
        key: "collection_detected",
        type: "single_line_text_field",
        value: bestMatch,
      },
      ...(deliveryDays
        ? [
            {
              namespace: "custom",
              key: "delivery_days",
              type: "single_line_text_field",
              value: deliveryDays,
            },
          ]
        : []),
    ],
  };

  const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${id}.json`;
  await axios.put(
    url,
    { product: payload },
    { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
  );

  cache[id] = { title: arabicTitle, collection: bestMatch };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log(`🎯 تم تحديث المنتج "${arabicTitle}" → "${bestMatch}" ✅`);
}

// ================== WEBHOOKS ==================
app.post("/webhook/product-created", async (req, res) => {
  try {
    await processProduct(req.body);
    res.sendStatus(200);
  } catch (e) {
    log(`❌ خطأ أثناء إنشاء المنتج: ${e.message}`);
    res.sendStatus(500);
  }
});

app.post("/webhook/product-updated", async (req, res) => {
  try {
    await processProduct(req.body);
    res.sendStatus(200);
  } catch (e) {
    log(`❌ خطأ أثناء التحديث: ${e.message}`);
    res.sendStatus(500);
  }
});

// ================== SERVER ==================
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v5.0 is running perfectly with Variants + Collections + Delivery Days!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`✅ Server running on port ${PORT}`));
