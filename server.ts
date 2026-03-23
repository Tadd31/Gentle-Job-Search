import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import cron from 'node-cron';
import * as cheerio from 'cheerio';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

const db = new Database('jobs.db');

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    keywords TEXT,
    location TEXT,
    linkedin_url TEXT,
    min_salary INTEGER DEFAULT 30000,
    search_mode TEXT DEFAULT 'strict',
    crawl_interval INTEGER DEFAULT 3
  );

  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE,
    name TEXT,
    is_broken INTEGER DEFAULT 0,
    last_error TEXT,
    last_crawled DATETIME,
    jobs_found INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT,
    company TEXT,
    location TEXT,
    link TEXT,
    source_url TEXT,
    found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    status TEXT DEFAULT 'new', -- 'new', 'past', 'approved', 'rejected'
    crawl_session_id INTEGER,
    is_recommendation INTEGER DEFAULT 0,
    salary TEXT,
    seniority TEXT,
    match_score INTEGER,
    match_reason TEXT,
    is_broken INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS crawl_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add status and crawl_session_id columns if they don't exist
try {
  db.prepare("ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'new'").run();
} catch (e) {
  // Column might already exist
}
try {
  db.prepare("ALTER TABLE jobs ADD COLUMN crawl_session_id INTEGER").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE jobs ADD COLUMN is_recommendation INTEGER DEFAULT 0").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE profile ADD COLUMN min_salary INTEGER DEFAULT 30000").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE jobs ADD COLUMN salary TEXT").run();
  db.prepare("ALTER TABLE jobs ADD COLUMN seniority TEXT").run();
  db.prepare("ALTER TABLE jobs ADD COLUMN match_score INTEGER").run();
  db.prepare("ALTER TABLE jobs ADD COLUMN match_reason TEXT").run();
  db.prepare("ALTER TABLE jobs ADD COLUMN is_broken INTEGER DEFAULT 0").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE profile ADD COLUMN search_mode TEXT DEFAULT 'strict'").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE profile ADD COLUMN crawl_interval INTEGER DEFAULT 3").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE sources ADD COLUMN is_broken INTEGER DEFAULT 0").run();
  db.prepare("ALTER TABLE sources ADD COLUMN last_error TEXT").run();
} catch (e) {}

