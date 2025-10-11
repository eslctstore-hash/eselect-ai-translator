import express from "express";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";

const app = express();
app.use(express.json());

// 🧩 مفاتيح البيئة
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // مثال: eselect.store
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🧠 تهيئة OpenAI
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// 🗂 تحميل الكولكشنات الجاهزة
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const DEFAULT_COLLECTION = "منتجات متنوعة";

// 🔹 دالة مساعدة لتوليد URL إنجليزي قصير
function toEnglishHandle(text) {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .substring(0, 60);
}

// ✅ Webhook: عند إنشاء منتج جديد
app.post("/webhook/product-created", async (req, res) => {
  try {
    const product = req.body;
    const { id, title, body_html, variants } = product;

    console.log(`🆕 منتج جديد: ${title}`);

    // 🧠 توليد وصف وعنوان وSEO بالعربية
    const prompt = `
حلّل النص أدناه واكتب:
1. عنوان تسويقي عربي لا يتجاوز 70 حرفًا
2. وصف HTML منسق بالعربية بأسلوب تسويقي احترافي وجذاب لمتجر إلكتروني
3. نوع المنتج (Product Type)
4. كلمات مفتاحية (Tags) بالعربية
5. وصف SEO عربي قصير (≤155 حرف)
6. توليد عنوان صفحة SEO (Page Title)
7. اقتراح URL بالإنجليزية القصيرة (مستمدة من الاسم العربي لكن بحروف إنجليزية فقط)

النص:
العنوان: ${title}
الوصف: ${body_html}
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت خبير تسويق إلكتروني متخصص في المنتجات." },
        { role: "user", content: prompt }
      ]
    });

    const aiResponse = completion.choices[0].message.content;

    console.log("✅ استجابة الذكاء الاصطناعي:\n", aiResponse);

    // 🧩 تحليل الناتج (استخراج الحقول تلقائيًا)
    const lines = aiResponse.split("\n").map(l => l.trim()).filter(Boolean);
    const newTitle = lines.find(l => l.startsWith("1."))?.replace("1.", "").trim() || title;
    const newDescription = lines.find(l => l.startsWith("2."))?.replace("2.", "").trim() || body_html;
    const newType = lines.find(l => l.startsWith("3."))?.replace("3.", "").trim() || "منتجات متنوعة";
    const newTags = lines.find(l => l.startsWith("4."))?.replace("4.", "").trim() || "متنوعة";
    const metaDescription = lines.find(l => l.startsWith("5."))?.replace("5.", "").trim() || newTitle;
    const pageTitle = lines.find(l => l.startsWith("6."))?.replace("6.", "").trim() || newTitle;
    const handle = lines.find(l => l.startsWith("7."))?.replace("7.", "").trim() || toEnglishHandle(title);

    // 🏷️ تحديد الكولكشن المناسب
    let selectedCollection = DEFAULT_COLLECTION;
    for (const c of collections) {
      if (title.includes(c.split(" ")[0]) || body_html.includes(c.split(" ")[0])) {
        selectedCollection = c;
        break;
      }
    }

    // 🔹 تحديث المنتج في Shopify
    await axios.put(
      `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/products/${id}.json`,
      {
        product: {
          id,
          title: newTitle,
          body_html: newDescription,
          product_type: newType,
          tags: newTags,
          handle: handle,
          metafields: [
            {
              namespace: "global",
              key: "seo_title",
              type: "single_line_text_field",
              value: pageTitle
            },
            {
              namespace: "global",
              key: "seo_description",
              type: "multi_line_text_field",
              value: metaDescription
            }
          ]
        }
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    // 🔹 ربط الكولكشن
    const allCollections = await axios.get(
      `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/custom_collections.json`,
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );

    const found = allCollections.data.custom_collections.find(c => c.title === selectedCollection);
    if (found) {
      await axios.post(
        `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/collects.json`,
        {
          collect: { product_id: id, collection_id: found.id }
        },
        {
          headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN }
        }
      );
    }

    console.log(`✅ تم تصنيف المنتج إلى كولكشن: ${selectedCollection}`);
    res.status(200).send("تم الترجمة والتصنيف بنجاح ✅");

  } catch (error) {
    console.error("❌ خطأ:", error.message);
    res.status(500).send("حدث خطأ أثناء معالجة المنتج");
  }
});

app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v2 يعمل بنجاح");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
