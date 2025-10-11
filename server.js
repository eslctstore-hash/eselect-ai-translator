/**
 * eSelect | إي سيلكت
 * Shopify Smart Arabic Optimizer v2.9
 * مطور خصيصًا لسالم السليمي - متجر eselect.store
 * يقوم بالترجمة، التحسين، وتوزيع المنتجات تلقائياً حسب الفئة.
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

// ✅ أدوات مساعدة
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanHandle(title) {
  return title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

// ✅ تحديد الكولكشن الأنسب
function detectCollection(title, description) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;

  for (const c of collections) {
    const keywords = c.keywords.join(" ");
    const text = `${title} ${description}`;
    const matches = keywords.split(" ").filter((k) =>
      text.includes(k)
    ).length;

    if (matches > bestScore) {
      bestScore = matches;
      bestMatch = c.title;
    }
  }

  return bestMatch || "منتجات متنوعة";
}

// ✅ ترجمة الفارينت (مرة واحدة فقط)
function translateVariant(value) {
  const map = {
    Color: "اللون",
    Size: "المقاس",
    Material: "المادة",
    Type: "النوع",
    Blue: "أزرق",
    Red: "أحمر",
    Green: "أخضر",
    Yellow: "أصفر",
    Black: "أسود",
    White: "أبيض",
    Pink: "وردي",
    Gold: "ذهبي",
    Silver: "فضي",
    Large: "كبير",
    Medium: "متوسط",
    Small: "صغير",
  };
  return map[value] || value;
}

// ✅ إنشاء وصف عربي تسويقي محسّن
async function generateArabicDescription(title, description) {
  const prompt = `
أنت كاتب تسويق محترف. اكتب وصفاً تسويقياً جذاباً ومنسقاً بلغة عربية فصحى متناسقة مع متجر إلكتروني عماني راقٍ.
اجعل الوصف لا يتجاوز 250 كلمة فقط، منسقًا بعناوين فرعية واضحة (h3) ونقاط مميزة باستخدام <ul> و <li> دون أي كود CSS إضافي.
تجنب التكرار أو كتابة "نوع المنتج" أو "الكلمات المفتاحية" داخل الوصف.
العنوان: ${title}
الوصف الأصلي: ${description}
`;

  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a professional Arabic SEO writer." },
        { role: "user", content: prompt },
      ],
      max_tokens: 600,
      temperature: 0.7,
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  return response.data.choices[0].message.content;
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

// ✅ المعالجة العامة
async function processProduct(product) {
  const { id, title, body_html, variants } = product;

  // تجاهل إذا تم تحسينه مسبقاً
  if (product.tags?.includes("AI-Optimized")) {
    console.log(`ℹ️ المنتج ${title} تم تحسينه مسبقاً - تخطي`);
    return;
  }

  console.log(`🧠 تحسين المنتج: ${title}`);

  const newDesc = await generateArabicDescription(title, body_html);
  const collection = detectCollection(title, newDesc);
  const handle = cleanHandle(title);

  const translatedVariants = variants.map((v) => ({
    ...v,
    option1: translateVariant(v.option1),
    option2: translateVariant(v.option2),
  }));

  const payload = {
    id,
    body_html: newDesc,
    handle,
    tags: `${product.tags || ""}, AI-Optimized`,
    product_type: collection,
    options: product.options.map((opt) => ({
      ...opt,
      name: translateVariant(opt.name),
    })),
    variants: translatedVariants,
  };

  await updateProductInShopify(id, payload);
  console.log(`🎯 تم تحسين المنتج ${title} ووضعه في كولكشن ${collection}`);
}

// ✅ Webhook: إنشاء منتج جديد
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

// ✅ Webhook: تحديث منتج
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
  res.send("🚀 eSelect AI Translator v2.9 - Running Smoothly");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ السيرفر يعمل على المنفذ ${PORT}`));