try {
  db.prepare("ALTER TABLE sources ADD COLUMN last_crawled DATETIME").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE sources ADD COLUMN jobs_found INTEGER DEFAULT 0").run();
} catch (e) {}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // API Routes
  app.get('/api/profile', (req, res) => {
    const profile = db.prepare('SELECT * FROM profile WHERE id = 1').get();
    res.json(profile || {});
  });

  app.post('/api/profile', (req, res) => {
    const { keywords, location, linkedin_url, min_salary, search_mode, crawl_interval } = req.body;

    const existing = db.prepare('SELECT id FROM profile WHERE id = 1').get();
    if (existing) {
      db.prepare('UPDATE profile SET keywords = ?, location = ?, linkedin_url = ?, min_salary = ?, search_mode = ?, crawl_interval = ? WHERE id = 1')
        .run(keywords, location, linkedin_url, min_salary, search_mode || 'strict', crawl_interval || 3);
    } else {
      db.prepare('INSERT INTO profile (id, keywords, location, linkedin_url, min_salary, search_mode, crawl_interval) VALUES (1, ?, ?, ?, ?, ?, ?)')
        .run(keywords, location, linkedin_url, min_salary, search_mode || 'strict', crawl_interval || 3);
    }
    res.json({ success: true });
  });

  app.post('/api/jobs/clear-all', (req, res) => {
    try {
      console.log('Resetting all job data via POST...');
      db.exec('DELETE FROM jobs');
      db.exec('DELETE FROM crawl_sessions');
      console.log('Job data reset successfully.');
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error resetting jobs:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sources/clear-all', (req, res) => {
    try {
      console.log('Clearing all sources via POST...');
      db.exec('DELETE FROM sources');
      console.log('Sources cleared successfully.');
      res.json({ success: true });
    } catch (error: any) {
      console.error('Error clearing sources:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sources', (req, res) => {
    const sources = db.prepare('SELECT * FROM sources ORDER BY id DESC').all();
    res.json(sources);
  });

  app.post('/api/sources', (req, res) => {
    const { url, name } = req.body;
    try {
      db.prepare('INSERT INTO sources (url, name) VALUES (?, ?)').run(url, name || url);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sources/:id/status', (req, res) => {
    const { is_broken, last_error } = req.body;
    db.prepare('UPDATE sources SET is_broken = ?, last_error = ? WHERE id = ?')
      .run(is_broken ? 1 : 0, last_error || null, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/sources/:id/crawl-stats', (req, res) => {
    const { last_crawled, jobs_found_increment } = req.body;
    db.prepare('UPDATE sources SET last_crawled = ?, jobs_found = jobs_found + ? WHERE id = ?')
      .run(last_crawled, jobs_found_increment || 0, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/sources/:id/url', (req, res) => {
    const { url } = req.body;
    db.prepare('UPDATE sources SET url = ?, is_broken = 0, last_error = NULL WHERE id = ?')
      .run(url, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/sources/:id/update', (req, res) => {
    const { url, name } = req.body;
    db.prepare('UPDATE sources SET url = ?, name = ?, is_broken = 0, last_error = NULL WHERE id = ?')
      .run(url, name, req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/sources/:id', (req, res) => {
    db.prepare('DELETE FROM sources WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  app.post('/api/sources/bulk', (req, res) => {
    const { sources } = req.body; // Array of { name, url }
    if (!Array.isArray(sources)) return res.status(400).json({ error: 'Sources must be an array' });

    const insert = db.prepare('INSERT OR IGNORE INTO sources (url, name) VALUES (?, ?)');
    const transaction = db.transaction((data) => {
      for (const source of data) {
        insert.run(source.url, source.name || source.url);
      }
    });

    try {
      transaction(sources);
      res.json({ success: true, count: sources.length });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/jobs', (req, res) => {
    const { status } = req.query;
    let query = 'SELECT * FROM jobs';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    } else {
      query += " WHERE status IN ('new', 'past')";
    }

    query += ' ORDER BY found_at DESC';
    const jobs = db.prepare(query).all(...params);
    res.json(jobs);
  });

  app.post('/api/jobs/:id/status', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/jobs/:id/link', (req, res) => {
    const { link } = req.body;
    db.prepare('UPDATE jobs SET link = ?, is_broken = 0 WHERE id = ?').run(link, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/start-crawl-session', (req, res) => {
    // Mark all current 'new' jobs as 'past'
    db.prepare("UPDATE jobs SET status = 'past' WHERE status = 'new'").run();
    const result = db.prepare('INSERT INTO crawl_sessions (started_at) VALUES (CURRENT_TIMESTAMP)').run();
    res.json({ sessionId: result.lastInsertRowid });
  });

  app.post('/api/save-jobs', (req, res) => {
    const { jobs, source_url, sessionId } = req.body;
    const insert = db.prepare(`
      INSERT OR IGNORE INTO jobs (id, title, company, location, link, source_url, description, status, crawl_session_id, is_recommendation, salary, seniority, match_score, match_reason, is_broken)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const job of jobs) {
      insert.run(
        job.id || `${job.title}-${job.company}`,
        job.title,
        job.company,
        job.location,
        job.link,
        source_url,
        job.description,
        sessionId,
        job.is_recommendation ? 1 : 0,
        job.salary || 'Unknown',
        job.seniority || null,
        job.match_score || 0,
        job.match_reason || null,
        job.is_broken ? 1 : 0
      );
    }
    res.json({ success: true, count: jobs.length });
  });

  app.get('/api/fetch-content', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      let urlStr = url as string;
      let response = await fetch(urlStr, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Referer': new URL(urlStr).origin,
        }
      });

      // Smart Retry for 404: Try adding or removing a trailing slash
      if (response.status === 404) {
        const alternativeUrl = urlStr.endsWith('/') ? urlStr.slice(0, -1) : `${urlStr}/`;
        console.log(`404 detected for ${urlStr}. Trying alternative: ${alternativeUrl}`);
        const altResponse = await fetch(alternativeUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Referer': new URL(alternativeUrl).origin,
          }
        });
        if (altResponse.ok) {
          response = altResponse;
          urlStr = alternativeUrl;
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Remove noise but keep more potential content areas
      $('script, style, nav, footer, header, iframe, noscript').remove();
      
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

      // Try to find the main content area if it exists
      const mainContent = $('main, #content, .content, #main, [role="main"]').text() || $('body').text();
      const text = mainContent.replace(/\s+/g, ' ').trim().substring(0, 25000);
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

  app.post('/api/crawl', async (req, res) => {
    // This now just signals the frontend to perform the crawl if needed, 
    // but since we moved Gemini to frontend, the frontend will handle the logic.
    res.json({ success: true, message: 'Please perform crawl from frontend' });
  });

  app.get('/api/last-session', (req, res) => {
    const session = db.prepare('SELECT * FROM crawl_sessions ORDER BY started_at DESC LIMIT 1').get();
    res.json(session || null);
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
    console.log('Database initialized and migrations checked.');
  });
}

startServer();
