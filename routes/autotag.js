import express from "express";
import axios from "axios";
const router = express.Router();

const tagCooldown = new Map();

router.post("/", async (req, res) => {
  const { id, title, description } = req.body;
  if (!id || !title) return res.status(400).send("Missing product data");

  const now = Date.now();
  if (tagCooldown.has(id) && now - tagCooldown.get(id) < 60000) {
    console.log(`⏭️ Skipped AutoTag for ${id} (cooldown active)`);
    return res.send("Skipped (cooldown)");
  }
  tagCooldown.set(id, now);

  try {
    const prompt = `Extract useful Arabic keywords separated by commas for product search:
Title: "${title}"
Description: "${description}"`;

    const ai = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-4o", messages: [{ role: "user", content: prompt }] },
      { headers: { Authorization: \`Bearer \${process.env.OPENAI_API_KEY}\` } }
    );

    const tags = ai.data.choices[0].message.content
      .replace(/[\[\]\n\r0-9]+/g, "")
      .replace(/\s*,\s*/g, ", ")
      .trim();

    res.send({ success: true, tags });
  } catch (err) {
    console.error("Tag Generation Error:", err.message);
    res.status(500).send("AI tag generation failed");
  }
});

export default router;
