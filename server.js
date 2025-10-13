/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Categorizer v6.1 (Final)
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
async function makeOpenAIRequest(prompt, max_tokens = 800) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens,
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("AI_ERROR", `❌ An error occurred during OpenAI API call: ${errorMessage}`, "❌");
    throw new Error("Failed to communicate with OpenAI");
  }
}

async function translateText(text, type = "title") {
  if (!text || text.trim().length === 0) return "";
  const prompt =
    type === "title"
      ? `Translate the following product title to professional, SEO-friendly Arabic. Keep it concise and appealing, under 80 characters.\n\nText: "${text}"`
      : `Translate and enhance the following product description into compelling, marketing-focused Arabic. Structure it with clear headings and bullet points for readability. Do not exceed 400 words. \n\nDescription:\n"${text}"`;
  
  const translated = await makeOpenAIRequest(prompt);
  return translated.replace(/^(العنوان|الوصف|الترجمة)[:：\s]*/i, "");
}

async function translateOptions(options) {
    if (!options || options.length === 0) return [];
    const optionNames = options.map(opt => opt.name).join(', ');

    const prompt = `Translate the following comma-separated list of product option names to Arabic. Return only the translated, comma-separated list.\n\nOptions: "${optionNames}"`;
    
    try {
        const translatedString = await makeOpenAIRequest(prompt, 100);
        const translatedNames = translatedString.split(',').map(name => name.trim());
        
        if (translatedNames.length !== options.length) {
            log("TRANSLATE_OPTIONS", `⚠️ Mismatch in option translation length. Original: ${optionNames}, Translated: ${translatedString}`, "⚠️");
            return options;
        }

        return options.map((opt, index) => ({
            ...opt,
            name: translatedNames[index] || opt.name
        }));
    } catch (error) {
        log("TRANSLATE_OPTIONS", `❌ Failed to translate options: ${error.message}`, "❌");
        return options;
    }
}

// =============== DATA PROCESSING HELPERS ===============
function generateHandle(englishTitle) {
  return englishTitle
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove non-alphanumeric chars except space and hyphen
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .slice(0, 70); // Truncate to a reasonable length
}

function extractDeliveryDays(htmlDescription) {
  if (!htmlDescription) return "15";
  const match = htmlDescription.match(/(\d{1,2})\s*(?:business\s*)?days?/i);
  return match ? match[1] : "15";
}

function generateSEO(title, description) {
  const cleanDescription = description.replace(/<[^>]+>/g, " ").replace(/\s\s+/g, ' ').trim();
  return {
    seoTitle: title.slice(0, 70), // Shopify's recommended length
    seoDescription: cleanDescription.slice(0, 160), // Google's recommended length
  };
}

function detectCollectionAndType(title, description) {
  let bestMatch = { title: "منتجات متنوعة", score: 0 };

  for (const collection of collections) {
    let currentScore = 0;
    for (const keyword of collection.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      if (title.match(regex)) currentScore += 3;
      if (description.match(regex)) currentScore += 1;
    }
    if (currentScore > bestMatch.score) {
      bestMatch = { title: collection.title, score: currentScore };
    }
  }
  
  const productType = typeMap[bestMatch.title] || "منوعات";
  return { collectionTitle: bestMatch.title, productType };
}

// =============== SHOPIFY API HELPERS ===============
async function updateShopifyProduct(productId, payload) {
  try {
    const response = await axios.put(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`,
      { product: payload },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN, "Content-Type": "application/json" } }
    );
    log("SHOPIFY_UPDATE", `Successfully updated product: ${payload.title || productId}`);
    return response.data.product;
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ Failed to update product ${productId}: ${errorMessage}`, "❌");
    throw new Error("Shopify API update failed");
  }
}

async function setMetafield(productId, key, value, type = "single_line_text_field") {
  try {
    await axios.post(
      `${SHOPIFY_STORE_URL}/admin/api/2024-07/metafields.json`,
      {
        metafield: {
          namespace: "custom",
          key,
          value,
          type,
          owner_id: productId,
          owner_resource: "product",
        },
      },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN, "Content-Type": "application/json" } }
    );
    log("METAFIELD_SET", `Set metafield '${key}' = '${value}' for product ${productId}`);
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data.errors) : err.message;
    log("METAFIELD_ERROR", `❌ Failed to set metafield '${key}' for product ${productId}: ${errorMessage}`, "❌");
  }
}

