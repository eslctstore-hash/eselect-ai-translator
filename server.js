import express from "express";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";

const app = express();
app.use(express.json());

// 🧩 إعداد المتغيرات
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // مثال: eselect.myshopify.com
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// 📦 تحميل قائمة التشكيلات
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const DEFAULT_COLLECTION = "منتجات متنوعة";

// 🔤 دالة لتوليد handle بالإنجليزية القصيرة
function toEnglishHandle(text) {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .substring(0, 60);
}

// 🔁 دالة معالجة المنتج (تُستخدم في الإنشاء والتحديث)
async function processProduct(product, source = "create") {
  const { id, title, body_html, variants } = product;
  console.log(`⚙️ [${source.toUpperCase()}] معالجة المنتج: ${title} | ID: ${id}`);

  // === إنشاء البرومبت الذكي ===
  const prompt = `
أنت كاتب محتوى تسويقي عربي محترف متخصص في منتجات المتاجر الإلكترونية.
أعد كتابة وصف المنتج أدناه بأسلوب تسويقي HTML أنيق يشمل:
1. عنوان فرعي جذاب.
2. فقرة مقدمة.
3. قائمة مميزات ✅.
4. فقرة "لماذا نوصي به" 🔹.
5. قائمة المواصفات ⚙️.
6. فقرة "محتويات العبوة" 📦 إن توفرت.
7. توليد Page title و Meta description و URL handle بالإنجليزية القصيرة (SEO-ready).
8. نوع المنتج بالعربية.
9. كلمات مفتاحية بالعربية (tags).

المنتج:
العنوان: ${title}
الوصف: ${body_html}
الخيارات (Variants): ${JSON.stringify(variants || [])}
`;

  // === طلب GPT ===
  const completion = await client.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [
      { role: "system", content: "أنت خبير تسويق إلكتروني محترف." },
      { role: "user", content: prompt },
    ],
  });

  const responseText = completion.choices[0].message.content;
  console.log("🧠 مخرجات GPT:\n", responseText);

  // === استخراج القيم ===
  const htmlMatch = responseText.match(/```html([\s\S]*?)```/);
  const newDescription = htmlMatch ? htmlMatch[1].trim() : body_html;

  const typeMatch = responseText.match(/نوع المنتج.*?:\s*(.*)/);
  const newType = typeMatch ? typeMatch[1].trim() : "منتجات متنوعة";

  const tagsMatch = responseText.match(/(?:الكلمات المفتاحية|Tags).*?:\s*(.*)/);
  const newTags = tagsMatch ? tagsMatch[1].replace(/[",]/g, "") : "";

  const seoTitleMatch = responseText.match(/Page title.*?:\s*(.*)/);
  const pageTitle = seoTitleMatch ? seoTitleMatch[1].trim() : title;

  const metaDescMatch = responseText.match(/(?:وصف SEO|Meta description).*?:\s*(.*)/);
  const metaDescription = metaDescMatch ? metaDescMatch[1].trim() : title;

  const urlMatch = responseText.match(/URL.*?[:：]\s*(?:`|\/)?([a-zA-Z0-9\-]+)/);
  const handle = urlMatch ? urlMatch[1].toLowerCase() : toEnglishHandle(title);

  // === تحديد الكولكشن الأنسب ===
  let selectedCollection = DEFAULT_COLLECTION;
  for (const c of collections) {
    if (title.includes(c.split(" ")[0]) || body_html.includes(c.split(" ")[0])) {
      selectedCollection = c;
      break;
    }
  }
  console.log(`📂 الكولكشن المختار: ${selectedCollection}`);

  // === تحديث المنتج في Shopify ===
  try {
    const response = await axios.put(
      `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/products/${id}.json`,
      {
        product: {
          id,
          title: pageTitle,
          body_html: newDescription,
          product_type: newType,
          tags: newTags,
          handle: handle,
          metafields: [
            {
              namespace: "global",
              key: "seo_title",
              type: "single_line_text_field",
              value: pageTitle,
            },
            {
              namespace: "global",
              key: "seo_description",
              type: "multi_line_text_field",
              value: metaDescription,
            },
          ],
        },
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ تم تحديث المنتج بنجاح (${response.status})`);
  } catch (err) {
    console.error("❌ خطأ أثناء تحديث المنتج:", err.response?.data || err.message);
  }

  // === إضافة إلى الكولكشن ===
  try {
    const collectionsRes = await axios.get(
      `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/custom_collections.json`,
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    const found = collectionsRes.data.custom_collections.find(
      (c) => c.title === selectedCollection
    );

    if (found) {
      await axios.post(
        `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/collects.json`,
        { collect: { product_id: id, collection_id: found.id } },
        { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
      );
      console.log(`✅ تمت إضافة المنتج إلى الكولكشن: ${selectedCollection}`);
    } else {
      console.log(`⚠️ لم يتم العثور على الكولكشن: ${selectedCollection}`);
    }
  } catch (err) {
    console.error("⚠️ خطأ في عملية إضافة الكولكشن:", err.response?.data || err.message);
  }
}

// ✅ Webhook عند إنشاء المنتج
app.post("/webhook/product-created", async (req, res) => {
  try {
    await processProduct(req.body, "create");
    res.status(200).send("✅ تم معالجة المنتج الجديد");
  } catch (err) {
    console.error("❌ خطأ في إنشاء المنتج:", err.message);
    res.status(500).send("خطأ في معالجة المنتج الجديد");
  }
});

// ✅ Webhook عند تحديث المنتج
app.post("/webhook/product-updated", async (req, res) => {
  try {
    await processProduct(req.body, "update");
    res.status(200).send("♻️ تم إعادة ترجمة وتحديث المنتج");
  } catch (err) {
    console.error("❌ خطأ في تحديث المنتج:", err.message);
    res.status(500).send("خطأ في معالجة تحديث المنتج");
  }
});

// صفحة اختبار
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v2.7 | Webhooks: Create + Update");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
