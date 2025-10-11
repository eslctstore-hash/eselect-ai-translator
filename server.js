import express from "express";
import axios from "axios";
import fs from "fs";
import bodyParser from "body-parser";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(bodyParser.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE = "eselect.store";

// 🧠 تحميل تشكيلات المتجر (نسخة خفيفة)
const collectionsMap = JSON.parse(fs.readFileSync("./collections-lite.json", "utf-8"));

// 🔧 وظيفة مساعدة لتحديد التشكيلة المناسبة
function detectCollection(text) {
  const lowerText = text.toLowerCase();
  let bestMatch = "منتجات متنوعة";
  let maxMatches = 0;

  for (const [collection, keywords] of Object.entries(collectionsMap)) {
    const matches = keywords.filter((k) => lowerText.includes(k)).length;
    if (matches > maxMatches) {
      bestMatch = collection;
      maxMatches = matches;
    }
  }
  return bestMatch;
}

// 🔠 وظيفة لترجمة النصوص باستخدام OpenAI
async function translateText(text) {
  try {
    const prompt = `ترجم النص التالي إلى العربية ترجمة طبيعية واحترافية دون رموز أو HTML:
"${text}"`;
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );

    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("خطأ في الترجمة:", err.message);
    return text;
  }
}

// 🧩 ترجمة الفايرنت (الاسم والقيم)
async function translateVariants(variants) {
  if (!variants) return [];
  const translatedVariants = [];

  for (const variant of variants) {
    const newVariant = { ...variant };
    if (variant.option1) newVariant.option1 = await translateText(variant.option1);
    if (variant.option2) newVariant.option2 = await translateText(variant.option2);
    if (variant.option3) newVariant.option3 = await translateText(variant.option3);
    translatedVariants.push(newVariant);
  }

  return translatedVariants;
}

// 🧠 تحسين بيانات المنتج
async function improveProduct(product) {
  const titleAr = await translateText(product.title);
  const descAr = await translateText(product.body_html);

  const collection = detectCollection(product.title + " " + product.body_html);
  const variants = await translateVariants(product.variants);

  return {
    title: titleAr,
    body_html: descAr,
    tags: collection,
    metafields: [
      {
        namespace: "custom",
        key: "collection_name",
        value: collection,
        type: "single_line_text_field",
      },
    ],
    variants,
  };
}

// ✅ Webhook: عند إنشاء منتج جديد
app.post("/webhook/product-create", async (req, res) => {
  try {
    const product = req.body;
    console.log("🆕 منتج جديد:", product.title);

    const improved = await improveProduct(product);

    await axios.put(
      `https://${SHOPIFY_STORE}/admin/api/2024-07/products/${product.id}.json`,
      { product: improved },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ تم تحديث المنتج ${product.id} بنجاح`);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ خطأ أثناء تحسين المنتج:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("🚀 eSelect AI Translator Running Smoothly"));

app.listen(3000, () => console.log("✅ Server running on port 3000"));
