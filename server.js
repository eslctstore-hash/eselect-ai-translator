/**
 * eSelect | إي سيلكت
 * Shopify Smart Arabic Optimizer v3.0 (Text Edition)
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

const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));

// ✳️ أدوات مساعدة
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanHandle(title) {
  return title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

// ✅ اختيار الكولكشن الذكي (بوزن الكلمات)
function detectCollectionWeighted(title, description) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;

  for (const c of collections) {
    let score = 0;
    for (const k of c.keywords) {
      const regex = new RegExp(k, "i");
      if (regex.test(title)) score += 3;
      else if (regex.test(description)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c.title;
    }
  }

  return bestScore >= 2 ? bestMatch : "منتجات متنوعة";
}

// ✅ توليد العنوان والوصف بالعربية (بدون HTML)
async function generateArabicContent(title, description) {
  const prompt = `
ترجم النص التالي إلى العربية بأسلوب تسويقي احترافي يناسب متجر إلكتروني عماني مثل "إي سيلكت".
- اكتب العنوان بشكل مختصر وجذاب (بحد أقصى 60 حرف).
- اكتب الوصف بالعربية الفصحى فقط، بدون أي رموز أو HTML أو تنسيق خاص.
- اجعل الوصف لا يتجاوز 250 كلمة، ويكون موجهًا للمستهلك.
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

// ✅ ترجمة أي نص للفايرنت (أي خيار أو قيمة)
async function translateToArabic(text) {
  if (!text) return text;
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "ترجم النص التالي إلى العربية فقط بدون شرح:" },
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

// ✅ تحديث المنتج في Shopify
async function updateProductInShopify(productId, data) {
  const url = `https://${SHOPIFY_STORE}/admin/api/2024-07/products/${productId}.json`;
  await axios.put(
    url,
    { product: data },
    { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
  );
  console.log(`✅ تم تحديث المنتج ${productId} بنجاح`);
}

// ✅ معالجة المنتج بالكامل
async function processProduct(product) {
  const { id, title, body_html, variants, options } = product;

  // تخطي المنتج إذا تم تحسينه مسبقًا
  if (product.tags?.includes("AI-Optimized")) {
    console.log(`ℹ️ المنتج ${title} تم تحسينه مسبقًا - تم التخطي`);
    return;
  }

  console.log(`🧠 جاري تحسين المنتج: ${title}`);

  // ترجمة العنوان والوصف
  const { arabicTitle, arabicDesc } = await generateArabicContent(title, body_html);

  // تحديد الكولكشن
  const collection = detectCollectionWeighted(arabicTitle, arabicDesc);
  const handle = cleanHandle(arabicTitle);

  // ترجمة الفايرنت (أيًا كانت)
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

  // بناء البيانات النهائية
  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    handle,
    tags: `${product.tags || ""}, AI-Optimized`,
    product_type: collection,
    options: translatedOptions,
    variants: translatedVariants,
  };

  await updateProductInShopify(id, payload);
  console.log(`🎯 تم تحسين المنتج "${arabicTitle}" ووضعه في كولكشن "${collection}"`);
}

// ✅ Webhook عند إنشاء منتج جديد
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

// ✅ Webhook عند تحديث منتج
app.post("/webhook/product-updated", async (req, res) => {
  try {
    const product = req.body;
    console.log(`♻️ تحديث منتج: ${product.title}`);
    await processProduct(product);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ خطأ أثناء تحديث المنتج:", err.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v3.0 - Arabic Text Edition Running Smoothly");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ السيرفر يعمل على المنفذ ${PORT}`));
