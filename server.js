/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Categorizer v6.2 (Robust Edition)
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
const PROCESSED_TAG = "ai-processed"; // **NEW**: Tag to prevent loops

// =============== FILE LOADING & CACHE ===============
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"));
const cachePath = "./cache.json";
let cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf-8"))
  : {};

// =============== LOGGER UTILITY ===============
const log = (step, msg, icon = "✅") => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${icon} [${step}] :: ${msg}`;
  fs.appendFileSync("./logs/actions.log", logMessage + "\n");
  console.log(logMessage);
};

// =============== AI & TRANSLATION HELPERS ===============
async function makeOpenAIRequest(prompt, max_tokens = 1024) { // Increased tokens for better descriptions
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.65,
        max_tokens,
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("AI_ERROR", `❌ OpenAI API call failed: ${errorMessage}`, "❌");
    throw new Error("Failed to communicate with OpenAI");
  }
}

async function translateText(text, type = "title") {
  if (!text || text.trim().length === 0) return "";
  
  // **MODIFIED**: More robust prompt for cleaning and formatting descriptions
  const prompt =
    type === "title"
      ? `Translate this product title to professional, SEO-friendly Arabic. Keep it concise, under 80 characters.\n\nTitle: "${text}"`
      : `Translate and professionally rewrite the following product description into compelling Arabic.
      **Crucially, you must perform these cleaning steps:**
      1.  **Remove all placeholders** like "[Product Name]", "![Product Image]", etc.
      2.  **Delete any markdown titles** (e.g., "# Title", "## Subtitle"), hashtags, or promotional asterisks/stars.
      3.  **Format the final output** with clear, professional headings (using bold text) and bullet points (using '- ' or '• ') for features and specifications.
      4.  The final text must be clean, well-structured, and ready for an e-commerce page, not exceeding 400 words.

      Description to process:\n"${text}"`;
  
  const translated = await makeOpenAIRequest(prompt);
  return translated.replace(/^(العنوان|الوصف|الترجمة)[:：\s]*/i, "");
}

async function translateOptions(options) {
    if (!options || options.length === 0) return [];
    const optionNames = options.map(opt => opt.name).join(', ');
    const prompt = `Translate the following comma-separated product option names to Arabic. Return only the translated, comma-separated list.\n\nOptions: "${optionNames}"`;
    try {
        const translatedString = await makeOpenAIRequest(prompt, 100);
        const translatedNames = translatedString.split(',').map(name => name.trim());
        if (translatedNames.length !== options.length) {
            log("TRANSLATE_OPTIONS", `⚠️ Mismatch in option translation. Original: ${optionNames}, Translated: ${translatedString}`, "⚠️");
            return options;
        }
        return options.map((opt, index) => ({ ...opt, name: translatedNames[index] || opt.name }));
    } catch (error) {
        log("TRANSLATE_OPTIONS", `❌ Failed to translate options: ${error.message}`, "❌");
        return options;
    }
}

// =============== DATA PROCESSING HELPERS ===============
function generateHandle(englishTitle) {
  return englishTitle.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
}

function extractDeliveryDays(htmlDescription) {
  if (!htmlDescription) return "15";
  const match = htmlDescription.match(/(\d{1,2})\s*(?:business\s*)?days?/i);
  return match ? match[1] : "15";
}

function generateSEO(title, description) {
  const cleanDescription = description.replace(/<[^>]+>/g, " ").replace(/\s\s+/g, ' ').trim();
  return {
    seoTitle: title.slice(0, 70),
    seoDescription: cleanDescription.slice(0, 160),
  };
}

// **MODIFIED**: Enhanced categorization logic to check English and Arabic text
function detectCollectionAndType(enTitle, arTitle, arDescription) {
  let bestMatch = { title: "منتجات متنوعة", score: 0 };
  const combinedText = `${arTitle} ${arDescription}`;

  for (const collection of collections) {
    let currentScore = 0;
    for (const keyword of collection.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i"); // case-insensitive check
      // Check English keywords against the original English title (high weight)
      if (/[a-zA-Z]/.test(keyword) && enTitle.match(regex)) currentScore += 5;
      // Check Arabic keywords against translated text
      if (/[\u0600-\u06FF]/.test(keyword) && combinedText.match(regex)) currentScore += 3;
    }
    if (currentScore > bestMatch.score) {
      bestMatch = { title: collection.title, score: currentScore };
    }
  }
  
  const productType = typeMap[bestMatch.title] || "منوعات";
  log("CATEGORIZATION_DEBUG", `Scores: Best match is "${bestMatch.title}" with score ${bestMatch.score}. Assigned Type: "${productType}"`);
  return { collectionTitle: bestMatch.title, productType };
}

// =============== SHOPIFY API HELPERS ===============
async function updateShopifyProduct(productId, payload) {
  try {
    await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`,
      { product: payload },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN, "Content-Type": "application/json" } }
    );
    log("SHOPIFY_UPDATE", `Product ${productId} updated successfully.`);
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ Failed to update product ${productId}: ${errorMessage}`, "❌");
    throw new Error("Shopify API update failed");
  }
}

async function setMetafield(productId, key, value) {
  try {
    await axios.post(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/metafields.json`,
      { metafield: { namespace: "custom", key, value, type: "number_integer", owner_id: productId, owner_resource: "product" } },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("METAFIELD_SET", `Set metafield '${key}' = '${value}' for product ${productId}`);
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data.errors) : err.message;
    log("METAFIELD_ERROR", `❌ Failed to set metafield '${key}': ${errorMessage}`, "❌");
  }
}

