/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Copywriter v7.9.1 (GraphQL + Smart Option Filter + Dual Loop Protection)
 * إعداد: سالم السليمي | https://eselect.store
 * تطوير وتحسين: Gemini AI
 */
import autotagRoute from "./routes/autotag.js";
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(bodyParser.json({ limit: "10mb" }));
app.use("/autotag", autotagRoute);

// =============== CONFIG ===============
const {
  OPENAI_API_KEY,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_STORE_URL,
  PORT = 3000,
  BATCH_UPDATE_SECRET
} = process.env;

const PROCESSED_TAG = "ai-processed";
const LAST_PROCESSED_META_KEY = "ai_last_processed";

// =============== LOGGER ===============
const log = (step, msg, icon = "✅") => {
  const time = new Date().toISOString();
  const logLine = `[${time}] ${icon} [${step}] :: ${msg}`;
  fs.appendFileSync("./logs/actions.log", logLine + "\n");
  console.log(logLine);
};

// =============== HELPERS ===============
async function getProductMetafields(productId) {
  const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}/metafields.json`;
  const res = await axios.get(url, { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } });
  return res.data.metafields || [];
}

async function updateMetafield(productId, key, value) {
  try {
    const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/metafields.json`;
    await axios.post(
      url,
      {
        metafield: {
          namespace: "custom",
          key,
          value,
          type: "single_line_text_field",
          owner_resource: "product",
          owner_id: productId
        }
      },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("META_UPDATE", `🕓 Updated ${key} for product ${productId}`);
  } catch (err) {
    log("META_ERROR", err.message, "⚠️");
  }
}

// =============== OPENAI HELPER ===============
async function makeOpenAIRequest(prompt, max_tokens = 1024) {
  try {
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    const e = err.response ? JSON.stringify(err.response.data) : err.message;
    log("AI_ERROR", e, "❌");
    throw new Error("OpenAI call failed");
  }
}

