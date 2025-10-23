/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Copywriter v7.8 (Modalyst Integration)
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
app.use(bodyParser.json({ limit: "10mb" }));

// =============== CONFIG & ENVIRONMENT VARIABLES ===============
const {
  OPENAI_API_KEY,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_STORE_URL,
  PORT = 3000,
  BATCH_UPDATE_SECRET
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
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    const errorMessage = err.response
      ? JSON.stringify(err.response.data)
      : err.message;
    log("AI_ERROR", `❌ OpenAI API call failed: ${errorMessage}`, "❌");
    throw new Error("Failed to communicate with OpenAI");
  }
}

async function createContent(enTitle, enDescription, type = "title") {
  if (!enTitle) return "";
  let prompt;

  if (type === "title") {
    prompt = `You are a title specialist. Rewrite the following English product title into a concise, impactful, and SEO-friendly Arabic title. It MUST be short, clear, and focus only on the main product identity. **Maximum 60 characters.**\n\nEnglish Title: "${enTitle}"`;
  } else {
    prompt = `You are an expert Arab e-commerce copywriter. Your task is to generate a professional and attractive product description in clean HTML format.

**Inputs:**
- English Title: "${enTitle}"
- English Description: "${enDescription}"

**Your Generation Principles:**
1. Read and extract all product features and specs.
2. Rewrite in an elegant Arabic marketing tone (no translation).
3. Keep dynamic bullet points for lists.
4. Omit empty sections.
5. No greetings, no brand stories, no emojis.
6. Output only clean HTML.

Structure:
<p>Intro paragraph</p>
<h4>المميزات:</h4><ul><li>...</li></ul>
<h4>المواصفات:</h4><ul><li>...</li></ul>
<h4>محتويات العبوة:</h4><ul><li>...</li></ul>`;
  }

  const result = await makeOpenAIRequest(prompt);
  return result.replace(/```html|```/g, "").replace(/"/g, "").trim();
}

async function translateProductOptions(product) {
  if (!product.options || product.options.length === 0 || !product.variants) {
    return { variants: product.variants, options: product.options };
  }

  const translationMap = new Map();
  const multilingualPromptTemplate = (items, context) => `
    Translate the following product option ${context} into MODERN STANDARD ARABIC.
    - Keep units (e.g., 12mm, 256GB) unchanged.
    - Translate generic words (Type, Default Title) properly.
    Return items separated by '||' in the same order.

    Input:
    ${items.join(" || ")}
  `;

  const optionNames = product.options.map(opt => opt.name);
  const namesPrompt = multilingualPromptTemplate(optionNames, "names");
  const translatedNamesStr = await makeOpenAIRequest(namesPrompt, 150);
  const translatedNames = translatedNamesStr.split("||").map(n => n.trim());

  for (let i = 0; i < optionNames.length; i++) {
    const uniqueValues = [
      ...new Set(product.variants.map(v => v[`option${i + 1}`]).filter(Boolean))
    ];

    if (uniqueValues.length > 0) {
      const valuesPrompt = multilingualPromptTemplate(
        uniqueValues,
        `values for "${optionNames[i]}"`
      );
      const translatedValuesStr = await makeOpenAIRequest(valuesPrompt, 400);
      const translatedValues = translatedValuesStr
        .split("||")
        .map(v => v.trim());

      uniqueValues.forEach((val, index) => {
        translationMap.set(val, translatedValues[index] || val);
      });
    }
  }

  const newOptions = product.options.map((opt, i) => ({
    ...opt,
    name:
      translatedNames[i] && translatedNames.length === optionNames.length
        ? translatedNames[i]
        : opt.name
  }));

  const seen = new Set();
  const newVariants = [];
  for (const variant of product.variants) {
    const optionKey = [
      variant.option1,
      variant.option2,
      variant.option3
    ].filter(Boolean).join(" / ");

    if (!seen.has(optionKey)) {
      seen.add(optionKey);
      newVariants.push({
        ...variant,
        option1: translationMap.get(variant.option1) || variant.option1,
        option2: translationMap.get(variant.option2) || variant.option2,
        option3: translationMap.get(variant.option3) || variant.option3
      });
    } else {
      log(
        "DUPLICATE_VARIANT",
        `Skipping duplicate variant: "${optionKey}" for product ${product.id}`,
        "⚠️"
      );
    }
  }

  return { variants: newVariants, options: newOptions };
}

// =============== SEO HELPERS ===============
function generateHandle(englishTitle) {
  return englishTitle
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 70);
}

function generateSEO(title, description) {
  const cleanDescription = description
    .replace(/<[^>]+>/g, " ")
    .replace(/\s\s+/g, " ")
    .trim();
  return {
    seoTitle: title.slice(0, 70),
    seoDescription: cleanDescription.slice(0, 160)
  };
}

