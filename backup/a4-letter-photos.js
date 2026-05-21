/**
 * CLEAN PDF ENGINE - FINAL PRODUCTION VERSION (STREAMLINED)
 * * * Описание:
 * Сервис для преобразования web-статей в чистый А4/Letter PDF (Readability + Puppeteer).
 * Из кода полностью удалены мобильные форматы для максимального быстродействия.
 * * * Ключевые особенности этой версии:
 * 1. Bypass Protection: Полная имитация браузера с подменой Referer/Origin и
 * обходом блокировок CDN-серверов (актуально для Substack/Medium).
 * 2. Anti-Lazy Loading: Автоматическое раскрытие ленивой загрузки (data-src -> src)
 * и принудительная синхронная загрузка (loading="eager") для всех медиа.
 * 3. Rendering Logic: Использование сетки 1200x12000px и режима 'networkidle0'
 * для гарантированного захвата всех изображений перед печатью.
 * 4. Single-Format Focus: Генерирует строго один качественный документ (A4/Letter).
 */

const express = require("express");
const puppeteer = require("puppeteer");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");

const app = express();
const PORT = 3000;

const MAX_CONCURRENT = 3;
let activeWorkers = 0;
const queue = [];

const CLEAN_PDF_CSS = `
  @page { margin: 20mm 15mm 20mm 15mm; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.65;
    color: #1a1a1a;
    background-color: #ffffff;
    max-width: 720px;
    margin: 0 auto;
    padding: 10px;
    word-wrap: break-word;
  }
  h1 { font-size: 2.3rem; line-height: 1.2; margin-bottom: 0.6em; font-weight: 700; color: #000000; }
  h2 { font-size: 1.55rem; margin-top: 1.7em; margin-bottom: 0.6em; font-weight: 600; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; color: #111111; }
  h3 { font-size: 1.25rem; margin-top: 1.5em; font-weight: 600; color: #222222; }
  p { margin-top: 0; margin-bottom: 18px; text-align: justify; }

  img {
    max-width: 100% !important;
    height: auto !important;
    object-fit: contain !important;
    display: block;
    margin: 28px auto;
    border-radius: 6px;
  }

  code { padding: 0.2em 0.4em; background-color: rgba(27,31,35,0.05); color: #1b1f23; border-radius: 3px; font-family: monospace; font-size: 85%; }
  pre { padding: 16px; overflow: auto; background-color: #f6f8fa; border-radius: 4px; margin-bottom: 16px; border: 1px solid #e1e4e6; }
  pre code { background-color: transparent; padding: 0; font-size: 100%; color: inherit; }
  blockquote { padding: 0 1em; color: #6a737d; border-left: 0.25em solid #dfe2e5; margin: 0 0 16px 0; font-style: italic; }
  table { width: 100%; overflow: auto; margin-bottom: 16px; border-collapse: collapse; }
  table th, table td { padding: 8px 12px; border: 1px solid #dfe2e5; }
  table tr { background-color: #fff; border-top: 1px solid #c6cbd1; }
  table tr:nth-child(2n) { background-color: #f6f8fa; }
  hr { height: 2px; padding: 0; margin: 30px 0; background-color: #e1e4e6; border: 0; }
  a { color: #0366d6; text-decoration: none; }
`;

const USER_AGENT_MOCK =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const browserInstance = puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

