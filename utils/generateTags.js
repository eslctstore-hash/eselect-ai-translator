import OpenAI from "openai";
import { cleanText } from "./cleanText.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateTags(title, description) {
  try {
    const text = cleanText(`${title} ${description}`);
    const prompt = `
استخرج حتى 10 كلمات Tags قصيرة ومميزة من النص التالي، بدون تكرار أو رموز، بالعربية والإنجليزية إن وجدت:
"${text}"
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const tags = completion.choices[0].message.content
      .split(/[,،]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1);

    return [...new Set(tags)].slice(0, 10);
  } catch (err) {
    console.error("❌ Tag Generation Error:", err.message);
    return [];
  }
}
