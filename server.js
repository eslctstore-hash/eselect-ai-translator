// ================== eSelect AI Translator Server ==================
// إعداد السيرفر المتكامل لترجمة وتحسين المنتجات تلقائيًا
// الإصدار: 3.5.0 — 11/10/2025

import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

// ================== إعداد المتغيرات ==================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // https://eselect.store/admin/api

// ================== إعداد السجلات ==================
const logsDir = "./logs";
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
const logFile = path.join(logsDir, "actions.log");
const log = (msg) => {
  const entry = `${new Date().toISOString()} | ${msg}\n`;
  console.log(entry.trim());
  fs.appendFileSync(logFile, entry);
};

// ================== تحميل تشكيلات المتجر ==================
let collectionsMap = {};
try {
  const collectionsPath = new URL("./collections-lite.json", import.meta.url);
  const json = fs.readFileSync(collectionsPath, "utf-8");
  collectionsMap = JSON.parse(json);
  log("✅ تم تحميل ملف التشكيلات بنجاح.");
} catch (err) {
  log("⚠️ لم يتم العثور على ملف التشكيلات، سيتم استخدام تشكيل افتراضي.");
  collectionsMap = { "منتجات متنوعة": ["default", "various", "misc"] };
}

// ================== استخراج تشكيل مناسب من العنوان والوصف ==================
function detectCollection(title = "", description = "") {
  const combined = (title + " " + description).toLowerCase();
  for (const [collection, keywords] of Object.entries(collectionsMap)) {
    for (const word of keywords) {
      if (combined.includes(word.toLowerCase())) {
        return collection;
      }
    }
  }
  return "منتجات متنوعة";
}

// ================== إنشاء Handle متوافق مع SEO ==================
function generateHandle(title) {
  return title
    .toLowerCase()
    .replace(/[^\u0621-\u064A\w]+/g, "-") // أحرف عربية + إنجليزية + أرقام
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ================== ترجمة النصوص عبر OpenAI ==================
async function translateText(text) {
  try {
    const prompt = `ترجم النص التالي إلى العربية بلغة تسويقية احترافية بدون علامات ** أو HTML:
${text}`;
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return (
      response.data.choices?.[0]?.message?.content?.trim() ||
      text ||
      "منتج رائع يستحق التجربة."
    );
  } catch (err) {
    log("❌ خطأ في الترجمة: " + err.message);
    return text;
  }
}

// ================== ترجمة الفارينتات ==================
async function translateVariants(variants = []) {
  const translated = [];
  for (const v of variants) {
    const newV = { ...v };
    for (const key of Object.keys(newV)) {
      if (typeof newV[key] === "string") {
        newV[key] = await translateText(newV[key]);
      }
    }
    translated.push(newV);
  }
  return translated;
}

// ================== تحسين المنتج ==================
async function improveProduct(product, eventType) {
  try {
    const title = product.title || "";
    const description = product.body_html || "";

    log(`🧠 تحسين المنتج: ${title}`);

    // ترجمة العنوان والوصف فقط عند الإنشاء
    const translatedTitle =
      eventType === "create" ? await translateText(title) : title;
    const translatedDescription =
      eventType === "create"
        ? await translateText(description)
        : description.replace(/^(\s*الوصف:|\s*عنوان:)?/gi, "").trim();

    // ترجمة الفارينتس عند الإنشاء فقط
    const translatedVariants =
      eventType === "create"
        ? await translateVariants(product.variants)
        : product.variants;

    // تحديد التشكيلة
    const collection = detectCollection(translatedTitle, translatedDescription);

    // SEO Title & Description
    const seoTitle = translatedTitle.slice(0, 70);
    const seoDesc = translatedDescription.replace(/<[^>]*>/g, "").slice(0, 250);

    // URL Handle
    const handle = generateHandle(title);

    // تحديث المنتج في Shopify
    const updateBody = {
      product: {
        id: product.id,
        title: translatedTitle,
        body_html: translatedDescription,
        handle,
        tags: [collection],
        variants: translatedVariants,
        metafields: [
          {
            namespace: "custom",
            key: "collection_detected",
            value: collection,
            type: "single_line_text_field",
          },
        ],
        seo: {
          title: seoTitle,
          description: seoDesc,
        },
      },
    };

    await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${product.id}.json`,
      updateBody,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        },
      }
    );

    log(`✅ تم تحسين المنتج "${translatedTitle}" وإضافته إلى ${collection}`);
  } catch (err) {
    log("❌ خطأ أثناء تحسين المنتج: " + (err.response?.data || err.message));
  }
}

// ================== Webhooks ==================
app.post("/webhook", async (req, res) => {
  try {
    const product = req.body;
    const eventType = req.headers["x-shopify-topic"]?.includes("create")
      ? "create"
      : "update";

    log(
      `${eventType === "create" ? "🆕" : "♻️"} حدث منتج (${
        product.title
      }) من Shopify`
    );

    await improveProduct(product, eventType);
    res.sendStatus(200);
  } catch (err) {
    log("❌ Webhook Error: " + err.message);
    res.sendStatus(500);
  }
});

// ================== نقطة فحص ==================
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator is running perfectly on Render.");
});

// ================== تشغيل السيرفر ==================
app.listen(PORT, () => log(`✅ Server started successfully on port ${PORT}`));
