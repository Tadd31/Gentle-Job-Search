import express from 'express';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import path from 'path';
import 'dotenv/config';
import fs from 'fs-extra';
import JSZip from 'jszip';
import cookieParser from 'cookie-parser';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());

  // CORS Middleware for extension
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const frontendUrl = process.env.FRONTEND_URL;
    
    // Allow extension origin (chrome-extension://...), the app itself, or the Netlify frontend
    if (origin && (
      origin.startsWith('chrome-extension://') || 
      origin === process.env.APP_URL || 
      (frontendUrl && origin === frontendUrl.replace(/\/$/, ''))
    )) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Session Management
  app.post('/api/auth/session', (req, res) => {
    const { uid, email, displayName } = req.body;
    if (!uid) {
      res.clearCookie('scout_session');
      return res.json({ status: 'logged_out' });
    }

    // Set a simple session cookie
    res.cookie('scout_session', JSON.stringify({ uid, email, displayName }), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({ status: 'logged_in', user: { uid, email, displayName } });
  });

  app.get('/api/auth/status', (req, res) => {
    const session = req.cookies.scout_session;
    if (!session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    try {
      const user = JSON.parse(session);
      res.json({ status: 'logged_in', user });
    } catch (e) {
      res.clearCookie('scout_session');
      res.status(401).json({ error: 'Invalid session' });
    }
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
      $('script:not([type="application/ld+json"]), style, iframe, noscript').remove();
      
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
      let mainContent = $('main, #content, .content, #main, [role="main"], article, .jobs-list, .vacancies-list, [class*="job-list"], [class*="vacancy-list"], [class*="career-list"]').text();
      
      // If main content is sparse or doesn't seem to contain jobs, fallback to body
      const jobKeywords = ['job', 'vacancy', 'career', 'position', 'role', 'apply', 'salary'];
      const hasJobKeywords = jobKeywords.some(k => mainContent.toLowerCase().includes(k));

      if (!mainContent || mainContent.length < 500 || !hasJobKeywords) {
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

  // Extension ZIP Generation
  app.get('/api/extension/download', async (req, res) => {
    try {
      const zip = new JSZip();
      const extensionDir = path.resolve('extension');
      const appUrl = process.env.APP_URL || `http://localhost:3000`;
      const frontendUrl = process.env.FRONTEND_URL || appUrl;

      // Add files to ZIP
      const manifest = await fs.readFile(path.join(extensionDir, 'manifest.json'), 'utf8');
      const popupHtml = await fs.readFile(path.join(extensionDir, 'popup.html'), 'utf8');
      const popupCss = await fs.readFile(path.join(extensionDir, 'popup.css'), 'utf8');
      const popupJsTemplate = await fs.readFile(path.join(extensionDir, 'popup.js.template'), 'utf8');

      // Replace placeholders in popup.js
      const popupJs = popupJsTemplate
        .replace('__API_BASE_URL__', frontendUrl)
        .replace('__FRONTEND_URL__', frontendUrl);

      zip.file('manifest.json', manifest);
      zip.file('popup.html', popupHtml);
      zip.file('popup.css', popupCss);
      zip.file('popup.js', popupJs);

      // Add a dummy icon if it doesn't exist
      const iconPath = path.join(extensionDir, 'icon.png');
      if (await fs.pathExists(iconPath)) {
        const iconData = await fs.readFile(iconPath);
        zip.file('icon.png', iconData);
      } else {
        // Create a simple 1x1 transparent pixel as a placeholder icon
        const placeholderIcon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
        zip.file('icon.png', placeholderIcon);
      }

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename=the-job-scout-clipper.zip');
      res.send(content);
    } catch (error: any) {
      console.error('Extension ZIP generation error:', error);
      res.status(500).json({ error: 'Failed to generate extension ZIP' });
    }
  });

  // Source adding route for extension
  app.post('/api/sources', (req, res) => {
    const session = req.cookies.scout_session;
    if (!session) {
      return res.status(401).json({ error: 'Please log in to The Job Scout first.' });
    }

    const { name, url, type } = req.body;
    let user;
    try {
      user = JSON.parse(session);
    } catch (e) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    console.log(`Extension clipped source for user ${user.uid}: ${name} (${url})`);
    
    // In a real app, we'd save this to Firestore here using Firebase Admin SDK.
    // For now, we'll return success and log it.
    res.json({ 
      success: true, 
      message: 'Source received! (Beta)',
      user: user.displayName
    });
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
