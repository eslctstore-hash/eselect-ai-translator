/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Categorizer v5.2
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

// ================== ENVIRONMENT ==================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const PORT = process.env.PORT || 3000;

// ================== FILES ==================
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const cachePath = "./cache.json";
let cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
  : {};

// ================== LOGGER ==================
const log = (step, msg, icon = "✅") => {
  const line = `[${new Date().toISOString()}] ${icon} [${step}] ${msg}\n`;
  fs.appendFileSync("./logs/actions.log", line);
  console.log(line);
};

// ================== HELPERS ==================
async function translateText(text, type = "title") {
  if (!text) return "";
  const prompt = `
ترجم النص التالي إلى العربية الفصحى بشكل احترافي وواضح وجاذب.
تجنّب استخدام كلمات مثل "العنوان" أو "الوصف".
${
  type === "title"
    ? "اجعله اسم منتج احترافي قصير ومباشر لا يتجاوز 100 حرف."
    : "اجعله وصفًا تسويقيًا احترافيًا لا يتجاوز 400 كلمة ويكون واضحًا ومناسبًا للمتجر الإلكتروني."
}
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

    return content.length > 120 && type === "title"
      ? content.slice(0, 120)
      : content;
  } catch (err) {
    log("AI", `خطأ ترجمة ${type}: ${err.message}`, "❌");
    return text;
  }
}

// مدة التوصيل (من نص أو افتراضي)
function extractDeliveryDays(text) {
  if (!text) return "21";
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
  return {
    seoTitle: title.substring(0, 60),
    seoDesc: cleanDesc.substring(0, 155),
  };
}

// تحديد التشكيلة العربية
function detectCollection(title, description) {
  let bestMatch = "منتجات متنوعة";
  let bestScore = 0;
  for (const c of collections) {
    let score = 0;
    for (const k of c.keywords) {
      if (title.includes(k)) score += 3;
      if (description.includes(k)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = c.title;
    }
  }
  return bestMatch;
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
    log("Metafield", `❌ خطأ في تعيين ${key}: ${err.message}`, "❌");
  }
}

// تحديث المنتج
async function updateShopifyProduct(product, payload) {
  try {
    const { id, ...body } = payload;
    await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${id}.json`,
      { product: body },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("Shopify", `تم تحديث المنتج ${body.title}`);
  } catch (err) {
    log("Shopify", `❌ فشل تحديث المنتج: ${err.message}`, "❌");
  }
}

// ================== MAIN PROCESS ==================
async function processProduct(product) {
  const { id, title, body_html } = product;
  if (cache[id]) return log("Cache", `المنتج ${title} تم معالجته مسبقًا`);

  log("Start", `بدء معالجة المنتج: ${title}`);

  // 1️⃣ ترجمة العنوان والوصف
  const newTitle = await translateText(title, "title");
  const newDesc = await translateText(body_html || "", "description");

  // 2️⃣ تحديد التوصيل
  const deliveryDays = extractDeliveryDays(body_html);
  log("Delivery", `🚚 مدة التوصيل: ${deliveryDays} يوم`);

  // 3️⃣ تحديد التشكيلة
  const bestMatch = detectCollection(newTitle, newDesc);
  log("Collection", `🧠 تم تحديد التشكيلة: ${bestMatch}`);

  // 4️⃣ SEO + handle
  const { seoTitle, seoDesc } = generateSEO(newTitle, newDesc);
  const handle = generateHandle(newTitle);

  // 5️⃣ تجهيز Payload
  const payload = {
    id,
    title: newTitle,
    body_html: newDesc,
    handle,
    product_type: bestMatch,
    tags: `${bestMatch}, ${newTitle}, AI-Auto`,
  };

  // 6️⃣ تحديث Shopify
  await updateShopifyProduct(product, payload);

  // 7️⃣ تحديث ميتافيلد
  await updateMetafield(id, "delivery_days", deliveryDays);
  await updateMetafield(id, "seo_title", seoTitle);
  await updateMetafield(id, "seo_description", seoDesc);

  cache[id] = { updated: true, title: newTitle, collection: bestMatch };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log(
    "Finish",
    `🎯 المنتج "${newTitle}" تم معالجته وتحديثه بنجاح | التشكيلة: ${bestMatch}`
  );
}

// ================== WEBHOOKS ==================
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
  res.send("🚀 eSelect AI Translator & Categorizer v5.2 is running!")
);

app.listen(PORT, () =>
  log("Server", `✅ Server running on port ${PORT} | ${SHOPIFY_STORE_URL}`)
);
