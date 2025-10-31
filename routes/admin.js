import express from "express";
import axios from "axios";
const router = express.Router();

router.get("/", async (req, res) => {
  const html = `
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <title>لوحة التحكم | eSelect AI</title>
    <style>
      body { font-family: sans-serif; text-align: center; background: #f7f7f7; color: #333; direction: rtl; }
      h1 { color: #111; margin-top: 30px; }
      button { padding: 12px 25px; margin: 10px; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
      .update { background-color: #2196f3; color: white; }
      .reprocess { background-color: #ff9800; color: white; }
      .logs { background-color: #4caf50; color: white; }
      .info { background-color: #9c27b0; color: white; }
      iframe { width: 90%; height: 400px; border: none; margin-top: 20px; background: #fff; }
    </style>
  </head>
  <body>
    <h1>لوحة التحكم - eSelect AI Translator</h1>
    <button class="update" onclick="run('batch-update')">🔄 تحديث المنتجات</button>
    <button class="reprocess" onclick="run('batch-update?reprocess=true')">🧠 إعادة توليد التاجات</button>
    <button class="logs" onclick="showLogs()">📊 عرض السجلات</button>
    <button class="info" onclick="getInfo()">ℹ️ حالة السيرفر</button>
    <pre id="output" style="text-align:left; direction:ltr; background:#000; color:#0f0; padding:15px; border-radius:10px; max-width:90%; margin:20px auto; overflow:auto;"></pre>
    
    <script>
      async function run(endpoint) {
        document.getElementById('output').textContent = "⏳ جاري التشغيل...";
        const res = await fetch('/' + endpoint + '?secret=${process.env.BATCH_UPDATE_SECRET}');
        const text = await res.text();
        document.getElementById('output').textContent = text;
      }
      async function showLogs() {
        const res = await fetch('/logs');
        const text = await res.text();
        document.getElementById('output').textContent = text;
      }
      async function getInfo() {
        const res = await fetch('/status');
        const json = await res.json();
        document.getElementById('output').textContent = JSON.stringify(json, null, 2);
      }
    </script>
  </body>
  </html>
  `;
  res.send(html);
});

export default router;
