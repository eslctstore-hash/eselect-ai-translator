import express from "express";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";

const app = express();
app.use(express.json());

// إعداد مفاتيح البيئة
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // مثل: eselect.store
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// تهيئة OpenAI
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// تحميل قائمة الكولكشنات
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const DEFAULT_COLLECTION = "منتجات متنوعة";

// دالة لتوليد handle إنجليزي قصير
function toEnglishHandle(text) {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .substring(0, 60);
}

// استقبال Webhook عند إنشاء منتج جديد
app.post("/webhook/product-created", async (req, res) => {
  try {
    const product = req.body;
    const { id, title, body_html, variants } = product;
    console.log(`🆕 منتج جديد: ${title}`);

    // 🔹 توليد وصف تسويقي منسق بالعربية
    const prompt = `
أنت خبير تسويق إلكتروني عربي متخصص في كتابة أوصاف المنتجات باحترافية HTML.
أعد صياغة النص التالي بحيث يتضمن:
1. عنوان تسويقي جذاب بالعربية ≤ 70 حرفًا
2. وصف HTML منسق يحتوي على:
   - فقرة مقدمة جذابة
   - قائمة مميزات المنتج ✅
   - فقرة "لماذا نوصي به" 🔹
   - قائمة المواصفات الأساسية ⚙️
   - قسم "محتويات العبوة" 📦 إذا كانت البيانات متوفرة
3. نوع المنتج (Product Type)
4. كلمات مفتاحية بالعربية (Tags)
5. وصف SEO عربي ≤ 155 حرفًا
6. Page title عربي
7. URL بالإنجليزية القصيرة

البيانات الأصلية:
العنوان: ${title}
الوصف: ${body_html}
الخيارات (Variants): ${JSON.stringify(variants || [])}
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "أنت خبير تسويق إلكتروني محترف في كتابة المحتوى العربي لمتاجر Shopify." },
        { role: "user", content: prompt }
      ],
    });

    const result = completion.choices[0].message.content;
    console.log("✅ استجابة GPT:\n", result);

    // استخراج الحقول من الرد
    const lines = result.split("\n").map(l => l.trim()).filter(Boolean);
    const getVal = (n) => lines.find(l => l.startsWith(`${n}.`))?.replace(`${n}.`, "").trim();

    const newTitle = getVal(1) || title;
    const newDescription = getVal(2) || body_html;
    const newType = getVal(3) || "منتجات متنوعة";
    const newTags = getVal(4) || "منتجات";
    const metaDescription = getVal(5) || newTitle;
    const pageTitle = getVal(6) || newTitle;
    const handle = getVal(7) || toEnglishHandle(title);

    // تحديد الكولكشن المناسب
    let selectedCollection = DEFAULT_COLLECTION;
    for (const c of collections) {
      if (title.includes(c.split(" ")[0]) || body_html.includes(c.split(" ")[0])) {
        selectedCollection = c;
        break;
      }
    }

    // تحديث المنتج داخل Shopify
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

    // ربط الكولكشن
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
    res.status(200).send("تم الترجمة والتصنيف والتنسيق بنجاح ✅");

  } catch (err) {
    console.error("❌ خطأ:", err.message);
    res.status(500).send("حدث خطأ أثناء معالجة المنتج");
  }
});

app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator v2.5 يعمل بنجاح");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
