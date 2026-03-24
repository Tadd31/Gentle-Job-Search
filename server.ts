import express from 'express';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import path from 'path';
import 'dotenv/config';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.get('/api/fetch-content', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const commonHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    };

    try {
      let urlStr = url as string;
      let response = await fetch(urlStr, {
        signal: controller.signal,
        headers: {
          ...commonHeaders,
          'Referer': new URL(urlStr).origin,
        }
      });

      // Smart Retry for 404: Try common career paths
      if (response.status === 404) {
        const alternatives = [
          urlStr.endsWith('/') ? urlStr.slice(0, -1) : `${urlStr}/`,
          urlStr.replace(/\/careers\/?$/, '/jobs'),
          urlStr.replace(/\/careers\/?$/, '/work-with-us'),
          urlStr.replace(/\/careers\/?$/, '/vacancies'),
        ];

        for (const altUrl of alternatives) {
          if (altUrl === urlStr) continue;
          console.log(`404 detected for ${urlStr}. Trying alternative: ${altUrl}`);
          try {
            const altResponse = await fetch(altUrl, {
              signal: controller.signal,
              headers: { ...commonHeaders, 'Referer': new URL(altUrl).origin }
            });
            if (altResponse.ok) {
              response = altResponse;
              urlStr = altUrl;
              break;
            }
          } catch (e) {}
        }
      }

      if (response.status === 403) {
        console.log(`403 detected for ${urlStr}. Retrying with simplified headers...`);
        const retryResponse = await fetch(urlStr, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        });
        
        if (retryResponse.ok) {
          response = retryResponse;
        } else {
          const html = await retryResponse.text();
          if (html.includes('cf-browser-verification') || html.includes('Cloudflare') || html.includes('Access Denied')) {
            let hint = 'This website is protected by Cloudflare or similar bot protection.';
            throw new Error(`Access denied (403). ${hint}`);
          }
          throw new Error('Access denied (403). The website might be blocking automated access.');
        }
      }

      if (response.status === 404) {
        throw new Error('Page not found (404). Please check if the career page URL is still valid.');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Remove noise but keep potential content areas
      // CRITICAL: Don't remove JSON-LD scripts yet!
      $('script:not([type="application/ld+json"]), style, nav, footer, header, iframe, noscript').remove();
      
      // Preserve links by converting <a> tags to [text](href)
      $('a').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href');
        const text = $el.text().trim();
        if (href && text) {
          // Make relative links absolute if possible
          let absoluteHref = href;
          try {
            if (href.startsWith('/')) {
              const urlObj = new URL(url as string);
              absoluteHref = `${urlObj.origin}${href}`;
            } else if (!href.startsWith('http')) {
              const urlObj = new URL(url as string);
              absoluteHref = `${urlObj.origin}/${href}`;
            }
          } catch (e) {}
          $el.replaceWith(` [${text}](${absoluteHref}) `);
        }
      });

      // Also look for JSON-LD which often contains job data even in SPAs
      let jsonLdData = '';
      $('script[type="application/ld+json"]').each((_, el) => {
        const content = $(el).html();
        if (content && content.includes('JobPosting')) {
          jsonLdData += content + ' ';
        }
      });

      // Now we can remove all scripts
      $('script').remove();

      // Try to find the main content area if it exists
      let mainContent = $('main, #content, .content, #main, [role="main"]').text();
      
      // If main content is sparse, fallback to body but be more inclusive
      if (!mainContent || mainContent.length < 500) {
        mainContent = $('body').text();
      }

      const text = (mainContent + ' ' + jsonLdData).replace(/\s+/g, ' ').trim().substring(0, 30000);
      res.json({ text });
    } catch (error: any) {
      let message = error.message;
      if (message === 'fetch failed') {
        message = 'Connection failed. The website might be blocking automated access or is currently down.';
      }
      console.error(`Fetch error for ${url}:`, message);
      res.status(500).json({ error: message });
    } finally {
      clearTimeout(timeout);
    }
  });

  // Greenhouse API Proxy
  app.get('/api/greenhouse-jobs', async (req, res) => {
    const { boardId } = req.query;
    if (!boardId) return res.status(400).json({ error: 'Board ID is required' });

    try {
      const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardId}/jobs`);
      if (!response.ok) {
        throw new Error(`Greenhouse API returned ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error(`Greenhouse fetch error for ${boardId}:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => res.sendFile(path.resolve('dist/index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
