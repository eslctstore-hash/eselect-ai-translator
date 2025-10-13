/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Categorizer v6.4 (Corrected)
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

// =============== FILE LOADING ===============
const collections = JSON.parse(fs.readFileSync("./collections.json", "utf-8"));
const typeMap = JSON.parse(fs.readFileSync("./typeMap.json", "utf-8"));

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
    log("AI_ERROR", `❌ OpenAI API call failed: ${errorMessage}`, "❌");
    throw new Error("Failed to communicate with OpenAI");
  }
}

async function translateText(text, type = "title") {
  if (!text || !text.trim()) return "";

  let prompt;
  if (type === "title") {
    prompt = `Translate the following product title to concise, impactful Arabic. The title MUST be short, clear, and focus only on the main product function. **Maximum 60 characters.** Remove all unnecessary technical specifications.\n\nTitle: "${text}"`;
  } else {
    prompt = `You are an expert e-commerce copywriter. Translate and rewrite the following product description into professional Arabic. Your task is to extract ONLY the essential features and specifications and present them clearly.
    **You MUST strictly follow these rules:**
    1.  **DELETE all greetings, brand stories, or company introductions** (e.g., "Welcome to our store," "We are a professional factory").
    2.  **DELETE any mentions of customer service** or instructions to contact someone.
    3.  **Focus ONLY on what the product is, what it does, and its specifications.**
    4.  **Structure the output** using a short introductory sentence, followed by a "**المميزات:**" list and a "**المواصفات:**" list using bullet points (e.g., • Point).
    5.  The tone must be objective and product-focused.
    
    Description to process:\n"${text}"`;
  }
  
  const translated = await makeOpenAIRequest(prompt);
  return translated.replace(/^(العنوان|الوصف|الترجمة)[:：\s]*/i, "").replace(/"/g, '');
}

async function translateVariants(product) {
    if (!product.options || !product.variants) return { variants: product.variants, options: product.options };

    const translationMap = new Map();
    
    // Translate option names
    const optionNames = product.options.map(opt => opt.name).join(' || ');
    const translatedNamesStr = await makeOpenAIRequest(`Translate these option names separated by '||': "${optionNames}"`, 100);
    const translatedNames = translatedNamesStr.split('||').map(n => n.trim());

    // Collect all unique option values
    const uniqueValues = new Set();
    product.variants.forEach(variant => {
        if (variant.option1) uniqueValues.add(variant.option1);
        if (variant.option2) uniqueValues.add(variant.option2);
        if (variant.option3) uniqueValues.add(variant.option3);
    });

    if (uniqueValues.size > 0) {
        const valuesStr = Array.from(uniqueValues).join(' || ');
        const translatedValuesStr = await makeOpenAIRequest(`Translate these option values separated by '||': "${valuesStr}"`, 500);
        const translatedValues = translatedValuesStr.split('||').map(v => v.trim());
        
        Array.from(uniqueValues).forEach((val, i) => {
            translationMap.set(val, translatedValues[i] || val);
        });
    }

    // Apply translations
    const translatedVariants = product.variants.map(variant => ({
        ...variant,
        option1: translationMap.get(variant.option1) || variant.option1,
        option2: translationMap.get(variant.option2) || variant.option2,
        option3: translationMap.get(variant.option3) || variant.option3,
    }));
    
    const translatedOptions = product.options.map((opt, i) => ({
        ...opt,
        name: translatedNames[i] || opt.name,
    }));

    return { variants: translatedVariants, options: translatedOptions };
}

// =============== DATA PROCESSING HELPERS ===============
function generateHandle(englishTitle) {
  return englishTitle.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
}

// **CORRECTED**: Re-added the missing generateSEO function
function generateSEO(title, description) {
  const cleanDescription = description.replace(/<[^>]+>/g, " ").replace(/\s\s+/g, ' ').trim();
  return {
    seoTitle: title.slice(0, 70),
    seoDescription: cleanDescription.slice(0, 160),
  };
}

function detectCollectionAndType(enTitle, arTitle, arDescription) {
  let bestMatch = { title: "منتجات متنوعة", score: 0 };
  const combinedText = `${arTitle} ${arDescription}`;

  for (const collection of collections) {
    let currentScore = 0;
    for (const keyword of collection.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, "i");
      // Give higher weight to English keywords matching the original title
      if (/[a-zA-Z]/.test(keyword) && enTitle.match(regex)) currentScore += 10;
      if (/[\u0600-\u06FF]/.test(keyword) && combinedText.match(regex)) currentScore += 3;
    }
    if (currentScore > bestMatch.score) {
      bestMatch = { title: collection.title, score: currentScore };
    }
  }
  const productType = typeMap[bestMatch.title] || "منوعات";
  return { collectionTitle: bestMatch.title, productType };
}