async function runQueue() {
  if (queue.length === 0 || activeWorkers >= MAX_CONCURRENT) return;

  activeWorkers++;
  const { targetUrl, format, res } = queue.shift();

  try {
    const browser = await browserInstance;
    const page = await browser.newPage();

    await page.setUserAgent(USER_AGENT_MOCK);

    // Блокируем медиа на первом этапе скрапинга для экономии ресурсов
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (
        ["image", "media", "font", "stylesheet"].includes(req.resourceType())
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
    } catch (gotoErr) {
      console.warn(
        `[Предупреждение] Таймаут загрузки для ${targetUrl}. Пробуем извлечь текст...`,
      );
    }

    const html = await page.content();
    const dom = new JSDOM(html, { url: targetUrl });

    // Фикс Lazy-Loading для картинок
    const images = dom.window.document.querySelectorAll("img");
    images.forEach((img) => {
      const realSrc =
        img.getAttribute("data-src") ||
        img.getAttribute("data-lazy-src") ||
        img.getAttribute("data-srcset") ||
        img.getAttribute("srcset");

      if (realSrc) {
        const cleanSrc = realSrc.trim().split(" ")[0];
        if (cleanSrc && cleanSrc.startsWith("http")) {
          img.setAttribute("src", cleanSrc);
        }
      }
      img.removeAttribute("loading");
      img.setAttribute("loading", "eager"); // Грузим принудительно
      img.removeAttribute("decoding");
    });

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    await page.close();

    if (!article || !article.content) {
      res.status(422).json({ error: "Не удалось извлечь структуру статьи." });
      return;
    }

    const cleanHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${article.title}</title>
        <style>${CLEAN_PDF_CSS}</style>
      </head>
      <body>
        <h1>${article.title}</h1>
        ${article.byline ? `<p style="color: #6a737d;"><strong>Автор:</strong> ${article.byline}</p>` : ""}
        <p style="color: #6a737d; font-size: 0.9em;"><strong>Источник:</strong> <a href="${targetUrl}">${new URL(targetUrl).hostname}</a></p>
        <hr>
        ${article.content}
      </body>
      </html>
    `;

    const renderPage = await browser.newPage();

    // Обман ленивой загрузки: вытягиваем виртуальное окно в длинную ленту
    await renderPage.setViewport({ width: 1200, height: 12000 });
    await renderPage.setUserAgent(USER_AGENT_MOCK);

    await renderPage.setExtraHTTPHeaders({
      Referer: targetUrl,
      Origin: new URL(targetUrl).origin,
    });

    await renderPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await renderPage.setContent(cleanHtml, {
      waitUntil: "networkidle0",
      timeout: 45000,
    });

    // Генерация строго стандартных печатных форматов
    const pdfBuffer = await renderPage.pdf({
      format: format === "Letter" ? "Letter" : "A4",
      printBackground: true,
    });

    await renderPage.close();

    res.contentType("application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error(`[Критическая ошибка]:`, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    activeWorkers--;
    runQueue();
  }
}

app.get("/pdf", (req, res) => {
  const targetUrl = req.query.url;
  const format = req.query.format || "A4";

  if (!targetUrl)
    return res.status(400).json({ error: "Параметр URL обязателен" });

  queue.push({ targetUrl, format, res });
  runQueue();
});

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <title>Clean PDF Dashboard</title>
      <style>
        body { background-color: #121212; color: #e0e0e0; font-family: -apple-system, sans-serif; margin: 0; padding: 60px 20px; }
        .container { max-width: 650px; margin: 0 auto; }
        h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 5px; color: #fff; }
        .subtitle { color: #888; margin-bottom: 35px; font-size: 1.05rem; }
        .form-group { display: flex; gap: 10px; margin-bottom: 20px; }
        input[type="url"] { flex: 1; background: #1a1a1a; border: 1px solid #333; padding: 14px 18px; border-radius: 6px; color: #fff; font-size: 1rem; outline: none; }
        input[type="url"]:focus { border-color: #dedf94; }
        button { background: #dedf94; color: #121212; border: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 1rem; cursor: pointer; }
        button:hover { background: #cacc82; }
        .opt-block { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; color: #888; }
        select { background: #1a1a1a; color: #fff; border: 1px solid #333; padding: 6px 12px; border-radius: 4px; outline: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Clean PDF</h1>
        <div class="subtitle">Convert any article URL to a clean, readable PDF.</div>
        <form action="/pdf" method="GET" target="_blank">
          <div class="form-group">
            <input type="url" name="url" placeholder="https://example.com/article" required>
            <button type="submit">Get PDF</button>
          </div>
          <div class="opt-block">
            <span>Page Format:</span>
            <select name="format">
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </div>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () =>
  console.log(`🚀 Clean PDF Engine: http://localhost:${PORT}`),
);
