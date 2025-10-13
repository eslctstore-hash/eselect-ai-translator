/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Copywriter v7.4 (Professional Variant Prompt)
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
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5, // Slightly lower temperature for more consistent translations
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
  return result.replace(/```html|```/g, "").replace(/"/g, '').trim();
}

// **NEW & IMPROVED**: v7.4 - Professional prompt for variant translation
async function translateProductOptions(product) {
    if (!product.options || product.options.length === 0 || !product.variants) {
        return { variants: product.variants, options: product.options };
    }

    const translationMap = new Map();
    const multilingualPromptTemplate = (items, context) => `
      You are a specialized translation model for e-commerce. Your task is to translate a list of product option ${context} into MODERN STANDARD ARABIC.
      The input language can be anything (English, Spanish, French, Chinese, etc.) or a mix of technical terms.

      **Rules:**
      1.  Translate all text to ARABIC.
      2.  **DO NOT** translate technical specifications, model numbers, or units (e.g., "USB", "12mm", "4GB", "256GB" should remain as they are).
      3.  Translate generic terms like "Type 1", "Default Title", "Standard" into their correct Arabic equivalents (e.g., "النوع 1", "الخيار الافتراضي", "قياسي").
      4.  Return ONLY the translated list, separated by '||', in the exact same order as the input.

      **Input ${context} to translate:**
      ${items.join(' || ')}
    `;

    // 1. Translate Option Names
    const optionNames = product.options.map(opt => opt.name);
    const namesPrompt = multilingualPromptTemplate(optionNames, 'names');
    const translatedNamesStr = await makeOpenAIRequest(namesPrompt, 150);
    const translatedNames = translatedNamesStr.split('||').map(n => n.trim());
    
    // 2. Translate Option Values for each option separately
    for (let i = 0; i < optionNames.length; i++) {
        const uniqueValues = [...new Set(product.variants.map(v => v[`option${i + 1}`]).filter(Boolean))];
        
        if (uniqueValues.length > 0) {
            const valuesPrompt = multilingualPromptTemplate(uniqueValues, `values for "${optionNames[i]}"`);
            const translatedValuesStr = await makeOpenAIRequest(valuesPrompt, 400);
            const translatedValues = translatedValuesStr.split('||').map(v => v.trim());
            
            uniqueValues.forEach((val, index) => {
                if (translatedValues[index] && translatedValues.length === uniqueValues.length) {
                    translationMap.set(val, translatedValues[index]);
                } else {
                    translationMap.set(val, val); // Fallback to original value if translation fails
                }
            });
        }
    }

    // 3. Rebuild product options and variants with translated values
    const newOptions = product.options.map((opt, i) => ({
        ...opt,
        name: (translatedNames[i] && translatedNames.length === optionNames.length) ? translatedNames[i] : opt.name,
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

app.get("/", (_, res) => res.send(`🚀 eSelect AI Translator & Copywriter v7.4 is running!`));

app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
