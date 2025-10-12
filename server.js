/**
 * eSelect | إي سيلكت
 * Shopify Smart Arabic Categorizer & SEO v5.1
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

// === Environment ===
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const PORT = process.env.PORT || 3000;

// === Files ===
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"));
const cachePath = "./cache.json";
let cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
  : {};

// === Logger ===
const log = (step, msg, icon = "✅") => {
  const line = `[${new Date().toISOString()}] ${icon} [${step}] ${msg}\n`;
  fs.appendFileSync("./logs/actions.log", line);
  console.log(line);
};

// === Helpers ===

// ترقية العنوان والوصف
async function translateAndEnhance(text, type = "title") {
  if (!text) return "";
  const prompt = `
ترجم النص التالي إلى العربية الفصحى بأسلوب تسويقي جذاب وواضح.
تجنب كتابة كلمات مثل "العنوان" أو "الوصف".
${type === "title"
    ? "اجعله اسم منتج احترافي وواضح ومفهوم."
    : "اجعله وصفًا تسويقيًا احترافيًا لا يتجاوز 250 كلمة."}
النص: ${text}`;

  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 800,
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    const content = res.data.choices[0].message.content
      .replace(/(العنوان|الوصف)[:：]/gi, "")
      .replace(/[*#\-]/g, "")
      .trim();
    return content;
  } catch (err) {
    log("AI", `فشل ترجمة ${type}: ${err.message}`, "❌");
    return text;
  }
}

// استخراج عدد أيام التوصيل
function extractDeliveryDays(text) {
  try {
    const match = text.match(
      /(\d{1,2})\s*[-–]\s*(\d{1,2})|(\d{1,2})\s*(?:day|days|business|working)?/i
    );
    if (match) {
      if (match[1] && match[2]) return `${match[1]}-${match[2]}`;
      if (match[3]) return match[3];
    }
  } catch {}
  return "21";
}

// إنشاء handle URL
function generateHandle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .substring(0, 60);
}

// إنشاء بيانات SEO
function generateSEO(title, desc) {
  const cleanDesc = desc.replace(/<[^>]*>/g, "").replace(/\n/g, " ");
  const seoTitle = title.substring(0, 60);
  const seoDesc = cleanDesc.substring(0, 155);
  return { seoTitle, seoDesc };
}

// تصنيف المنتج حسب الكلمات
function detectCollection(title, description) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;
  for (const c of collections) {
    let score = 0;
    for (const k of c.keywords) {
      const regex = new RegExp(`\\b${k}\\b`, "i");
      if (regex.test(title)) score += 3;
      if (regex.test(description)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c.title;
    }
  }
  return bestMatch;
}

// ترجمة قيم الـ variants فقط
async function translateVariants(product) {
  if (!product.options || product.options.length === 0) return product.options;
  const translated = [];
  for (const opt of product.options) {
    const newValues = await Promise.all(
      opt.values.map((v) => translateAndEnhance(v, "variant"))
    );
    translated.push({ name: opt.name, values: newValues });
  }
  return translated;
}

// تحديث ميتافيلد
async function updateMetafield(productId, key, value) {
  try {
    await axios.post(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/metafields.json`,
      {
        metafield: {
          namespace: "custom",
          key,
          value,
          type: "single_line_text_field",
          owner_resource: "product",
          owner_id: productId,
        },
      },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("Metafield", `تم تعيين ${key} = ${value}`);
  } catch (err) {
    log("Metafield", `خطأ في تعيين ${key}: ${err.message}`, "❌");
  }
}

// تحديث منتج Shopify بدون تعديل الـ options مباشرة
async function updateShopifyProduct(product, payload) {
  try {
    const { id, ...body } = payload;
    await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${product.id}.json`,
      { product: body },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("Shopify", `تم تحديث المنتج ${body.title}`);
  } catch (err) {
    log("Shopify", `فشل تحديث المنتج: ${err.message}`, "❌");
  }
}

// === العملية الرئيسية ===
async function processProduct(product) {
  const { id, title, body_html } = product;
  if (cache[id]) return log("Cache", `المنتج ${title} تم معالجته مسبقًا`);

  log("Start", `بدء معالجة المنتج: ${title}`);

  // 1️⃣ ترجمة وتحسين
  const arabicTitle = await translateAndEnhance(title, "title");
  const arabicDesc = await translateAndEnhance(body_html || "", "description");

  // 2️⃣ ترجمة قيم الفارينت فقط
  const variants = await translateVariants(product);

  // 3️⃣ تحديد التشكيلة
  const bestMatch = detectCollection(arabicTitle, arabicDesc);
  const productType = typeMap[bestMatch] || "منتجات متنوعة";

  // 4️⃣ SEO + handle
  const { seoTitle, seoDesc } = generateSEO(arabicTitle, arabicDesc);
  const handle = generateHandle(arabicTitle);

  // 5️⃣ زمن التوصيل
  const deliveryDays = extractDeliveryDays(body_html);

  // 6️⃣ إعداد البيانات (بدون حقول غير مسموحة)
  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    handle,
    product_type: productType,
    tags: `${bestMatch}, ${productType}, ${arabicTitle}, AI-Optimized`,
  };

  await updateShopifyProduct(product, payload);
  await updateMetafield(id, "delivery_days", deliveryDays);

  // 7️⃣ إضافة ميتافيلد SEO
  await updateMetafield(id, "seo_title", seoTitle);
  await updateMetafield(id, "seo_description", seoDesc);

  cache[id] = { updated: true, title: arabicTitle, collection: bestMatch };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log(
    "Finish",
    `🎯 المنتج "${arabicTitle}" تم معالجته وتحديثه بنجاح | التشكيلة: ${bestMatch}`
  );
}

// === Webhooks ===
app.post("/webhook/product-created", async (req, res) => {
  try {
    await processProduct(req.body);
    res.sendStatus(200);
  } catch (err) {
    log("Error", `أثناء إنشاء المنتج: ${err.message}`, "❌");
    res.sendStatus(500);
  }
});

app.post("/webhook/product-updated", async (req, res) => {
  try {
    await processProduct(req.body);
    res.sendStatus(200);
  } catch (err) {
    log("Error", `أثناء تحديث المنتج: ${err.message}`, "❌");
    res.sendStatus(500);
  }
});

app.get("/", (_, res) =>
  res.send("🚀 eSelect AI Categorizer & Translator v5.1 is running!")
);

app.listen(PORT, () =>
  log("Server", `✅ Server running on port ${PORT} | ${SHOPIFY_STORE_URL}`)
);