// =============== MAIN PRODUCT PROCESSING LOGIC ===============
async function processProduct(product) {
  const { id, title, body_html, options, tags } = product;

  // **MODIFIED**: Robust check to prevent webhook loops using a tag
  if (tags && tags.includes(PROCESSED_TAG)) {
    log("LOOP_PREVENTION", `🔵 Skipping product ${id} because it has the '${PROCESSED_TAG}' tag.`, "🔵");
    return;
  }
  
  log("START_PROCESSING", `🚀 Starting processing for product: "${title}" (ID: ${id})`);

  // 1. Translation (with improved cleaning)
  const [newTitle, newDescription, translatedOptions] = await Promise.all([
      translateText(title, "title"),
      translateText(body_html, "description"),
      translateOptions(options)
  ]);
  log("TRANSLATION", "Title, description, and options translated and cleaned.");

  // 2. Data Extraction and Generation
  const deliveryDays = extractDeliveryDays(body_html);
  log("DELIVERY_INFO", `🚚 Estimated delivery: ${deliveryDays} days`);

  const { collectionTitle, productType } = detectCollectionAndType(title, newTitle, newDescription);
  log("CATEGORIZATION", `🧠 Collection: "${collectionTitle}" | Type: "${productType}"`);

  const newHandle = generateHandle(title);
  log("HANDLE_GENERATION", `🔗 English Handle: ${newHandle}`);

  const { seoTitle, seoDescription } = generateSEO(newTitle, newDescription);
  log("SEO_GENERATION", "SEO Title and Description prepared.");

  // 3. Prepare Shopify Payload
  const updatedTags = `${tags ? tags + ',' : ''}${collectionTitle},${PROCESSED_TAG}`;
  const payload = {
    id,
    title: newTitle,
    body_html: newDescription,
    handle: newHandle,
    product_type: productType,
    tags: updatedTags,
    options: translatedOptions,
    collections: [{ title: collectionTitle }], // Assign to collection
    metafields_global_title_tag: seoTitle,
    metafields_global_description_tag: seoDescription,
  };
  
  // 4. Update Shopify Product & Metafield
  await updateShopifyProduct(id, payload);
  await setMetafield(id, "delivery_days", Number(deliveryDays)); // Ensure value is a number

  log("FINISH", `🎯 Product "${newTitle}" (ID: ${id}) processed successfully!`);
}


// =============== API ROUTES (WEBHOOKS) ===============
app.post("/webhook/product-created", async (req, res) => {
  log("WEBHOOK_RECEIVED", "Product creation webhook.", "🚀");
  res.status(200).send("Webhook received. Processing will start."); // Respond immediately
  try {
    await processProduct(req.body);
  } catch (error) {
    log("PROCESSING_ERROR", `❌ Error in product-created flow: ${error.message}`, "❌");
  }
});

app.post("/webhook/product-updated", async (req, res) => {
  log("WEBHOOK_RECEIVED", "Product update webhook.", "🚀");
  res.status(200).send("Webhook received. Processing will start."); // Respond immediately
  try {
    await processProduct(req.body);
  } catch (error) {
    log("PROCESSING_ERROR", `❌ Error in product-updated flow: ${error.message}`, "❌");
  }
});

app.get("/", (_, res) =>
  res.send(`🚀 eSelect AI Translator & Categorizer v6.2 (Robust Edition) is running!`)
);

app.listen(PORT, () =>
  log("SERVER_START", `Server running on port ${PORT} | Store: ${SHOPIFY_STORE_URL}`, "🚀")
);
