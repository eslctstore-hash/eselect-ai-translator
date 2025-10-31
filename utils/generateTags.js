import OpenAI from "openai";
import { cleanText } from "./cleanText.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateTags(title, description) {
  try {
    const text = cleanText(`${title} ${description}`);

    const prompt = `
أنت خبير في تحسين محركات البحث SEO متخصص في التجارة الإلكترونية.
مهمتك هي استخراج الكلمات المفتاحية (Tags) الدقيقة والمفيدة من النص التالي فقط.
ركز على:
- كلمات تصف المنتج نفسه (النوع، الفئة، الاستخدام، المميزات، التقنية، المواد).
- استبعد أي كلمات عامة لا تفيد البحث مثل (جديد، رائع، للبيع، متوفر، أصلي، مميز، فاخر...).
- لا تدرج أسماء متاجر، مدن، رموز أو أرقام.
- لا تدرج كلمات لا علاقة لها بالمنتج حتى لو كانت شائعة في جوجل.
- أخرج النتيجة على شكل كلمات مفصولة بفاصلة واحدة فقط.

النص:
"${text}"

أعطني فقط الكلمات النهائية هكذا:
سماعة, بلوتوث, لاسلكية, مقاومة للماء, رياضة, شحن سريع
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    let tagsText = completion.choices[0].message.content
      .replace(/\n/g, " ")
      .replace(/[0-9]+\./g, "")
      .replace(/["']/g, "")
      .trim();

    // فلترة إضافية محلية بعد الذكاء الاصطناعي
    const bannedWords = [
      "جميل", "رائع", "جديد", "ممتاز", "متوفر", "اصلي", "مضمون",
      "Kelowna", "Linux", "Windows", "CSGO", "محلي", "عام", "متجر",
      "منتج", "خصم", "سعر", "شراء", "توصيل", "مجاني", "عرض"
    ];

    let tags = tagsText
      .split(/[,،]/)
      .map(t => t.trim())
      .filter(t => t.length > 1 && !bannedWords.includes(t))
      .filter((t, i, arr) => arr.indexOf(t) === i) // منع التكرار
      .slice(0, 10);

    return tags;
  } catch (err) {
    console.error("❌ Tag Generation Error:", err.message);
    return [];
  }
}
