/**
 * eSelect AutoTag AI | v1.0.0
 * توليد تلقائي لكلمات Tags من اسم ووصف المنتج
 * إعداد: سالم السليمي | https://eselect.store
 */

import express from "express";
import { generateTags } from "../utils/generateTags.js";
import { updateProductTags } from "../utils/shopifyAPI.js";

const router = express.Router();

router.post("/webhook/product-updated", async (req, res) => {
  try {
    const product = req.body;
    if (!product || !product.id) return res.status(400).send("invalid data");

    const { title, body_html } = product;
    const tags = await generateTags(title, body_html);

    if (tags?.length) {
      await updateProductTags(product.id, tags);
      console.log(`✅ AutoTags added for product: ${title}`, tags);
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("❌ AutoTag Error:", err.message);
    res.status(500).send("error");
  }
});

export default router;
