/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & Copywriter v7.9 (GraphQL + Smart Option Filter)
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

// =============== CONFIG ===============
const {
  OPENAI_API_KEY,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_STORE_URL,
  PORT = 3000,
  BATCH_UPDATE_SECRET
} = process.env;

const PROCESSED_TAG = "ai-processed";

// =============== LOGGER ===============
const log = (step, msg, icon = "✅") => {
  const time = new Date().toISOString();
  const logLine = `[${time}] ${icon} [${step}] :: ${msg}`;
  fs.appendFileSync("./logs/actions.log", logLine + "\n");
  console.log(logLine);
};

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

// =============== OPTION TRANSLATION ===============
async function translateProductOptions(product) {
  if (!product.options || product.options.length === 0 || !product.variants)
    return { variants: product.variants, options: product.options };

  const translationMap = new Map();

  const shouldKeepOriginal = val => {
    // إذا كان حرف أو رقم فقط أو مزيج بسيط مثل C3 أو A1
    return /^[A-Za-z0-9]{1,3}$/.test(val);
  };

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

// =============== SHOPIFY UPDATE ===============
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
    const errorMessage = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ Shopify update failed: ${errorMessage}`, "❌");

    // GraphQL fallback for 100+ variants
    if (errorMessage.includes("more than 100 variants")) {
      try {
        log("GRAPHQL_FALLBACK", `⚙️ Switching to GraphQL update for product ${productId}...`, "⚙️");
        const mutation = `
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id title }
              userErrors { field message }
            }
          }`;
        const variables = {
          input: {
            id: `gid://shopify/Product/${productId}`,
            title: payload.title,
            bodyHtml: payload.body_html,
            tags: payload.tags,
            metafields: payload.metafields,
            metafieldsGlobalTitleTag: payload.metafields_global_title_tag,
            metafieldsGlobalDescriptionTag: payload.metafields_global_description_tag
          }
        };
        await axios.post(
          `${SHOPIFY_STORE_URL}/admin/api/2024-07/graphql.json`,
          { query: mutation, variables },
          { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
        );
        log("GRAPHQL_UPDATE", `✅ Product ${productId} updated successfully via GraphQL.`);
      } catch (gqlErr) {
        log("GRAPHQL_ERROR", `❌ GraphQL update failed: ${gqlErr.message}`, "❌");
      }
    }
  }
}

// =============== MAIN PROCESS ===============
async function processProduct(product, isBatch = false) {
  const { id, title: enTitle, body_html: enDesc, tags } = product;
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

    let deliveryDays = "14-21", returnPolicy = "14 يوماً";
    try {
      const html = (product?.body_html || "").toLowerCase();
      const proc = html.match(/processing time.*?(\d+)\s*-\s*(\d+)/i);
      const del = html.match(/estimated delivery.*?(\d+)\s*-\s*(\d+)/i);
      const ret = html.match(/(\d+)\s*day return/i);
      if (proc && del)
        deliveryDays = `${+proc[1] + +del[1]}-${+proc[2] + +del[2]}`;
      else if (del) deliveryDays = `${del[1]}-${del[2]}`;
      if (ret) returnPolicy = `${ret[1]} يوماً`;
    } catch (e) {
      log("DELIVERY_PARSE", e.message, "⚠️");
    }

    const updatedTags = [...new Set([...(tags?.split(",") || []), PROCESSED_TAG])].join(",");

    const payload = {
      id,
      title: newTitle,
      body_html: newDesc,
      handle,
      tags: updatedTags,
      variants,
      options,
      metafields_global_title_tag: seoTitle,
      metafields_global_description_tag: seoDescription,
      metafields: [
        { key: "delivery_days", namespace: "custom", value: deliveryDays, type: "single_line_text_field" },
        { key: "product_return_policy", namespace: "custom", value: returnPolicy, type: "single_line_text_field" }
      ]
    };

    await updateShopifyProduct(id, payload);
    log("FINISH", `🎯 Product "${newTitle}" processed successfully.`);
  } catch (e) {
    log("PROCESS_ERROR", e.message, "❌");
  }
}

// =============== ROUTES ===============
app.post("/webhook/:type", (req, res) => {
  if (process.env.BATCH_MODE === "true") {
    log("WEBHOOK_SKIP", "⏭️ Skipping webhook during batch mode.");
    return res.status(200).send("Batch mode active, skipped.");
  }
  res.status(200).send("Webhook received.");
  processProduct(req.body, false).catch(e => log("WEBHOOK_ERROR", e.message, "❌"));
});

app.get("/batch-update", (req, res) => {
  const { secret, reprocess } = req.query;
  if (secret !== BATCH_UPDATE_SECRET) return res.status(401).send("Unauthorized");

  res.status(200).send("Batch update started.");
  process.env.BATCH_MODE = "true";

  (async () => {
    try {
      let next = null;
      let count = 0;
      const baseUrl = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products.json?limit=50&status=active`;
      const fetchProducts = async url => {
        const res = await axios.get(url, { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } });
        const link = res.headers.link;
        next = null;
        if (link) {
          const nextLink = link.split(",").find(s => s.includes('rel="next"'));
          if (nextLink) next = nextLink.match(/<(.*?)>/)[1];
        }
        return res.data.products;
      };

      let products = await fetchProducts(baseUrl);
      while (products?.length) {
        for (const p of products) {
          count++;
          const should = reprocess === "true" || !p.tags || !p.tags.includes(PROCESSED_TAG);
          if (should) await processProduct(p, true);
          await new Promise(r => setTimeout(r, 400));
        }
        if (next) products = await fetchProducts(next);
        else break;
      }
      log("BATCH_COMPLETE", `✅ Batch done. ${count} products processed.`);
    } catch (e) {
      log("BATCH_ERROR", e.message, "❌");
    } finally {
      process.env.BATCH_MODE = "false";
    }
  })();
});

app.get("/", (_, res) => res.send("🚀 eSelect AI Translator v7.9 is running!"));

app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
