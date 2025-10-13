/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Copywriter v7.1 (Prompt Corrected)
 * إعداد: سالم السليمي | https://eselect.store
 * تطوير وتحسين: Gemini AI
 */

import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

// =============== CONFIG & ENVIRONMENT VARIABLES ===============
const {
  OPENAI_API_KEY,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_STORE_URL,
  PORT = 3000,
} = process.env;
const PROCESSED_TAG = "ai-processed";

// =============== LOGGER UTILITY ===============
const log = (step, msg, icon = "✅") => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${icon} [${step}] :: ${msg}`;
  fs.appendFileSync("./logs/actions.log", logMessage + "\n");
  console.log(logMessage);
};

// =============== AI & TRANSLATION HELPERS ===============
async function makeOpenAIRequest(prompt, max_tokens = 1024) {
  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.65,
      max_tokens,
    }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } });
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("AI_ERROR", `❌ OpenAI API call failed: ${errorMessage}`, "❌");
    throw new Error("Failed to communicate with OpenAI");
  }
}

async function createContent(enTitle, enDescription, type = "title") {
  if (!enTitle) return "";
  let prompt;

  if (type === "title") {
    prompt = `You are a title specialist. Rewrite the following English product title into a concise, impactful, and SEO-friendly Arabic title. It MUST be short, clear, and focus only on the main product identity. **Maximum 60 characters.**\n\nEnglish Title: "${enTitle}"`;
  } else { // 'description' type
    // **CORRECTED**: Replaced single quotes with backticks (`) for multi-line string
    prompt = `You are an expert Arab e-commerce copywriter and SEO specialist. Your goal is to write a compelling, clean, and professional product description in Arabic.
    
    **Inputs:**
    - English Title: "${enTitle}"
    - English Description: "${enDescription}"

    🎯 مهمتك:
    أنت كاتب محتوى تسويقي محترف متخصص في منتجات التجارة الإلكترونية لمتجر eSelect | إي سيلكت.
    مهمتك إنشاء وصف عربي فخم وجذاب لأي منتج يُقدّم إليك، باستخدام **تنسيق HTML منسق جاهز للعرض في Shopify** (بدون نجوم ولا Markdown).

    🧠 القواعد الأساسية:
    1. لا تترجم حرفيًا — أعد صياغة المحتوى بأسلوب تسويقي عربي فخم وواضح.
    2. احذف أي تحيات أو عبارات عن الشحن أو التواصل.
    3. استخدم لغة عصرية، راقية، وسهلة الفهم.
    4. اجعل الأسلوب متناسقًا مع فئة المنتج (عطور، إكسسوارات، أجهزة، منتجات تجميل...).
    5. استخدم الرموز التعبيرية المناسبة داخل النص HTML لتجميل العرض، مع الالتزام بالتوازن.
    6. لا تضف عنوان رئيسي للمنتج في النص، فقط الوصف والمحتوى.

    ---

    🩵 **هيكل HTML النهائي المطلوب:**

    اكتب الناتج مباشرة بتنسيق HTML كما يلي:

    \`\`\`html
    <p>✨ [فقرة افتتاحية قصيرة ومشوقة تصف المنتج بلغة تسويقية جذابة ومليئة بالإحساس أو الفائدة]</p>

    <h4>💎 المميزات:</h4>
    <ul>
      <li>🌸 [الميزة الأولى]</li>
      <li>💫 [الميزة الثانية]</li>
      <li>🌿 [الميزة الثالثة]</li>
      <li>💋 [الميزة الرابعة]</li>
      <li>🌟 [الميزة الخامسة]</li>
    </ul>

    <h4>📐 المواصفات:</h4>
    <ul>
      <li>المادة: [المادة الأساسية]</li>
      <li>اللون: [اللون أو النمط]</li>
      <li>المعالجة: [إن وجدت]</li>
      <li>الشكل / التصميم: [الوصف الجمالي أو الوظيفي]</li>
      <li>الأبعاد / السعة / الطول: [إن وجدت]</li>
      <li>الفئة المستهدفة: [رجال / نساء / أطفال / عام]</li>
      <li>العناصر المميزة: [عنصر التميز أو التصميم الفريد]</li>
    </ul>

    <h4>🎁 محتويات العبوة:</h4>
    <ul>
      <li>[العنصر 1]</li>
      <li>[العنصر 2]</li>
    </ul>

    <h4>💝 مناسبة لـ:</h4>
    <ul>
      <li>🎀 [المناسبة 1]</li>
      <li>🌹 [المناسبة 2]</li>
      <li>💎 [المناسبة 3]</li>
    </ul>
    \`\`\``;
  }
  
  const result = await makeOpenAIRequest(prompt);
  return result.replace(/"/g, ''); // Clean up quotes
}

