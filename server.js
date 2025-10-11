import express from "express";
import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== الإعدادات ==================
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;

// ================== تحميل بيانات التشكيلات ==================
let collectionsMap = {};
try {
  const path = new URL("./collections-lite.json", import.meta.url);
  const json = fs.readFileSync(path, "utf-8");
  collectionsMap = JSON.parse(json);
  console.log("✅ تم تحميل ملف التشكيلات بنجاح.");
} catch (err) {
  console.error("⚠️ لم يتم العثور على ملف التشكيلات أو حدث خطأ في قراءته:", err.message);
  collectionsMap = { "منتجات متنوعة": ["منتج", "منتجات", "items"] };
}

// ================== دالة تسجيل ==================
const log = (msg) => {
  const time = new Date().toISOString();
  console.log(`${time} | ${msg}`);
};

// ================== الدالة المساعدة لاختيار التشكيلة ==================
function detectCollection(title, description) {
  title = (title || "").toLowerCase();
  description = (description || "").toLowerCase();

  for (const [collection, keywords] of Object.entries(collectionsMap)) {
    for (const word of keywords) {
      if (title.includes(word) || description.includes(word)) {
        return collection;
      }
    }
  }
  return "منتجات متنوعة";
}

// ================== معالجة الفارينتس ==================
function translateVariants(product) {
  if (!product.variants) return [];

  return product.variants.map((v) => {
    const translated = {};
    Object.keys(v).forEach((key) => {
      let val = v[key];
      if (typeof val === "string") {
        // ترجمة نصوص بسيطة من الإنجليزية إلى العربية بدون تكرار
        val = val
          .replace(/color/i, "اللون")
          .replace(/size/i, "المقاس")
          .replace(/material/i, "الخامة")
          .replace(/type/i, "النوع")
          .replace(/default title/i, "افتراضي");
      }
      translated[key] = val;
    });
    return translated;
  });
}

// ================== الدالة الرئيسية لتحسين المنتج ==================
async function improveProduct(product, eventType) {
  try {
    const title = product.title || "";
    const description = product.body_html || "";
    const collection = detectCollection(title, description);

    // ترجم الفارينتس عند الإنشاء فقط
    const translatedVariants = eventType === "create" ? translateVariants(product) : product.variants;

    const seoDesc = description.slice(0, 250).replace(/<[^>]+>/g, "").trim();
    const seoTitle = title.slice(0, 70);
    const urlHandle = title
      .toLowerCase()
      .replace(/[^a-zA-Z0-9أ-ي]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const updated = {
      product: {
        title,
        body_html: description.replace(/^(\s*الوصف:|\s*عنوان:)?/gi, "").trim(),
        variants: translatedVariants,
        handle: urlHandle,
        metafields: [
          {
            key: "collection_detected",
            namespace: "custom",
            value: collection,
            type: "single_line_text_field"
          }
        ],
        tags: [collection],
        seo: {
          title: seoTitle,
          description: seoDesc
        }
      }
    };

    const res = await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${product.id}.json`,
      updated,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN
        }
      }
    );

    log(`✅ تم تحسين المنتج ${product.title} ووضعه في كولكشن: ${collection}`);
  } catch (err) {
    console.error("❌ خطأ أثناء تحسين المنتج:", err.response?.data || err.message);
  }
}

// ================== Webhooks ==================
app.post("/webhook", async (req, res) => {
  try {
    const product = req.body;
    const eventType = product?.id ? "update" : "create";
    log(`${eventType === "create" ? "🆕" : "♻️"} منتج جديد/محدث: ${product.title}`);
    await improveProduct(product, eventType);
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook Error:", err.message);
    res.sendStatus(500);
  }
});

// ================== اختبار ==================
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator Running Smoothly");
});

// ================== تشغيل السيرفر ==================
app.listen(PORT, () => log(`✅ Server running on port ${PORT}`));
