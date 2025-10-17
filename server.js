import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cron from "node-cron";
import fs from "fs-extra";
import { translateProduct } from "./modules/translator.js";
import { publishToMeta, deleteFromMeta } from "./modules/metaSync.js";
import { getProductById } from "./modules/shopify.js";

dotenv.config();
const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ===== Logging =====
const logFile = "./logs/events.log";
async function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(line.trim());
  await fs.ensureFile(logFile);
  await fs.appendFile(logFile, line);
}

// ===== Webhook: Create/Update =====
app.post("/webhook/product-updated", async (req, res) => {
  res.status(200).send("ok");
  const product = req.body;
  await log(`[🆕] استلام منتج جديد/محدث: ${product.title}`);

  // انتظار الصور إذا لم تكن موجودة
  if (!product.images || product.images.length === 0) {
    await log(`[⏳] لا توجد صور الآن - الانتظار 60 ثانية`);
    await new Promise(r => setTimeout(r, 60000));
    const latest = await getProductById(product.id);
    if (!latest.images || latest.images.length === 0) {
      await log(`[⚠️] لم تُضف صور بعد للمنتج: ${product.title}`);
      return;
    }
  }

  // الترجمة والنشر
  const translated = await translateProduct(product);
  translated.id = product.id;
  translated.images = product.images;
  await publishToMeta(translated);
});

// ===== Webhook: Delete =====
app.post("/webhook/product-deleted", async (req, res) => {
  res.status(200).send("ok");
  const product = req.body;
  await log(`[🗑️] حذف المنتج من Shopify: ${product.id}`);
  await deleteFromMeta(product.id);
});

// ===== مزامنة يومية =====
cron.schedule("0 3 * * *", async () => {
  await log("[🔁] بدء المزامنة اليومية...");
  // يمكن توسيعها لاحقًا لمراجعة كل المنتجات
});

// ===== Server Start =====
app.listen(process.env.PORT || 3000, () =>
  console.log(`🚀 eSelect Unified Sync v6.0.0 on port ${process.env.PORT || 3000}`)
);