// =============== CONTENT GENERATION ===============
async function createContent(enTitle, enDescription, type = "title") {
  if (!enTitle) return "";
  const prompt =
    type === "title"
      ? `Rewrite this English product title into a concise Arabic title (≤60 chars), SEO-friendly:\n"${enTitle}"`
      : `Generate Arabic HTML description from:\nTitle: "${enTitle}"\n\nDescription:\n"${enDescription}"`;
  const result = await makeOpenAIRequest(prompt);
  return result.replace(/```html|```/g, "").replace(/"/g, "").trim();
}

// =============== OPTION TRANSLATION (unchanged) ===============
// (نفس كودك تمامًا بدون تعديل)
async function translateProductOptions(product) {
  if (!product.options || product.options.length === 0 || !product.variants)
    return { variants: product.variants, options: product.options };

  const translationMap = new Map();
  const shouldKeepOriginal = val => /^[A-Za-z0-9]{1,3}$/.test(val);

  const multilingualPrompt = (items, context) => `
Translate the following product option ${context} into MODERN STANDARD ARABIC.
- Keep units unchanged (e.g. 256GB, 12mm)
- Keep single letters/numbers as-is.
Return items separated by "||" in the same order.
Input:
${items.join(" || ")}
`;

  const optionNames = product.options.map(o => o.name);
  const namesPrompt = multilingualPrompt(optionNames, "names");
  const translatedNamesStr = await makeOpenAIRequest(namesPrompt, 200);
  const translatedNames = translatedNamesStr.split("||").map(t => t.trim());

  for (let i = 0; i < optionNames.length; i++) {
    const uniqueValues = [
      ...new Set(product.variants.map(v => v[`option${i + 1}`]).filter(Boolean))
    ];

    if (uniqueValues.length > 0) {
      const valuesPrompt = multilingualPrompt(uniqueValues, `values for "${optionNames[i]}"`);
      const translatedValuesStr = await makeOpenAIRequest(valuesPrompt, 400);
      const translatedValues = translatedValuesStr.split("||").map(v => v.trim());

      uniqueValues.forEach((val, idx) => {
        const translated = translatedValues[idx] || val;
        translationMap.set(val, shouldKeepOriginal(val) ? val : translated);
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

  const seenCombos = new Set();
  const newVariants = [];

  for (const variant of product.variants) {
    const translatedVariant = { ...variant };
    ["option1", "option2", "option3"].forEach(k => {
      if (variant[k])
        translatedVariant[k] = translationMap.get(variant[k]) || variant[k];
    });
    const combo = [translatedVariant.option1, translatedVariant.option2, translatedVariant.option3]
      .filter(Boolean)
      .join("/");
    if (!seenCombos.has(combo)) {
      seenCombos.add(combo);
      newVariants.push(translatedVariant);
    } else {
      log("DUPLICATE_FIX", `⚠️ Skipped duplicate variant after translation: ${combo}`);
    }
  }
  return { variants: newVariants, options: newOptions };
}

// =============== SEO HELPERS ===============
const generateHandle = t =>
  t.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 70);
const generateSEO = (title, desc) => {
  const clean = desc.replace(/<[^>]+>/g, " ").replace(/\s\s+/g, " ").trim();
  return {
    seoTitle: title.slice(0, 70),
    seoDescription: clean.slice(0, 160)
  };
};

// =============== SHOPIFY UPDATE (unchanged) ===============
async function updateShopifyProduct(productId, payload) {
  const restUrl = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`;
  try {
    await axios.put(
      restUrl,
      { product: payload },
      { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
    );
    log("SHOPIFY_UPDATE", `Product ${productId} updated successfully.`);
  } catch (err) {
    log("SHOPIFY_ERROR", err.message, "❌");
  }
}

// =============== MAIN PROCESS ===============
async function processProduct(product, isBatch = false) {
  const { id, title: enTitle, body_html: enDesc, tags } = product;
  if (!id) return;

  // 🕓 تحقق من وقت آخر معالجة في Shopify
  try {
    const metafields = await getProductMetafields(id);
    const lastMeta = metafields.find(m => m.key === LAST_PROCESSED_META_KEY);
    if (lastMeta) {
      const lastTime = new Date(lastMeta.value).getTime();
      if (Date.now() - lastTime < 6 * 60 * 60 * 1000) { // 6 ساعات
        log("META_SKIP", `⏭️ Skipped product ${id}, processed recently.`);
        return;
      }
    }
  } catch (err) {
    log("META_FETCH_ERROR", err.message, "⚠️");
  }

  if (tags && tags.includes(PROCESSED_TAG) && !isBatch) return;

  log("START_PROCESSING", `🚀 Processing product: "${enTitle}" (ID: ${id})`);
  try {
    const [newTitle, newDesc, { variants, options }] = await Promise.all([
      createContent(enTitle, null, "title"),
      createContent(enTitle, enDesc, "description"),
      translateProductOptions(product)
    ]);

    const handle = generateHandle(enTitle);
    const { seoTitle, seoDescription } = generateSEO(newTitle, newDesc);

    const payload = {
      id,
      title: newTitle,
      body_html: newDesc,
      handle,
      tags: [...new Set([...(tags?.split(",") || []), PROCESSED_TAG])].join(","),
      variants,
      options,
      metafields_global_title_tag: seoTitle,
      metafields_global_description_tag: seoDescription
    };

    await updateShopifyProduct(id, payload);
    await updateMetafield(id, LAST_PROCESSED_META_KEY, new Date().toISOString());
    log("FINISH", `🎯 Product "${newTitle}" processed successfully.`);
  } catch (e) {
    log("PROCESS_ERROR", e.message, "❌");
  }
}

// =============== ROUTES ===============
const processedRecently = new Map();
app.post("/webhook/:type", (req, res) => {
  const product = req.body;
  const productId = product?.id;
  const now = Date.now();

  if (processedRecently.has(productId)) {
    const last = processedRecently.get(productId);
    if (now - last < 60000) {
      log("DUPLICATE_SKIP", `⏭️ Skipping repeated webhook for product ${productId}`);
      return res.status(200).send("Skipped duplicate webhook");
    }
  }
  processedRecently.set(productId, now);

  if (process.env.BATCH_MODE === "true") {
    log("WEBHOOK_SKIP", "⏭️ Skipping webhook during batch mode.");
    return res.status(200).send("Batch mode active, skipped.");
  }

  res.status(200).send("Webhook received.");
  processProduct(req.body, false).catch(e => log("WEBHOOK_ERROR", e.message, "❌"));
});

app.get("/", (_, res) => res.send("🚀 eSelect AI Translator v7.9.1 running with metafield loop protection!"));
app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