// =============== SHOPIFY API HELPER ===============
async function updateShopifyProduct(productId, payload) {
  const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`;
  try {
    await axios.put(
      url,
      { product: payload },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("SHOPIFY_UPDATE", `Product ${productId} updated successfully.`);
  } catch (err) {
    const errorMessage = err.response
      ? JSON.stringify(err.response.data)
      : err.message;
    log("SHOPIFY_ERROR", `❌ Shopify update failed: ${errorMessage}`, "❌");
  }
}

// =============== MAIN PRODUCT PROCESSING LOGIC ===============
async function processProduct(product, isBatch = false) {
  const { id, title: enTitle, body_html: enDescription, tags } = product;

  if (tags && tags.includes(PROCESSED_TAG) && !isBatch) {
    log("LOOP_PREVENTION", `🔵 Skipping already processed product ${id}`, "🔵");
    return;
  }

  log("START_PROCESSING", `🚀 Processing product: "${enTitle}" (ID: ${id})`);

  try {
    const [newTitle, newDescription, { variants, options }] =
      await Promise.all([
        createContent(enTitle, null, "title"),
        createContent(enTitle, enDescription, "description"),
        translateProductOptions(product)
      ]);

    const newHandle = generateHandle(enTitle);
    const { seoTitle, seoDescription } = generateSEO(newTitle, newDescription);

    // ======== 🕒 Modalyst Delivery & Return Policy Integration ========
    let deliveryDays = "14-21"; // default fallback
    let returnPolicy = "14 يوماً"; // default fallback

    try {
      const modalystData = (product?.body_html || "").toLowerCase();
      const processingMatch = modalystData.match(
        /processing time.*?(\d+)\s*-\s*(\d+)/i
      );
      const deliveryMatch = modalystData.match(
        /estimated delivery.*?(\d+)\s*-\s*(\d+)/i
      );
      const returnMatch = modalystData.match(/(\d+)\s*day return/i);

      if (processingMatch && deliveryMatch) {
        const minDays =
          parseInt(processingMatch[1]) + parseInt(deliveryMatch[1]);
        const maxDays =
          parseInt(processingMatch[2]) + parseInt(deliveryMatch[2]);
        deliveryDays = `${minDays}-${maxDays}`;
      } else if (deliveryMatch) {
        deliveryDays = `${deliveryMatch[1]}-${deliveryMatch[2]}`;
      }

      if (returnMatch) {
        returnPolicy = `${returnMatch[1]} يوماً`;
      }

      log(
        "DELIVERY_INFO",
        `🕒 Delivery days: ${deliveryDays} | Return policy: ${returnPolicy}`
      );
    } catch (e) {
      log("DELIVERY_ERROR", `⚠️ Failed to extract delivery info: ${e.message}`);
    }

    // ======== 🏷️ Tags Update ========
    const originalTags = tags
      ? tags.split(",").map(t => t.trim()).filter(t => t && t !== PROCESSED_TAG)
      : [];
    originalTags.push(PROCESSED_TAG);
    const updatedTags = [...new Set(originalTags)].join(",");

    // ======== 📦 Shopify Payload ========
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
      metafields: [
        {
          key: "delivery_days",
          namespace: "custom",
          value: String(deliveryDays),
          type: "single_line_text_field"
        },
        {
          key: "product_return_policy",
          namespace: "custom",
          value: String(returnPolicy),
          type: "single_line_text_field"
        }
      ]
    };

    await updateShopifyProduct(id, payload);
    log("FINISH", `🎯 Product "${newTitle}" processed successfully.`);
  } catch (error) {
    if (isBatch) {
      log(
        "BATCH_ITEM_ERROR",
        `❌ Error processing product ${id}: ${error.message}`,
        "❌"
      );
    } else {
      throw error;
    }
  }
}

// =============== API ROUTES ===============
app.post("/webhook/:type", async (req, res) => {
  log("WEBHOOK_RECEIVED", `Webhook: ${req.params.type}`, "🚀");
  res.status(200).send("Webhook received.");
  try {
    if (req.body.tags && req.body.tags.includes(PROCESSED_TAG)) return;
    await processProduct(req.body, false);
  } catch (error) {
    log("PROCESSING_ERROR", `❌ Webhook error: ${error.message}`, "❌");
  }
});

app.get("/batch-update", async (req, res) => {
  const { secret, reprocess } = req.query;
  if (!BATCH_UPDATE_SECRET || secret !== BATCH_UPDATE_SECRET)
    return res.status(401).send("Unauthorized");

  res.status(200).send("Batch update started.");
  log("BATCH_START", "🚀 Batch update process started.");

  (async () => {
    try {
      let nextPageInfo = null;
      let productCount = 0;
      const initialUrl = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products.json?limit=50&status=active`;

      const makeRequest = async url => {
        const response = await axios.get(url, {
          headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN }
        });
        const linkHeader = response.headers.link;
        nextPageInfo = null;
        if (linkHeader) {
          const nextLink = linkHeader.split(",").find(s =>
            s.includes('rel="next"')
          );
          if (nextLink) nextPageInfo = nextLink.match(/<(.*?)>/)[1];
        }
        return response.data.products;
      };

      let products = await makeRequest(initialUrl);

      while (products && products.length > 0) {
        for (const product of products) {
          productCount++;
          const shouldProcess =
            reprocess === "true" ||
            !product.tags ||
            !product.tags.includes(PROCESSED_TAG);
          if (shouldProcess) await processProduct(product, true);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (nextPageInfo) products = await makeRequest(nextPageInfo);
        else break;
      }

      log("BATCH_COMPLETE", `✅ Batch done. ${productCount} products processed.`);
    } catch (error) {
      log("BATCH_ERROR", `❌ Batch update failed: ${error.message}`);
    }
  })();
});

app.get("/", (_, res) =>
  res.send(`🚀 eSelect AI Translator v7.8 is running!`)
);

app.listen(PORT, () =>
  log("SERVER_START", `Server running on port ${PORT}`, "🚀")
);
