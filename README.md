# Clean PDF Engine (Zotero Article Parser)

Node.js-сервис на базе **Puppeteer** и **Mozilla Readability**, который превращает веб-статьи (включая защищенные платформы вроде Substack и Medium) в чистые, оптимизированные для чтения PDF-файлы. Создан специально для автоматического импорта и парсинга статей в личную базу знаний **Zotero** и **Obsidian**.

## 🚀 Ключевые возможности

* **Чистый контент (Readability):** Полностью удаляет рекламу, навигацию, баннеры и мусорные скрипты, оставляя только заголовок, автора, источник и текст статьи.
* **Обход защиты CDN (Bypass Protection):** Имитирует поведение живого пользователя, подменяет заголовки `Referer` и `Origin`. Картинки без проблем скачиваются с защищенных серверов (Substack, Medium).
* **Борьба с Lazy-Loading:** Принудительно раскрывает ленивую загрузку (`data-src` -> `src`), отключает асинхронное декодирование и выставляет виртуальный экран высотой **12 000 пикселей**, заставляя движок Chromium скачивать абсолютно все медиа-файлы и графики перед печатью.
* **Поддержка мобильного формата:** Генерирует PDF как в стандартных форматах (A4, Letter), так и в адаптированном под экраны смартфонов виде (Mobile, 115x185мм) с увеличенным шрифтом для комфортного чтения на ходу.

---

## 📂 Структура проекта и эволюция кода

Перед сохранением в репозиторий файлы были переименованы для соблюдения чистоты структуры (все старые итерации убраны в архивную папку `archive/`):

```bash
.
├── server.js                        # Итоговая Production-версия (A4/Mobile + Фикс картинок Substack)
├── package.json                     # Конфигурация проекта и зависимости
├── package-lock.json                # Лок-файл зависимостей NodeJS
├── node_modules/                    # Установленные пакеты (исключены из Git)
└── archive/                         # Архив предыдущих рабочих итераций скрипта
    ├── server-v1-base.js            # Самая первая базовая версия сервера (только A4)
    └── server-v2-with-mobile.js     # Вторая итерация (добавлена поддержка Mobile формата)
```

### Описание версий:
1.  **`server.js` (Текущий основной)**: Самая продвинутая версия. Содержит обход защиты Substack, фикс глубоких изображений (Anti-Lazy loading), поддержку адаптивной верстки под смартфоны и очередь запросов.
2.  **`archive/server-v2-with-mobile.js`** *(ранее `server copy.js`)*: Стабильная версия, в которой появилась поддержка мобильного формата, но еще отсутствовал сложный механизм выкачивания защищенных картинок.
3.  **`archive/server-v1-base.js`** *(ранее `main-without-mobile-use-this.js`)*: Самая ранняя базовая сборка, умеющая делать только стандартный А4 PDF без разделения на устройства.

---

## 🛠 Технологический стек

* **Node.js** — программная платформа.
* **Express** — минималистичный веб-фреймворк для обработки API-запросов.
* **Puppeteer (Headless Chromium)** — управление браузером для рендеринга и генерации PDF.
* **@mozilla/readability** — библиотека от Mozilla для извлечения смыслового ядра веб-страниц.
* **JSDOM** — эмуляция подсистем DOM для предварительной очистки и подготовки HTML.

---

## 💻 Установка и запуск

### 1. Клонирование репозитория и установка зависимостей
```bash
git clone https://github.com/XQZmeSIR/zotero-pdf-parser.git
cd zotero-pdf-parser
npm install
```

### 2. Запуск в режиме разработки
```bash
node server.js
```
Сервер запустится на `http://localhost:3000`.

### 3. Production-запуск в фоновом режиме (через PM2)
Для того чтобы скрипт работал непрерывно на сервере, рекомендуется использовать менеджер процессов **PM2**:
```bash
npm install -g pm2
pm2 start server.js --name "zotero-pdf-parser"

# Управление процессом:
pm2 status
pm2 restart zotero-pdf-parser
pm2 logs zotero-pdf-parser
```

---

## 🎯 Использование API

Сервер принимает `GET` запросы на эндпоинт `/pdf`.