// =============== SHOPIFY API HELPERS ===============
async function makeShopifyRequest(method, endpoint, data = null) {
  const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/${endpoint}`;
  try {
    const response = await axios({ method, url, data, headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } });
    return response.data;
  } catch (err) {
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ API call to ${endpoint} failed: ${errorMessage}`, "❌");
    throw new Error(`Shopify API call failed`);
  }
}

async function assignProductToCollection(productId, collectionTitle) {
  try {
    const { product_collections } = await makeShopifyRequest('get', `collections.json?title=${encodeURIComponent(collectionTitle)}`);
    if (product_collections && product_collections.length > 0) {
      const collectionId = product_collections[0].id;
      await makeShopifyRequest('post', 'collects.json', { collect: { product_id: productId, collection_id: collectionId } });
      log("COLLECTION_ASSIGN", `Assigned product ${productId} to collection "${collectionTitle}"`);
    } else {
      log("COLLECTION_WARN", `⚠️ Collection "${collectionTitle}" not found in Shopify.`, "⚠️");
    }
  } catch (error) {
     log("COLLECTION_ERROR", `❌ Failed to assign collection for product ${productId}.`, "❌");
  }
}

// =============== MAIN PRODUCT PROCESSING LOGIC ===============
async function processProduct(product) {
  const { id, title, body_html, tags } = product;

  if (tags && tags.includes(PROCESSED_TAG)) {
    log("LOOP_PREVENTION", `🔵 Skipping already processed product ${id}.`, "🔵");
    return;
  }
  
  log("START_PROCESSING", `🚀 Starting processing for: "${title}" (ID: ${id})`);

  const [newTitle, newDescription, { variants, options }] = await Promise.all([
      translateText(title, "title"),
      translateText(body_html, "description"),
      translateVariants(product)
  ]);
  log("TRANSLATION", "Title, description, and variant values translated.");

  const { collectionTitle, productType } = detectCollectionAndType(title, newTitle, newDescription);
  log("CATEGORIZATION", `🧠 Collection: "${collectionTitle}" | Type: "${productType}"`);
  
  const newHandle = generateHandle(title);
  // **CORRECTED**: Calling the function correctly
  const { seoTitle, seoDescription } = generateSEO(newTitle, newDescription);

  const deliveryDays = 21;
  const updatedTags = `${tags ? tags + ',' : ''}${collectionTitle},${PROCESSED_TAG}`;
  
  const payload = {
    product: {
      id,
      title: newTitle,
      body_html: newDescription,
      handle: newHandle,
      product_type: productType,
      tags: updatedTags,
      variants,
      options,
      metafields_global_title_tag: seoTitle,
      metafields_global_description_tag: seoDescription,
      metafields: [
        {
          key: "delivery_days",
          namespace: "custom",
          value: deliveryDays,
          type: "number_integer"
        }
      ]
    }
  };
  
  await makeShopifyRequest('put', `products/${id}.json`, payload);
  log("SHOPIFY_UPDATE", `Product ${id} updated with all data.`);

  await assignProductToCollection(id, collectionTitle);

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

app.get("/", (_, res) => res.send(`🚀 eSelect AI Translator v6.4 (Corrected) is running!`));

app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
