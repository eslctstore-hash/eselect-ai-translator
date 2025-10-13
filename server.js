/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Copywriter v7.3 (Dynamic Prompt)
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
      model: "gpt-4o", // Upgraded to gpt-4o for better instruction following
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
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
    // **CORRECTED**: New dynamic prompt that focuses on principles, not a fixed template.
    prompt = `You are an expert Arab e-commerce copywriter. Your task is to generate a professional and attractive product description in clean HTML format.

    **Inputs:**
    - English Title: "${enTitle}"
    - English Description: "${enDescription}"

    **Your Generation Principles:**
    1.  **Analyze and Extract:** Read the English inputs carefully and identify ALL relevant features, technical specifications, and package contents.
    2.  **Rewrite, Don't Translate:** Craft new sentences in an elegant and persuasive Arabic marketing style.
    3.  **Dynamic Lists:** The number of bullet points in each list MUST match the number of details you extract. If a product has 7 features, you must create 7 list items. If it has 2, create 2.
    4.  **Omit Empty Sections:** If you cannot find any information for a section (e.g., no package contents are mentioned), you MUST omit the entire HTML section for it (the heading and the list).
    5.  **No Fluff:** Strictly remove all greetings, brand stories, contact info, and emojis.
    6.  **Output Format:** Generate only the clean HTML code based on the principles below.

    ---

    **Required Content and Structure:**
    - **Paragraph:** Start with a short, enticing introductory paragraph (\`<p>\`).
    - **Features Heading:** Use \`<h4>المميزات:</h4>\`.
    - **Features List:** Below the heading, create a \`<ul>\` list. For every feature you identified, add a \`<li>\` item.
    - **Specifications Heading:** Use \`<h4>المواصفات:</h4>\`.
    - **Specifications List:** Below the heading, create a \`<ul>\` list. For every specification you identified (material, color, dimensions, etc.), add a \`<li>\` item.
    - **Package Contents Heading:** Use \`<h4>محتويات العبوة:</h4>\`.
    - **Package Contents List:** Below the heading, create a \`<ul>\` list. For every item in the package, add a \`<li>\` item.
    `;
  }
  
  const result = await makeOpenAIRequest(prompt);
  // Clean up markdown code block fences if the AI adds them
  return result.replace(/```html|```/g, "").replace(/"/g, '').trim();
}


// IMPROVED: Robust function to translate options and their values reliably
async function translateProductOptions(product) {
    if (!product.options || product.options.length === 0 || !product.variants) {
        return { variants: product.variants, options: product.options };
    }

    const translationMap = new Map();

    const optionNames = product.options.map(opt => opt.name);
    const namesPrompt = `Translate only the following option names, separated by '||':\n${optionNames.join(' || ')}`;
    const translatedNamesStr = await makeOpenAIRequest(namesPrompt, 150);
    const translatedNames = translatedNamesStr.split('||').map(n => n.trim());
    
    for (let i = 0; i < optionNames.length; i++) {
        const optionName = optionNames[i];
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

app.get("/", (_, res) => res.send(`🚀 eSelect AI Translator & Copywriter v7.3 is running!`));

app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
