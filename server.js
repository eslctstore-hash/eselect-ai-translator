import express from "express";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";

const app = express();
app.use(express.json());

// 🔐 مفاتيح البيئة
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // مثل: eselect.myshopify.com
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// 📦 تحميل قائمة التشكيلات
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const DEFAULT_COLLECTION = "منتجات متنوعة";

// 🔤 دالة لتوليد handle قصير بالإنجليزية
function toEnglishHandle(text) {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .substring(0, 60);
}

// 🧼 دالة تنظيف النصوص
function clean(str) {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, "") // إزالة HTML
    .replace(/[*#":]/g, "") // إزالة رموز
    .replace(/\s{2,}/g, " ") // مسافات زائدة
    .trim();
}

// 🧠 معالجة المنتج (إنشاء أو تحديث)
async function processProduct(product, source = "create") {
  const { id, title, body_html, variants } = product;
  console.log(`⚙️ [${source.toUpperCase()}] معالجة المنتج: ${title} | ID: ${id}`);

  const prompt = `
أنت خبير تسويق إلكتروني محترف. أعد كتابة وصف المنتج أدناه بالعربية بتنسيق HTML أنيق يشمل:
1. مقدمة جذابة.
2. قسم "مواصفات المنتج" مع نقاط ✅.
3. قسم "محتويات العبوة" 📦.
4. نوع المنتج بالعربية.
5. وسوم (كلمات مفتاحية) بالعربية.
6. Page title و Meta description بالعربية.
7. توليد URL handle بالإنجليزية.

العنوان: ${title}
الوصف الأصلي: ${body_html}
الخيارات: ${JSON.stringify(variants || [])}
`;

  try {
    // === طلب GPT ===
    const completion = await client.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "أنت كاتب محتوى تسويقي محترف للمنتجات العربية." },
        { role: "user", content: prompt },
      ],
    });

    const responseText = completion.choices[0].message.content;
    console.log("🧠 استجابة GPT:\n", responseText);

    // === استخراج الحقول ===
    const htmlMatch = responseText.match(/```html([\s\S]*?)```/);
    let newDescription = htmlMatch ? htmlMatch[1].trim() : body_html;
    newDescription = `
<div dir="rtl" style="font-family:'Tajawal',sans-serif;line-height:1.8;">
${newDescription}
</div>`;

    const typeMatch = responseText.match(/نوع المنتج.*?:\s*(.*)/);
    const newType = clean(typeMatch ? typeMatch[1] : "منتجات متنوعة");

    const tagsMatch = responseText.match(/(?:الكلمات المفتاحية|Tags).*?:\s*(.*)/);
    const newTags = clean(tagsMatch ? tagsMatch[1] : "");

    const seoTitleMatch = responseText.match(/Page title.*?:\s*(.*)/);
    const pageTitle = clean(seoTitleMatch ? seoTitleMatch[1] : title);

    const metaDescMatch = responseText.match(/(?:وصف SEO|Meta description).*?:\s*(.*)/);
    const metaDescription = clean(metaDescMatch ? metaDescMatch[1] : title);

    const urlMatch = responseText.match(/URL.*?[:：]\s*(?:`|\/)?([a-zA-Z0-9\-]+)/);
    const handle = urlMatch ? urlMatch[1].toLowerCase() : toEnglishHandle(title);

    // === تحديد الكولكشن المناسب ===
    let selectedCollection = DEFAULT_COLLECTION;
    for (const c of collections) {
      if (title.includes(c.split(" ")[0]) || body_html.includes(c.split(" ")[0])) {
        selectedCollection = c;
        break;
      }
    }
    console.log(`📂 الكولكشن المختار: ${selectedCollection}`);

    // === تحديث المنتج في Shopify ===
    const updateResponse = await axios.put(
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

    console.log(`✅ تم تحديث المنتج بنجاح (${updateResponse.status})`);

    // === إضافة المنتج إلى الكولكشن ===
    const collectionsRes = await axios.get(
      `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/custom_collections.json`,
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    const found = collectionsRes.data.custom_collections.find(
      (c) => c.title === selectedCollection
    );

    if (found) {
      const collectsRes = await axios.get(
        `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/collects.json?product_id=${id}`,
        { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
      );
      const alreadyInCollection = collectsRes.data.collects.some(
        (c) => c.collection_id === found.id
      );

      if (!alreadyInCollection) {
        await axios.post(
          `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/collects.json`,
          { collect: { product_id: id, collection_id: found.id } },
          { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
        );
        console.log(`✅ تمت إضافة المنتج إلى الكولكشن: ${selectedCollection}`);
      } else {
        console.log(`ℹ️ المنتج موجود مسبقًا في الكولكشن: ${selectedCollection}`);
      }
    } else {
      console.log(`⚠️ لم يتم العثور على الكولكشن: ${selectedCollection}`);
    }
  } catch (err) {
    console.error("❌ خطأ أثناء المعالجة:", err.response?.data || err.message);
  }
}

// ✅ Webhooks
app.post("/webhook/product-created", async (req, res) => {
  await processProduct(req.body, "create");
  res.status(200).send("✅ تم معالجة المنتج الجديد");
});

app.post("/webhook/product-updated", async (req, res) => {
  await processProduct(req.body, "update");
  res.status(200).send("♻️ تم إعادة تحسين المنتج المحدث");
});

app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v2.8 | Clean & Safe Update");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
