/**
 * eSelect | إي سيلكت
 * Smart AI Translator & Categorizer v5.2 (Shopify + Dropshipping Enhanced)
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

// ================== ENV VARIABLES ==================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL.replace(/^https?:\/\//, "");

// ================== FILES ==================
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = fs.existsSync("./typeMap.json")
  ? JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"))
  : {};
const cachePath = "./cache.json";
if (!fs.existsSync("./logs")) fs.mkdirSync("./logs");
if (!fs.existsSync(cachePath)) fs.writeFileSync(cachePath, "{}");
let cache = JSON.parse(fs.readFileSync(cachePath, "utf-8"));

// ================== LOGGER ==================
const log = (msg) => {
  const time = new Date().toISOString();
  fs.appendFileSync("./logs/actions.log", `[${time}] ${msg}\n`);
  console.log(msg);
};

// ================== HELPERS ==================
function cleanText(txt = "") {
  return txt
    .replace(/[*#:\-]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/(العنوان|عنوان المنتج|الوصف)[:：]?\s*/gi, "")
    .trim();
}

async function openaiChat(prompt, model = "gpt-4o-mini", temperature = 0.6) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  return res.data.choices[0].message.content.trim();
}

// ================== HANDLE GENERATOR ==================
async function generateSmartHandle(title) {
  try {
    const prompt = `Generate a short, SEO-friendly English slug for this title (max 50 chars, lowercase, hyphen-separated):\n${title}`;
    const slug = await openaiChat(prompt);
    return slug
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .substring(0, 50);
  } catch {
    return title.toLowerCase().replace(/\s+/g, "-").substring(0, 50);
  }
}

// ================== COLLECTION DETECTION ==================
function detectCollectionWeighted(title, description) {
  let best = "منتجات متنوعة";
  let bestScore = 0;

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

async function aiFallbackCategorization(title, description) {
  const prompt = `
صنف المنتج التالي ضمن إحدى الفئات التالية:
${collections.map((c) => `- ${c.title}`).join("\n")}
العنوان: ${title}
الوصف: ${description}
أجب فقط باسم التشكيلة المناسبة دون أي شرح إضافي.
`;
  return await openaiChat(prompt, "gpt-4o-mini");
}

// ================== ARABIC CONTENT GENERATION ==================
async function generateArabicContent(title, description) {
  const prompt = `
أعد صياغة العنوان والوصف التاليين بأسلوب احترافي ومقنع باللغة العربية الفصحى.
الهدف: تحسين الوضوح، الجاذبية، والسيو دون تغيير جوهر المنتج.
- لا تكتب "العنوان" أو "الوصف".
- استخدم صياغة تسويقية واقعية مثل "هاتف سامسونج S24 ألترا 256 جيجابايت".
العنوان: ${title}
الوصف: ${description}
`;
  const text = await openaiChat(prompt, "gpt-4o");
  const content = cleanText(text);
  const lines = content.split("\n").filter(Boolean);
  const arabicTitle = cleanText(lines[0]).slice(0, 90);
  const arabicDesc = cleanText(lines.slice(1).join(" "));
  return { arabicTitle, arabicDesc };
}

// ================== VARIANTS TRANSLATION ==================
async function translateVariants(variants = []) {
  const translated = [];
  for (const v of variants) {
    try {
      const prompt = `ترجم بيانات الفارينت التالية إلى العربية فقط دون رموز أو شرح:\n${JSON.stringify(
        v,
        null,
        2
      )}`;
      const text = await openaiChat(prompt, "gpt-4o-mini");
      translated.push(JSON.parse(text));
    } catch {
      translated.push(v);
    }
  }
  return translated;
}

// ================== DELIVERY DAYS DETECTION ==================
function detectDeliveryDays(text) {
  if (!text) return null;

  // نمط مزدوج مثل "2-5 أيام" أو "7 إلى 21"
  const range = text.match(
    /(\d+)\s*(?:[-–~إلىto]{1,3})\s*(\d+)\s*(?:day|days|business|working|أيام|يوم)?/i
  );
  if (range) return `${range[1]}-${range[2]}`;

  // نمط مفرد مثل "Shipping time: 14 Business Days" أو "Ships in 5 days"
  const single = text.match(
    /(?:shipping|delivery|processing|ships)\s*(?:time|in|:)?\s*(\d+)\s*(?:day|days|business|working|يوم|أيام)/i
  );
  if (single) return single[1];

  return null;
}

// ================== PRODUCT PROCESSING ==================
async function processProduct(product) {
  const { id, title, body_html, variants } = product;
  if (product.tags?.includes("AI-Optimized")) return;
  if (cache[id]) {
    log(`⚡ المنتج ${title} موجود في الذاكرة — تم تخطيه`);
    return;
  }

  // --- ترجمة وصياغة ---
  const { arabicTitle, arabicDesc } = await generateArabicContent(
    title,
    body_html || ""
  );

  // --- تحديد التشكيلة ---
  let { best, score } = detectCollectionWeighted(arabicTitle, arabicDesc);
  if (score < 5) best = await aiFallbackCategorization(arabicTitle, arabicDesc);
  const productType = typeMap[best] || "منتجات متنوعة";

  // --- ترجمة Variants ---
  const translatedVariants = await translateVariants(variants);

  // --- اكتشاف زمن التوصيل ---
  const delivery = detectDeliveryDays(body_html || arabicDesc);

  // --- إنشاء handle ---
  const handle = await generateSmartHandle(arabicTitle);

  // --- تحديث Shopify ---
  const payload = {
    id,
    title: arabicTitle,
    body_html: arabicDesc,
    handle,
    product_type: productType,
    variants: translatedVariants,
    tags: `${product.tags || ""}, ${best}, AI-Optimized`,
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

  log(
    `🎯 [${best}] ✅ ${arabicTitle} | زمن التوصيل: ${delivery || "غير محدد"}`
  );
}

// ================== WEBHOOKS ==================
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

// ================== TEST ROUTE ==================
app.get("/", (req, res) =>
  res.send("🚀 eSelect AI Translator & Categorizer v5.2 Pro — Running Perfectly!")
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log(`✅ Server running on port ${PORT}`));