**Параметры запроса:**
* `url` (обязательный) — ссылка на оригинальную статью.
* `format` (опциональный) — формат вывода: `A4`, `Letter` или `Mobile`. По умолчанию `A4`.

### Примеры запросов:
* **Стандартный А4:** `http://localhost:3000/pdf?url=https://example.com/article`
* **Мобильная версия:** `http://localhost:3000/pdf?url=https://substack-link.com/post&format=Mobile`

---

## ⚙️ Интеграция с Zotero

Скрипт идеально интегрируется с Zotero (например, через расширения для быстрого скачивания или кастомные экшены), отправляя URL текущей открытой вкладки браузера на локальный сервер и мгновенно получая в ответ чистый, готовый к чтению PDF-файл для сохранения в базу.

Скрипт для плагина Actions & Tags в Zotero:  


```js
const SERVICE_URL = 'http://localhost:3000';
const FORMAT      = 'A4'; 

(async function () {
  if (!Zotero.CleanPDFLockRegistry) {
    Zotero.CleanPDFLockRegistry = new Set();
  }

  let targetItems = [];
  if (typeof items !== "undefined" && items && items.length > 0) {
    targetItems = items;
  } else if (typeof item !== "undefined" && item) {
    targetItems = [item];
  }

  if (targetItems.length === 0) {
    Zotero.alert(null, "Clean PDF", "Нет выбранных элементов.");
    return;
  }

  const itemsToProcess = [];
  for (let i = 0; i < targetItems.length; i++) {
    let it = targetItems[i];
    if (!it.isRegularItem() && (it.isAttachment() || it.isNote())) {
      it = Zotero.Items.get(it.parentID);
    }
    if (it && it.isRegularItem() && !Zotero.CleanPDFLockRegistry.has(it.id)) {
      itemsToProcess.push(it);
    }
  }

  if (itemsToProcess.length === 0) return;

  itemsToProcess.forEach(it => Zotero.CleanPDFLockRegistry.add(it.id));

  const pw = new Zotero.ProgressWindow();
  pw.changeHeadline(`Clean PDF: Системная очистка...`);
  pw.show();

  let processedCount = 0;

  try {
    for (let i = 0; i < itemsToProcess.length; i++) {
      const currentItem = itemsToProcess[i];
      const url = currentItem.getField("url");
      const title = currentItem.getField("title") || "Документ";
      
      const progressRow = new pw.ItemProgress(currentItem.getImageSrc(), `[${i + 1}/${itemsToProcess.length}] ${title.slice(0, 35)}...`);

      if (!url) {
        progressRow.setError();
        continue;
      }

      try {
        const response = await Zotero.getMainWindow().fetch(
          `${SERVICE_URL}/pdf?url=${encodeURIComponent(url)}&format=${FORMAT}`
        );

        if (!response.ok) {
          progressRow.setError();
          continue;
        }

        const blob = await response.blob();
        const uint8Array = new Uint8Array(await blob.arrayBuffer());

        if (uint8Array.length < 1000) {
          progressRow.setError();
          continue;
        }

        const cleanTitle = title.replace(/[\\/:\"*?<>|]+/g, "_").slice(0, 120);
        const tempPath = Zotero.getTempDirectory().path + "/" + cleanTitle + ".pdf";

        await Zotero.getMainWindow().IOUtils.write(tempPath, uint8Array);
        await Zotero.Attachments.importFromFile({
          file: tempPath,
          parentItemID: currentItem.id,
          contentType: "application/pdf"
        });

        const attachments = currentItem.getAttachments();
        for (const attId of attachments) {
          const att = Zotero.Items.get(attId);
          if (att?.attachmentContentType === "text/html" || att?.attachmentContentType === "application/zip") {
            await att.eraseTx();
          }
        }

        progressRow.setProgress(100);
        processedCount++;

      } catch (itemError) {
        progressRow.setError();
      }
    }
  } finally {
    setTimeout(() => {
      itemsToProcess.forEach(it => Zotero.CleanPDFLockRegistry.delete(it.id));
    }, 2000);
  }

  pw.addDescription(`Обработано: ${processedCount} из ${itemsToProcess.length}`);
  pw.startCloseTimer(3000);
})();
```
