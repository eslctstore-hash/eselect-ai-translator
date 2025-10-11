/**
 * eSelect | إي سيلكت
 * Shopify Smart Arabic Optimizer v3.1 Pro (Weighted AI)
 * إعداد: سالم السليمي | eselect.store
 */

import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE = "eselect.store";

// تحميل التشكيلات
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));

// تأخير بسيط للطلبات لتجنب تجاوز الحد
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// تنظيف الرابط
function cleanHandle(title) {
  return title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

/* ✅ خوارزمية تحديد التشكيلة (80% للعنوان و20% للوصف) */
function detectCollectionWeighted(title, description) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;

  for (const c of collections) {
    let score = 0;

    for (const k of c.keywords) {
      const regex = new RegExp(`\\b${k}\\b`, "i");

      // 🔹 العنوان له وزن ×3
      const titleMatches = (title.match(regex) || []).length;
      if (titleMatches > 0) score += titleMatches * 3;

      // 🔹 الوصف له وزن ×1
      const descMatches = (description.match(regex) || []).length;
      if (descMatches > 0) score += descMatches * 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = c.title;
    }
  }

  // 🔹 شرط الحد الأدنى
  return bestScore >= 3 ? bestMatch : "منتجات متنوعة";
}

/* ✅ توليد عنوان ووصف بالعربية (بدون HTML أو رموز) */
async function generateArabicContent(title, description) {
  const prompt = `
ترجم النص التالي إلى العربية الفصحى بأسلوب تسويقي احترافي يناسب متجر إلكتروني عماني مثل "إي سيلكت".
- لا تكتب كلمة "العنوان" أو "الوصف".
- اجعل العنوان موجزًا وجذابًا (حتى 60 حرف).
- اجعل الوصف واضحًا ومقنعًا في حدود 250 كلمة دون تنسيق HTML أو رموز.
العنوان: ${title}
الوصف: ${description}
`;

  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a professional Arabic marketing translator." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 700,
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  const text = res.data.choices[0].message.content
    .replace(/\*|\#|\-/g, "")
    .trim();

  const lines = text.split("\n").filter(Boolean);
  const arabicTitle = lines[0].slice(0, 60);
  const arabicDesc = lines.slice(1).join(" ").replace(/\s+/g, " ");

  return { arabicTitle, arabicDesc };
}

/* ✅ ترجمة الفايرنت (جميع الخيارات والقيم) */
async function translateToArabic(text) {
  if (!text) return text;
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "ترجم النص التالي إلى العربية فقط بدون أي رموز:" },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        max_tokens: 20,
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return res.data.choices[0].message.content.trim();
  } catch {
    return text;
  }
}

/* ✅ تحديث المنتج داخل شوبيفاي */
async function updateProductInShopify(productId, data) {
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-07/products/${productId}.json`;
  await axios.put(
    url,
    { product: data },
    { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
  );
  console.log(`✅ تم تحديث المنتج ${productId} بنجاح`);
}

/* ✅ المعالجة الرئيسية للمنتج */
async function processProduct(product) {
  const { id, title, body_html, variants, options } = product;

  if (product.tags?.includes("AI-Optimized")) {
    console.log(`ℹ️ المنتج "${title}" تم تحسينه مسبقًا - تم التخطي`);
    return;
  }

  console.log(`🧠 جاري تحسين المنتج: ${title}`);

  const { arabicTitle, arabicDesc } = await generateArabicContent(title, body_html);

  const collection = detectCollectionWeighted(arabicTitle, arabicDesc);
  const handle = cleanHandle(arabicTitle);

  // ترجمة خيارات وفايرنتات المنتج
  const translatedOptions = [];
  for (const opt of options) {
    const newName = await translateToArabic(opt.name);
    translatedOptions.push({ ...opt, name: newName });
  }

  const translatedVariants = [];
  for (const v of variants) {
    const newVariant = { ...v };
    if (v.option1) newVariant.option1 = await translateToArabic(v.option1);
    if (v.option2) newVariant.option2 = await translateToArabic(v.option2);
    if (v.option3) newVariant.option3 = await translateToArabic(v.option3);
    translatedVariants.push(newVariant);
  }

  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    handle,
    tags: `${product.tags || ""}, AI-Optimized`,
    product_type: collection,
    options: translatedOptions,
    variants: translatedVariants
  };

  await updateProductInShopify(id, payload);
  console.log(`🎯 تم تحسين المنتج "${arabicTitle}" ووضعه في كولكشن "${collection}"`);
}

/* ✅ Webhook عند إنشاء منتج */
app.post("/webhook/product-created", async (req, res) => {
  try {
    const product = req.body;
    console.log(`🆕 منتج جديد: ${product.title}`);
    await processProduct(product);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ خطأ أثناء معالجة المنتج:", err.message);
    res.sendStatus(500);
  }
});

/* ✅ Webhook عند تعديل منتج */
app.post("/webhook/product-updated", async (req, res) => {
  try {
    const product = req.body;
    console.log(`♻️ تحديث منتج: ${product.title}`);
    await processProduct(product);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ خطأ أثناء التحديث:", err.message);
    res.sendStatus(500);
  }
});

/* ✅ نقطة الفحص */
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v3.1 Pro - Weighted Arabic Optimizer is Running Perfectly");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ السيرفر يعمل على المنفذ ${PORT}`));
