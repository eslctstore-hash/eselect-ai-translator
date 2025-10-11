/**
 * eSelect | إي سيلكت
 * Shopify Smart Arabic Categorizer v4.0 (Deep Hybrid Model)
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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE = "eselect.store";

// تحميل الملفات
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"));
const cachePath = "./cache.json";
let cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
  : {};

const log = (msg) => {
  const time = new Date().toISOString();
  fs.appendFileSync("./logs/actions.log", `[${time}] ${msg}\n`);
  console.log(msg);
};

/* ✅ تنظيف الـ handle الذكي */
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
              "Translate this Arabic product title into a short, SEO-friendly English slug (max 50 chars, lowercase, hyphen separated, no symbols).",
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

/* ✅ خوارزمية التشكيلة (80% للعنوان و20% للوصف) */
function detectCollectionWeighted(title, description) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;
  let confidence = 0;

  for (const c of collections) {
    let score = 0;
    for (const k of c.keywords) {
      const regex = new RegExp(`\\b${k}\\b`, "i");
      const titleCount = (title.match(regex) || []).length * 3;
      const descCount = (description.match(regex) || []).length * 1;
      score += titleCount + descCount;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c.title;
      confidence = score;
    }
  }

  return { bestMatch, confidence };
}

/* ✅ تحليل ذكي باستخدام GPT عند الغموض */
async function aiFallbackCategorization(title, description) {
  const prompt = `
قم بتصنيف المنتج التالي إلى واحدة فقط من التشكيلات التالية:
${collections.map((c) => `- ${c.title}`).join("\n")}
العنوان: ${title}
الوصف: ${description}
أجب فقط باسم التشكيلة المناسبة دون أي شرح.
`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a categorization assistant." },
        { role: "user", content: prompt },
      ],
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  return res.data.choices[0].message.content.trim();
}

/* ✅ إنشاء محتوى تسويقي بالعربية */
async function generateArabicContent(title, description) {
  const prompt = `
ترجم النص التالي إلى العربية الفصحى بأسلوب تسويقي جذاب لمتجر إلكتروني عماني مثل "إي سيلكت".
- لا تكتب كلمات مثل "العنوان" أو "الوصف".
- استخدم جملًا واضحة ومقنعة في حدود 250 كلمة.
العنوان: ${title}
الوصف: ${description}
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

  const content = res.data.choices[0].message.content
    .replace(/\*|\#|\-/g, "")
    .trim();
  const lines = content.split("\n").filter(Boolean);
  const arabicTitle = lines[0].slice(0, 70);
  const arabicDesc = lines.slice(1).join(" ").replace(/\s+/g, " ");

  return { arabicTitle, arabicDesc };
}

/* ✅ تصنيف المنتج وتحديثه */
async function processProduct(product) {
  const { id, title, body_html } = product;
  if (product.tags?.includes("AI-Optimized")) return;

  if (cache[id]) {
    log(`⚡ المنتج ${title} موجود في الذاكرة cache – تم تخطيه`);
    return;
  }

  const { arabicTitle, arabicDesc } = await generateArabicContent(
    title,
    body_html || ""
  );

  // 🔍 تحديد التشكيلة
  let { bestMatch, confidence } = detectCollectionWeighted(arabicTitle, arabicDesc);
  if (confidence < 5) bestMatch = await aiFallbackCategorization(arabicTitle, arabicDesc);

  const productType = typeMap[bestMatch] || "منتجات متنوعة";
  const handle = await generateSmartHandle(arabicTitle);

  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    handle,
    product_type: productType,
    tags: `${product.tags || ""}, AI-Optimized`,
  };

  const url = `https://${SHOPIFY_STORE}/admin/api/2024-07/products/${id}.json`;
  await axios.put(
    url,
    { product: payload },
    { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
  );

  cache[id] = { collection: bestMatch, type: productType };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log(`🎯 تم تصنيف المنتج "${arabicTitle}" إلى "${bestMatch}" (${productType})`);
}

/* ✅ Webhooks */
app.post("/webhook/product-created", async (req, res) => {
  try {
    const product = req.body;
    log(`🆕 منتج جديد: ${product.title}`);
    await processProduct(product);
    res.sendStatus(200);
  } catch (e) {
    log(`❌ خطأ أثناء إنشاء المنتج: ${e.message}`);
    res.sendStatus(500);
  }
});

app.post("/webhook/product-updated", async (req, res) => {
  try {
    const product = req.body;
    log(`♻️ تحديث منتج: ${product.title}`);
    await processProduct(product);
    res.sendStatus(200);
  } catch (e) {
    log(`❌ خطأ أثناء التحديث: ${e.message}`);
    res.sendStatus(500);
  }
});

/* ✅ اختبار السيرفر */
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Categorizer v4.0 is running perfectly!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`✅ Server running on port ${PORT}`));
