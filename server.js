/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Categorizer v5.4
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

// =============== ENV ===============
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const PORT = process.env.PORT || 3000;

// =============== FILES ===============
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const cachePath = "./cache.json";
let cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
  : {};

// =============== LOGGER ===============
const log = (step, msg, icon = "✅") => {
  const line = `[${new Date().toISOString()}] ${icon} [${step}] ${msg}`;
  fs.appendFileSync("./logs/actions.log", line + "\n");
  console.log(line);
};

// =============== HELPERS ===============
async function translateText(text, type = "title") {
  if (!text) return "";
  const prompt = `
ترجم النص إلى العربية الفصحى باحتراف دون إضافة كلمات مثل "الوصف" أو "العنوان".
${type === "title" ? "اجعل الاسم جذابًا قصيرًا لا يتجاوز 100 حرف." : "اكتب وصفًا تسويقيًا احترافيًا لا يتجاوز 400 كلمة."}
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
    return res.data.choices[0].message.content
      .replace(/(العنوان|الوصف)[:：]/gi, "")
      .replace(/[^\u0600-\u06FF\w\s.,-]/g, "")
      .trim();
  } catch (err) {
    log("AI", `❌ خطأ ترجمة ${type}: ${err.message}`, "❌");
    return text;
  }
}

function generateHandle(name) {
  return name
    .normalize("NFKD")
    .replace(/[\u0600-\u06FF]/g, "") // إزالة الحروف العربية
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
}

function extractDeliveryDays(text) {
  if (!text) return "21";
  const match = text.match(/(\d{1,2})\s*(?:day|days|business)?/i);
  return match ? match[1] : "21";
}

function generateSEO(title, desc) {
  const clean = desc.replace(/<[^>]+>/g, "").replace(/\n/g, " ");
  return {
    seoTitle: title.substring(0, 60),
    seoDesc: clean.substring(0, 155),
  };
}

function detectCollection(title, desc) {
  let match = "منتجات متنوعة";
  let score = 0;
  for (const c of collections) {
    let s = 0;
    for (const k of c.keywords) {
      if (title.includes(k)) s += 3;
      if (desc.includes(k)) s += 1;
    }
    if (s > score) {
      match = c.title;
      score = s;
    }
  }
  return match;
}

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

async function updateShopifyProduct(product, payload) {
  try {
    await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${product.id}.json`,
      { product: payload },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("Shopify", `تم تحديث المنتج ${payload.title}`);
  } catch (err) {
    log("Shopify", `❌ فشل تحديث المنتج: ${err.message}`, "❌");
  }
}

// =============== PROCESS ===============
async function processProduct(product, eventType = "create") {
  const { id, title, body_html, updated_at } = product;
  const now = Date.now();

  // تخطي إذا تم تحديثه قبل أقل من 60 ثانية
  if (cache[id] && now - cache[id].timestamp < 60000) {
    log("Cache", `⏳ تخطي المنتج ${title} (محدث مؤخرًا)`);
    return;
  }

  if (eventType === "update" && (!cache[id] || now - cache[id].timestamp < 30000)) {
    log("Skip", `🛑 تم تخطي المنتج ${title} لأنه تحديث قريب من الإنشاء`);
    return;
  }

  log("Start", `بدء معالجة المنتج: ${title}`);

  const newTitle = await translateText(title, "title");
  const newDesc = await translateText(body_html, "description");
  const deliveryDays = extractDeliveryDays(body_html);
  log("Delivery", `🚚 مدة التوصيل: ${deliveryDays} يوم`);

  const bestMatch = detectCollection(newTitle, newDesc);
  log("Collection", `🧠 التشكيلة: ${bestMatch}`);

  const { seoTitle, seoDesc } = generateSEO(newTitle, newDesc);
  const handle = generateHandle(newTitle);
  log("Handle", `🔗 handle: ${handle}`);

  const payload = {
    id,
    title: newTitle,
    body_html: newDesc,
    handle,
    product_type: bestMatch,
    tags: `${bestMatch}, ${newTitle}`,
  };

  await updateShopifyProduct(product, payload);
  await updateMetafield(id, "delivery_days", deliveryDays);
  await updateMetafield(id, "seo_title", seoTitle);
  await updateMetafield(id, "seo_description", seoDesc);

  cache[id] = { timestamp: now, title: newTitle };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log("Finish", `🎯 المنتج "${newTitle}" تمت معالجته بنجاح | ${bestMatch}`);
}

// =============== ROUTES ===============
app.post("/webhook/product-created", async (req, res) => {
  try {
    await processProduct(req.body, "create");
    res.sendStatus(200);
  } catch (err) {
    log("Error", `إنشاء المنتج: ${err.message}`, "❌");
    res.sendStatus(500);
  }
});

app.post("/webhook/product-updated", async (req, res) => {
  try {
    await processProduct(req.body, "update");
    res.sendStatus(200);
  } catch (err) {
    log("Error", `تحديث المنتج: ${err.message}`, "❌");
    res.sendStatus(500);
  }
});

app.get("/", (_, res) =>
  res.send("🚀 eSelect AI Translator & Categorizer v5.4 is running!")
);

app.listen(PORT, () =>
  log("Server", `✅ Server running on port ${PORT} | ${SHOPIFY_STORE_URL}`)
);