// **NEW & IMPROVED**: Robust function to translate options and their values reliably
async function translateProductOptions(product) {
    if (!product.options || product.options.length === 0 || !product.variants) {
        return { variants: product.variants, options: product.options };
    }

    const translationMap = new Map();

    // 1. Translate Option Names (e.g., Color, Size)
    const optionNames = product.options.map(opt => opt.name);
    const namesPrompt = `Translate only the following option names, separated by '||':\n${optionNames.join(' || ')}`;
    const translatedNamesStr = await makeOpenAIRequest(namesPrompt, 150);
    const translatedNames = translatedNamesStr.split('||').map(n => n.trim());
    
    // 2. Translate Option Values for each option separately
    for (let i = 0; i < optionNames.length; i++) {
        const optionName = optionNames[i];
        // Get unique values for this specific option (e.g., for "Color", get "Red", "Blue")
        const uniqueValues = [...new Set(product.variants.map(v => v[`option${i + 1}`]).filter(Boolean))];
        
        if (uniqueValues.length > 0) {
            const valuesPrompt = `Translate only the following values for "${optionName}", separated by '||':\n${uniqueValues.join(' || ')}`;
            const translatedValuesStr = await makeOpenAIRequest(valuesPrompt, 400);
            const translatedValues = translatedValuesStr.split('||').map(v => v.trim());
            
            uniqueValues.forEach((val, index) => {
                if (translatedValues[index]) {
                    translationMap.set(val, translatedValues[index]);
                }
            });
        }
    }

    // 3. Rebuild product options and variants with translated values
    const newOptions = product.options.map((opt, i) => ({
        ...opt,
        name: translatedNames[i] || opt.name,
    }));

    const newVariants = product.variants.map(variant => ({
        ...variant,
        option1: translationMap.get(variant.option1) || variant.option1,
        option2: translationMap.get(variant.option2) || variant.option2,
        option3: translationMap.get(variant.option3) || variant.option3,
    }));

    return { variants: newVariants, options: newOptions };
}


// =============== DATA PROCESSING HELPERS ===============
function generateHandle(englishTitle) {
  return englishTitle.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
}

function generateSEO(title, description) {
  const cleanDescription = description.replace(/<[^>]+>/g, " ").replace(/\s\s+/g, ' ').trim();
  return { seoTitle: title.slice(0, 70), seoDescription: cleanDescription.slice(0, 160) };
}

// =============== SHOPIFY API HELPER ===============
async function updateShopifyProduct(productId, payload) {
  const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`;
  try {
    await axios.put(url, { product: payload }, { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } });
    log("SHOPIFY_UPDATE", `Product ${productId} updated successfully.`);
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ API call to update product failed: ${errorMessage}`, "❌");
    throw new Error(`Shopify API call failed`);
  }
}

// =============== MAIN PRODUCT PROCESSING LOGIC ===============
async function processProduct(product) {
  const { id, title: enTitle, body_html: enDescription, tags } = product;

  if (tags && tags.includes(PROCESSED_TAG)) {
    log("LOOP_PREVENTION", `🔵 Skipping already processed product ${id}.`, "🔵");
    return;
  }
  
  log("START_PROCESSING", `🚀 Starting content generation for: "${enTitle}"`);

  const [newTitle, newDescription, { variants, options }] = await Promise.all([
      createContent(enTitle, null, "title"),
      createContent(enTitle, enDescription, "description"),
      translateProductOptions(product)
  ]);
  log("CONTENT_GENERATION", "Title, description, and variant values created/translated.");

  const newHandle = generateHandle(enTitle);
  const { seoTitle, seoDescription } = generateSEO(newTitle, newDescription);
  
  const deliveryDays = 21;
  const updatedTags = `${tags ? tags + ',' : ''}${PROCESSED_TAG}`;
  
  const payload = {
    id,
    title: newTitle,
    body_html: newDescription,
    handle: newHandle,
    tags: updatedTags,
    variants,
    options,
    metafields_global_title_tag: seoTitle,
    metafields_global_description_tag: seoDescription,
    metafields: [{
      key: "delivery_days",
      namespace: "custom",
      value: String(deliveryDays),
      type: "single_line_text_field"
    }]
  };
  
  await updateShopifyProduct(id, payload);

  log("FINISH", `🎯 Product "${newTitle}" (ID: ${id}) processed successfully!`);
}

// =============== API ROUTES (WEBHOOKS) ===============
app.post("/webhook/:type", async (req, res) => {
  log("WEBHOOK_RECEIVED", `Webhook received for product ${req.params.type}.`, "🚀");
  res.status(200).send("Webhook received.");
  try {
    await processProduct(req.body);
  } catch (error) {
    log("PROCESSING_ERROR", `❌ Error in webhook flow: ${error.message}`, "❌");
  }
});

app.get("/", (_, res) => res.send(`🚀 eSelect AI Translator & Copywriter v7.1 is running!`));

app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
