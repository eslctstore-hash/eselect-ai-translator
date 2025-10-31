/**
 * eSelect | إي سيلكت
 * Shopify AI Translator & AutoTag v8.0 (Dashboard + Cooldown + Security)
 * إعداد: سالم السليمي | https://eselect.store
 * تطوير وتحسين: Gemini AI
 */

import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";
import dotenv from "dotenv";
import autotagRoute from "./routes/autotag.js";
import adminRoute from "./routes/admin.js";

dotenv.config();
const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ✅ تفعيل الوحدات
app.use("/autotag", autotagRoute);
app.use("/admin", adminRoute);

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
  const line = `[${time}] ${icon} [${step}] :: ${msg}`;
  fs.appendFileSync("./logs/actions.log", line + "\n");
  console.log(line);
};

// =============== HELPER: AI Request ===============
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

// =============== SEO & HANDLE HELPERS ===============
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
  const url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products/${productId}.json`;
  try {
    await axios.put(url, { product: payload }, {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN }
    });
    log("SHOPIFY_UPDATE", `Product ${productId} updated successfully.`);
  } catch (err) {
    const error = err.response ? JSON.stringify(err.response.data) : err.message;
    log("SHOPIFY_ERROR", `❌ Shopify update failed: ${error}`, "❌");
  }
}

// =============== MAIN PROCESS ===============
async function processProduct(product, isBatch = false) {
  const { id, title: enTitle, body_html: enDesc, tags } = product;
  if (tags && tags.includes(PROCESSED_TAG) && !isBatch) return;

  log("START_PROCESSING", `🚀 Processing product: "${enTitle}" (ID: ${id})`);
  try {
    const prompt = `Extract meaningful Arabic tags separated by commas for this product (no numbers, no stopwords):
Title: "${enTitle}"
Description: "${enDesc}"`;

    const aiTags = await makeOpenAIRequest(prompt, 200);
    const cleanTags = aiTags
      .replace(/[\[\]\n\r0-9]+/g, "")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();

    const payload = { id, tags: cleanTags };
    await updateShopifyProduct(id, payload);

    log("FINISH", `🎯 Product "${enTitle}" processed successfully.`);
    log("TAGS_ADDED", `🟢 Tags updated in Shopify for product ${id}\n${cleanTags}`);
  } catch (e) {
    log("PROCESS_ERROR", e.message, "❌");
  }
}

// =============== WEBHOOK ===============
app.post("/webhook/:type", (req, res) => {
  res.status(200).send("OK");
  processProduct(req.body, false).catch(e => log("WEBHOOK_ERROR", e.message, "❌"));
});

// =============== BATCH UPDATE ===============
app.get("/batch-update", (req, res) => {
  const { secret, reprocess } = req.query;
  if (secret !== BATCH_UPDATE_SECRET) return res.status(401).send("Unauthorized");

  res.status(200).send("Batch update started...");
  process.env.BATCH_MODE = "true";

  (async () => {
    try {
      let url = `${SHOPIFY_STORE_URL}/admin/api/2024-07/products.json?limit=50`;
      let count = 0;
      while (url) {
        const res = await axios.get(url, { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } });
        const products = res.data.products;
        for (const p of products) {
          const should = reprocess === "true" || !p.tags || !p.tags.includes(PROCESSED_TAG);
          if (should) await processProduct(p, true);
          await new Promise(r => setTimeout(r, 500));
          count++;
        }
        const link = res.headers.link;
        if (link && link.includes('rel="next"')) url = link.match(/<([^>]+)>/)[1];
        else break;
      }
      log("BATCH_COMPLETE", `✅ Batch done. ${count} products processed.`);
    } catch (err) {
      log("BATCH_ERROR", err.message, "❌");
    } finally {
      process.env.BATCH_MODE = "false";
    }
  })();
});

// =============== LOGS & STATUS ===============
app.get("/logs", (_, res) => {
  try {
    const logs = fs.readFileSync("./logs/actions.log", "utf8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(logs.slice(-10000)); // آخر 10 آلاف حرف
  } catch {
    res.send("📭 لا توجد سجلات بعد.");
  }
});

app.get("/status", (_, res) => {
  res.json({
    status: "running",
    timestamp: new Date().toISOString(),
    batch_mode: process.env.BATCH_MODE || "false"
  });
});

// =============== SERVER START ===============
app.get("/", (_, res) => res.send("🚀 eSelect AI Translator v8.0 is running!"));
app.listen(PORT, () => log("SERVER_START", `Server running on port ${PORT}`, "🚀"));
