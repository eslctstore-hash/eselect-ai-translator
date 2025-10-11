import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json());

// 🧩 بيانات البيئة
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL; // مثال: eselect.store
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🧠 تهيئة OpenAI
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// ✅ Webhook: عند إضافة منتج جديد
app.post("/webhook/product-created", async (req, res) => {
  try {
    const product = req.body;
    const { id, title, body_html } = product;

    console.log(`🆕 منتج جديد: ${title}`);

    // 🧠 طلب الترجمة + إعادة الصياغة
    const prompt = `
أعد كتابة النص التالي بأسلوب تسويقي احترافي باللغة العربية الفصحى لمتجر إلكتروني.
احرص على تحسين النص لمحركات البحث (SEO) وجعله جذابًا ومقنعًا.
العنوان: ${title}
الوصف: ${body_html}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "أنت كاتب تسويق إلكتروني محترف متخصص في المنتجات." },
        { role: "user", content: prompt },
      ],
    });

    const result = completion.choices[0].message.content;

    // تقسيم العنوان والوصف الجديد
    const [newTitle, ...descParts] = result.split("\n");
    const newDescription = descParts.join("\n");

    // تحديث المنتج داخل Shopify
    await axios.put(
      `https://${SHOPIFY_STORE_URL}/admin/api/2024-10/products/${id}.json`,
      {
        product: {
          id,
          title: newTitle.trim(),
          body_html: newDescription,
          metafields: [
            {
              namespace: "global",
              key: "seo_title",
              type: "single_line_text_field",
              value: newTitle.trim(),
            },
            {
              namespace: "global",
              key: "seo_description",
              type: "multi_line_text_field",
              value: newDescription.substring(0, 150),
            }
          ]
        }
      },
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        }
      }
    );

    console.log("✅ تم تحديث المنتج بالعربية بنجاح 🚀");
    res.status(200).send("تمت الترجمة والتحديث بنجاح");
  } catch (error) {
    console.error("❌ خطأ أثناء الترجمة:", error.message);
    res.status(500).send("حدث خطأ أثناء معالجة الترجمة");
  }
});

// صفحة اختبار
app.get("/", (req, res) => {
  res.send("🚀 eSelect AI Translator Server يعمل بنجاح");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Running on port ${PORT}`));