// =============== MAIN PRODUCT PROCESSING LOGIC ===============
async function processProduct(product, eventType = "create") {
  const { id, title, body_html, options } = product; // `title` here is the original English title
  const now = Date.now();

  if (cache[id] && (now - cache[id].timestamp < 60000)) {
    log("CACHE_SKIP", `⏳ Skipping product ${id} (updated recently)`);
    return;
  }
  
  log("START_PROCESSING", `🚀 Starting processing for product: "${title}" (ID: ${id}) | Event: ${eventType}`);

  // 1. Translation
  const [newTitle, newDescription, translatedOptions] = await Promise.all([
      translateText(title, "title"),
      translateText(body_html, "description"),
      translateOptions(options)
  ]);
  log("TRANSLATION", "Title, description, and options translated.");

  // 2. Data Extraction and Generation
  const deliveryDays = extractDeliveryDays(body_html);
  log("DELIVERY_INFO", `🚚 Estimated delivery: ${deliveryDays} days`);

  const { collectionTitle, productType } = detectCollectionAndType(newTitle, newDescription);
  log("CATEGORIZATION", `🧠 Collection: "${collectionTitle}" | Type: "${productType}"`);

  // **MODIFIED**: Generate Handle from original English title
  const newHandle = generateHandle(title); 
  log("HANDLE_GENERATION", `🔗 Generated English Handle: ${newHandle}`);

  // **MODIFIED**: Generate SEO data from the new Arabic content
  const { seoTitle, seoDescription } = generateSEO(newTitle, newDescription);
  log("SEO_GENERATION", `📝 SEO Title and Description prepared.`);

  // 3. Prepare Shopify Payload
  const payload = {
    id,
    title: newTitle,
    body_html: newDescription,
    handle: newHandle,
    product_type: productType,
    tags: `${collectionTitle}, ${productType}`,
    options: translatedOptions,
    // **MODIFIED**: Add standard SEO fields directly to the product payload
    metafields_global_title_tag: seoTitle,
    metafields_global_description_tag: seoDescription,
  };

  // 4. Update Shopify Product & Delivery Metafield
  await updateShopifyProduct(id, payload);
  await setMetafield(id, "delivery_days", deliveryDays); // We still need this custom metafield

  // 5. Update Cache and Finalize
  cache[id] = { timestamp: now, title: newTitle };
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));

  log("FINISH", `🎯 Product "${newTitle}" processed successfully!`);
}

// =============== API ROUTES (WEBHOOKS) ===============
app.post("/webhook/product-created", async (req, res) => {
  log("WEBHOOK_RECEIVED", "Product creation webhook received.", "🚀");
  try {
    await processProduct(req.body, "create");
    res.status(200).send("Webhook processed successfully.");
  } catch (error) {
    log("WEBHOOK_ERROR", `❌ Error in product-created webhook: ${error.message}`, "❌");
    res.status(500).send("Internal Server Error");
  }
});

app.post("/webhook/product-updated", async (req, res) => {
    const isArabic = /[\u0600-\u06FF]/.test(req.body.title);
    if (isArabic) {
        log("WEBHOOK_SKIP", "Skipping update for already translated product.", "⚠️");
        return res.status(200).send("Skipped already translated product.");
    }
  
    log("WEBHOOK_RECEIVED", "Product update webhook received.", "🚀");
    try {
        await processProduct(req.body, "update");
        res.status(200).send("Webhook processed successfully.");
    } catch (error) {
        log("WEBHOOK_ERROR", `❌ Error in product-updated webhook: ${error.message}`, "❌");
        res.status(500).send("Internal Server Error");
    }
});

app.get("/", (_, res) =>
  res.send(`🚀 eSelect AI Translator & Categorizer v6.1 (Final) is running!`)
);

app.listen(PORT, () =>
  log("SERVER_START", `Server running on port ${PORT} | Store: ${SHOPIFY_STORE_URL}`, "🚀")
);
