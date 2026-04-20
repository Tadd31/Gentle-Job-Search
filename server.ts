import express from 'express';
import { createServer as createViteServer } from 'vite';
import * as cheerio from 'cheerio';
import path from 'path';
import 'dotenv/config';
import fs from 'fs-extra';
import JSZip from 'jszip';
import cookieParser from 'cookie-parser';

const HOLDING_COMPANY_WORKDAY_MAP: Record<string, { host: string, tenant: string, siteId: string, brandName?: string }> = {
  'droga5.com': { host: 'accenture.wd3.myworkdayjobs.com', tenant: 'accenture', siteId: 'External', brandName: 'Droga5' },
  'accenture.com': { host: 'accenture.wd3.myworkdayjobs.com', tenant: 'accenture', siteId: 'External', brandName: '' },
  'vml.com': { host: 'wpp.wd3.myworkdayjobs.com', tenant: 'WPP_External_Career_Site', siteId: '', brandName: 'VML' },
  'ogilvy.com': { host: 'wpp.wd3.myworkdayjobs.com', tenant: 'WPP_External_Career_Site', siteId: '', brandName: 'Ogilvy' },
  'grey.com': { host: 'wpp.wd3.myworkdayjobs.com', tenant: 'WPP_External_Career_Site', siteId: '', brandName: 'Grey' },
  'akqa.com': { host: 'wpp.wd3.myworkdayjobs.com', tenant: 'WPP_External_Career_Site', siteId: '', brandName: 'AKQA' },
  'wundermanthompson.com': { host: 'wpp.wd3.myworkdayjobs.com', tenant: 'WPP_External_Career_Site', siteId: '', brandName: 'Wunderman Thompson' },
  'leoburnett.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'Leo Burnett' },
  'saatchi.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'Saatchi & Saatchi' },
  'bbh.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'BBH' },
  'publicisgroupe.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'Publicis Groupe' },
  'publicis.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'Publicis' },
  'publicissapient.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'Publicis Sapient' },
  'sapient.com': { host: 'publicis.wd3.myworkdayjobs.com', tenant: 'publicis', siteId: 'External', brandName: 'Sapient' },
  'bbdo.com': { host: 'omnicom.wd3.myworkdayjobs.com', tenant: 'omnicom', siteId: 'External', brandName: 'BBDO' },
  'ddb.com': { host: 'omnicom.wd3.myworkdayjobs.com', tenant: 'omnicom', siteId: 'External', brandName: 'DDB' },
  'tbwa.com': { host: 'omnicom.wd3.myworkdayjobs.com', tenant: 'omnicom', siteId: 'External', brandName: 'TBWA' },
  'mccann.com': { host: 'ipg.wd3.myworkdayjobs.com', tenant: 'ipg', siteId: 'External', brandName: 'McCann' },
  'mullenlowe.com': { host: 'ipg.wd3.myworkdayjobs.com', tenant: 'ipg', siteId: 'External', brandName: 'MullenLowe' },
  'rga.com': { host: 'ipg.wd3.myworkdayjobs.com', tenant: 'ipg', siteId: 'External', brandName: 'R/GA' },
  'hugeinc.com': { host: 'ipg.wd3.myworkdayjobs.com', tenant: 'ipg', siteId: 'External', brandName: 'Huge' },
};

async function startServer() {
  console.log('Starting server...');
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
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
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
      
      // Check for common bot protection or empty shells
      if (html.includes('cf-browser-verification') || html.includes('Cloudflare') || html.includes('Access Denied') || html.includes('Permission Denied')) {
        throw new Error('Access denied or bot protection detected. The website is blocking automated access.');
      }

      const $ = cheerio.load(html);
      
      // Job Board Detection (even in SPAs or iframes)
      let extraContent = '';
      const potentialBoardIds = {
        greenhouse: new Set<string>(),
        lever: new Set<string>(),
        workable: new Set<string>(),
        smartrecruiters: new Set<string>(),
        workday: new Set<{host: string, tenant: string, siteId: string}>(),
        bamboohr: new Set<string>(),
        ashby: new Set<string>(),
        taleo: new Set<string>(),
        icims: new Set<string>(),
      };

      // Manually inject common Publicis/Accenture IDs for proactive detection
      if (urlStr.includes('publicis') || urlStr.includes('sapient')) {
        potentialBoardIds.greenhouse.add('publicis');
        potentialBoardIds.greenhouse.add('publicisgroupe');
        potentialBoardIds.greenhouse.add('sapient');
        potentialBoardIds.greenhouse.add('publicissapient');
        potentialBoardIds.smartrecruiters.add('PublicisGroupe');
        potentialBoardIds.smartrecruiters.add('Publicis-Groupe');
        potentialBoardIds.smartrecruiters.add('sapient');
        potentialBoardIds.smartrecruiters.add('publicissapient');
      }
      if (urlStr.includes('droga5')) {
        potentialBoardIds.greenhouse.add('droga5');
        potentialBoardIds.smartrecruiters.add('droga5');
      }

      // Check URL itself
      if (urlStr.includes('greenhouse.io')) {
        const match = urlStr.match(/boards\.greenhouse\.io\/([^/]+)/);
        if (match) potentialBoardIds.greenhouse.add(match[1]);
      }
      if (urlStr.includes('lever.co')) {
        const match = urlStr.match(/jobs\.lever\.co\/([^/]+)/);
        if (match) potentialBoardIds.lever.add(match[1]);
      }
      if (urlStr.includes('workable.com')) {
        const match = urlStr.match(/apply\.workable\.com\/([^/]+)/);
        if (match) potentialBoardIds.workable.add(match[1]);
      }
      if (urlStr.includes('smartrecruiters.com')) {
        const match = urlStr.match(/(?:careers|jobs)\.smartrecruiters\.com\/([^/?#]+)/);
        if (match) potentialBoardIds.smartrecruiters.add(match[1]);
      }
      if (urlStr.includes('bamboohr.com/jobs')) {
        const match = urlStr.match(/([^.]+)\.bamboohr\.com\/jobs/);
        if (match) potentialBoardIds.bamboohr.add(match[1]);
      }
      if (urlStr.includes('ashbyhq.com')) {
        const match = urlStr.match(/ashbyhq\.com\/([^/?#]+)/);
        if (match) potentialBoardIds.ashby.add(match[1]);
      }
      if (urlStr.includes('taleo.net')) {
        const match = urlStr.match(/([^.]+)\.taleo\.net/);
        if (match) potentialBoardIds.taleo.add(match[1]);
      }
      if (urlStr.includes('icims.com')) {
        const match = urlStr.match(/([^.]+)\.icims\.com/);
        if (match) potentialBoardIds.icims.add(match[1]);
      }

      // Check HTML content for board IDs or links
      const ghMatches = html.matchAll(/boards\.greenhouse\.io\/([^"'\s>]+)/gi);
      for (const m of ghMatches) potentialBoardIds.greenhouse.add(m[1].split('/')[0].split('?')[0]);
      
      const leverMatches = html.matchAll(/jobs\.lever\.co\/([^"'\s>]+)/gi);
      for (const m of leverMatches) potentialBoardIds.lever.add(m[1].split('/')[0].split('?')[0]);

      const workableMatches = html.matchAll(/apply\.workable\.com\/([^"'\s>]+)/gi);
      for (const m of workableMatches) potentialBoardIds.workable.add(m[1].split('/')[0].split('?')[0]);

      const srMatches = html.matchAll(/(?:careers|jobs)\.smartrecruiters\.com\/([^"'\s>]+)/gi);
      for (const m of srMatches) potentialBoardIds.smartrecruiters.add(m[1].split('/')[0].split('?')[0]);

      const bambooMatches = html.matchAll(/([^"'\s>.]+)\.bamboohr\.com\/jobs/gi);
      for (const m of bambooMatches) potentialBoardIds.bamboohr.add(m[1]);

      const ashbyMatches = html.matchAll(/ashbyhq\.com\/([^"'\s>]+)/gi);
      for (const m of ashbyMatches) potentialBoardIds.ashby.add(m[1].split('/')[0].split('?')[0]);

      const taleoMatches = html.matchAll(/([^"'\s>.]+)\.taleo\.net/gi);
      for (const m of taleoMatches) potentialBoardIds.taleo.add(m[1]);

      const icimsMatches = html.matchAll(/([^"'\s>.]+)\.icims\.com/gi);
      for (const m of icimsMatches) potentialBoardIds.icims.add(m[1]);

      const wdMatches = html.matchAll(/(https?:\/\/[^"'\s>]+\.myworkdayjobs\.com\/[^"'\s>]+)/gi);
      for (const m of wdMatches) {
        try {
          const wdUrl = new URL(m[1]);
          const host = wdUrl.hostname;
          const hostParts = host.split('.');
          const parts = wdUrl.pathname.split('/').filter(Boolean);
          let tenant = '';
          let siteId = '';

          if (hostParts[0] === 'wd3' || hostParts[0] === 'wd5' || hostParts[0] === 'wd1' || hostParts[0] === 'www') {
            if (parts[0] === 'recruiting') {
              tenant = parts[1];
              siteId = parts[2];
            } else {
              tenant = parts[0];
              siteId = parts[1];
            }
          } else {
            tenant = hostParts[0];
            siteId = parts[0];
          }
          if (tenant) potentialBoardIds.workday.add({ host, tenant, siteId });
        } catch (e) {}
      }

      // Check for data attributes or scripts
      const ghDataAttr = $('[data-gh-board-id]').attr('data-gh-board-id');
      if (ghDataAttr) potentialBoardIds.greenhouse.add(ghDataAttr);

      // Check iframes before removing them
      $('iframe').each((_, el) => {
        const src = $(el).attr('src');
        if (src) {
          if (src.includes('greenhouse.io')) {
            const match = src.match(/board=([^&]+)/) || src.match(/boards\.greenhouse\.io\/([^/]+)/);
            if (match) potentialBoardIds.greenhouse.add(match[1]);
          }
          if (src.includes('lever.co')) {
            const match = src.match(/jobs\.lever\.co\/([^/]+)/);
            if (match) potentialBoardIds.lever.add(match[1]);
          }
          if (src.includes('workday')) {
             try {
              const wdUrl = new URL(src.startsWith('//') ? `https:${src}` : src);
              if (wdUrl.hostname.includes('myworkdayjobs.com')) {
                const host = wdUrl.hostname;
                const hostParts = host.split('.');
                const parts = wdUrl.pathname.split('/').filter(Boolean);
                let tenant = '';
                let siteId = '';
                if (hostParts[0] === 'wd3' || hostParts[0] === 'wd5' || hostParts[0] === 'wd1' || hostParts[0] === 'www') {
                  if (parts[0] === 'recruiting') { tenant = parts[1]; siteId = parts[2]; }
                  else { tenant = parts[0]; siteId = parts[1]; }
                } else {
                  tenant = hostParts[0];
                  siteId = parts[0];
                }
                if (tenant) potentialBoardIds.workday.add({ host, tenant, siteId });
              }
            } catch (e) {}
          }
        }
      });

      // Fetch from detected boards
      let detectedBoard = '';
      if (potentialBoardIds.greenhouse.size > 0) detectedBoard = 'Greenhouse';
      else if (potentialBoardIds.lever.size > 0) detectedBoard = 'Lever';
      else if (potentialBoardIds.workable.size > 0) detectedBoard = 'Workable';
      else if (potentialBoardIds.smartrecruiters.size > 0) detectedBoard = 'SmartRecruiters';
      else if (potentialBoardIds.ashby.size > 0) detectedBoard = 'Ashby';
      else if (potentialBoardIds.workday.size > 0) detectedBoard = 'Workday';
      else if (potentialBoardIds.bamboohr.size > 0) detectedBoard = 'BambooHR';
      else if (potentialBoardIds.taleo.size > 0) detectedBoard = 'Taleo';
      else if (potentialBoardIds.icims.size > 0) detectedBoard = 'iCIMS';

      for (const boardId of potentialBoardIds.greenhouse) {
        try {
          const ghRes = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardId}/jobs`);
          if (ghRes.ok) {
            const data = await ghRes.json();
            if (data.jobs && Array.isArray(data.jobs)) {
              extraContent += `\n\n--- Greenhouse Jobs (${boardId}) ---\n`;
              extraContent += data.jobs.map((j: any) => `[${j.title}](${j.absolute_url}) - ${j.location?.name || ''}`).join('\n');
            }
          }
        } catch (e) {}
      }

      for (const company of potentialBoardIds.lever) {
        try {
          const leverRes = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json`);
          if (leverRes.ok) {
            const data = await leverRes.json();
            if (Array.isArray(data)) {
              extraContent += `\n\n--- Lever Jobs (${company}) ---\n`;
              extraContent += data.map((j: any) => `[${j.text}](${j.hostedUrl}) - ${j.categories?.location || ''}`).join('\n');
            }
          }
        } catch (e) {}
      }

      for (const company of potentialBoardIds.workable) {
        try {
          const workableRes = await fetch(`https://apply.workable.com/api/v3/accounts/${company}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] })
          });
          if (workableRes.ok) {
            const data = await workableRes.json();
            if (data.results && Array.isArray(data.results)) {
              extraContent += `\n\n--- Workable Jobs (${company}) ---\n`;
              extraContent += data.results.map((j: any) => `[${j.title}](https://apply.workable.com/${company}/j/${j.shortlink}) - ${j.location?.name || ''}`).join('\n');
            }
          }
        } catch (e) {}
      }

      for (const company of potentialBoardIds.smartrecruiters) {
        try {
          const srRes = await fetch(`https://api.smartrecruiters.com/v1/companies/${company}/postings`);
          if (srRes.ok) {
            const data = await srRes.json();
            if (data.content && Array.isArray(data.content)) {
              extraContent += `\n\n--- SmartRecruiters Jobs (${company}) ---\n`;
              extraContent += data.content.map((j: any) => `[${j.name}](https://jobs.smartrecruiters.com/${company}/${j.id}) - ${j.location?.city || ''}`).join('\n');
            }
          }
        } catch (e) {}
      }

      for (const company of potentialBoardIds.bamboohr) {
        try {
          const bambooRes = await fetch(`https://${company}.bamboohr.com/jobs/embed2.php`);
          if (bambooRes.ok) {
            const html = await bambooRes.text();
            const $b = cheerio.load(html);
            const jobs: string[] = [];
            $b('a').each((_, el) => {
              const href = $b(el).attr('href');
              const title = $b(el).text().trim();
              if (href && href.includes('/jobs/view.php') && title) {
                jobs.push(`[${title}](https://${company}.bamboohr.com${href})`);
              }
            });
            if (jobs.length > 0) {
              extraContent += `\n\n--- BambooHR Jobs (${company}) ---\n`;
              extraContent += jobs.join('\n');
            }
          }
        } catch (e) {}
      }

      for (const company of potentialBoardIds.ashby) {
        try {
          const ashbyRes = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${company}`);
          if (ashbyRes.ok) {
            const data = await ashbyRes.json();
            if (data.jobs && Array.isArray(data.jobs)) {
              extraContent += `\n\n--- Ashby Jobs (${company}) ---\n`;
              extraContent += data.jobs.map((j: any) => `[${j.title}](${j.jobUrl}) - ${j.location || ''}`).join('\n');
            }
          }
        } catch (e) {}
      }

      for (const wd of potentialBoardIds.workday) {
        try {
          const apiEndpoint = wd.siteId 
            ? `https://${wd.host}/wday/cxs/recruiting/rest/${wd.tenant}/${wd.siteId}/jobs`
            : `https://${wd.host}/wday/cxs/recruiting/rest/${wd.tenant}/jobs`;
          
          const apiResponse = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': commonHeaders['User-Agent'],
            },
            body: JSON.stringify({
              appliedFacets: {},
              limit: 100,
              offset: 0,
              searchText: urlStr.includes('droga') ? 'Droga5' : ''
            })
          });

          if (apiResponse.ok) {
            const apiData = await apiResponse.json();
            if (apiData.jobPostings && apiData.jobPostings.length > 0) {
              extraContent += `\n\n--- Workday Jobs (${wd.tenant}) ---\n`;
              extraContent += apiData.jobPostings.map((j: any) => 
                `[${j.title}](https://${wd.host}${j.externalPath}) - ${j.locationsText || ''}`
              ).join('\n');
            }
          }
        } catch (e) {}
      }

      // Special Handler: Workday Sites
      // Workday sites are SPAs that load data from a REST API.
      if (urlStr.includes('myworkdaysite.com') || urlStr.includes('myworkdayjobs.com')) {
        try {
          const urlObj = new URL(urlStr);
          const parts = urlObj.pathname.split('/').filter(Boolean);
          let tenant = '';
          let siteId = '';

          // Workday URLs typically follow these patterns:
          // 1. https://tenant.myworkdaysite.com/siteId
          // 2. https://wd3.myworkdaysite.com/recruiting/tenant/siteId
          
          const hostParts = urlObj.hostname.split('.');
          if (hostParts[0] === 'wd3' || hostParts[0] === 'wd5' || hostParts[0] === 'wd1' || hostParts[0] === 'www') {
            // Pattern 2
            if (parts[0] === 'recruiting') {
              tenant = parts[1];
              siteId = parts[2];
            } else {
              tenant = parts[0];
              siteId = parts[1];
            }
          } else {
            // Pattern 1
            tenant = hostParts[0];
            siteId = parts[0];
          }

          if (!tenant) {
            throw new Error('Could not determine Workday tenant from URL');
          }
          
          const apiEndpoint = siteId 
            ? `https://${urlObj.hostname}/wday/cxs/recruiting/rest/${tenant}/${siteId}/jobs`
            : `https://${urlObj.hostname}/wday/cxs/recruiting/rest/${tenant}/jobs`;
          
          // Extract query parameters to use as facets
          const appliedFacets: Record<string, string[]> = {};
          let searchText = "";
          
          urlObj.searchParams.forEach((value, key) => {
            // Common Workday facets: locations, jobFamilies, workerSubtypes, timeType, locationHierarchy
            if (['locations', 'jobFamilies', 'workerSubtypes', 'timeType', 'supervisoryOrganizations', 'locationHierarchy'].includes(key)) {
              if (!appliedFacets[key]) {
                appliedFacets[key] = [];
              }
              appliedFacets[key].push(value);
            }
            if (key === 'q' || key === 'searchText') {
              searchText = value;
            }
          });

          console.log(`Workday site detected. Tenant: ${tenant}, Site: ${siteId}. API: ${apiEndpoint}. Facets:`, appliedFacets);
          
          const apiResponse = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': commonHeaders['User-Agent'],
              'Referer': urlStr,
              'Origin': urlObj.origin,
              'Accept-Language': 'en-US,en;q=0.9',
              'sec-ch-ua': commonHeaders['sec-ch-ua'],
              'sec-ch-ua-mobile': commonHeaders['sec-ch-ua-mobile'],
              'sec-ch-ua-platform': commonHeaders['sec-ch-ua-platform'],
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
            },
            body: JSON.stringify({
              appliedFacets,
              limit: 100,
              offset: 0,
              searchText
            })
          });

          if (apiResponse.ok) {
            const apiData = await apiResponse.json();
            console.log(`Workday API success for ${tenant}. Total jobs: ${apiData.total || 0}`);
            if (apiData.jobPostings && apiData.jobPostings.length > 0) {
              const jobsText = apiData.jobPostings.map((j: any) => 
                `[${j.title}](${urlObj.origin}${j.externalPath}) - ${j.locationsText || ''}`
              ).join('\n');
              return res.json({ 
                text: `Workday Jobs Found (${apiData.total || apiData.jobPostings.length}):\n\n${jobsText}`,
                detectedBoard: 'Workday'
              });
            } else {
              console.log(`Workday API returned 0 jobs for ${tenant}. Data:`, JSON.stringify(apiData).substring(0, 200));
            }
          } else {
            const errorText = await apiResponse.text();
            console.warn(`Workday API error for ${tenant}: ${apiResponse.status}. Body: ${errorText.substring(0, 200)}`);
          }
        } catch (e: any) {
          console.warn('Workday API fetch failed, falling back to HTML scraping:', e.message);
        }
      }

      // Remove noise but keep potential content areas
      // CRITICAL: Don't remove JSON-LD scripts yet!
      $('script:not([type="application/ld+json"]), style, iframe, noscript').remove();
      
      // Remove "Skip to main content" links which often pollute sparse pages
      $('a').each((_, el) => {
        const text = $(el).text().toLowerCase();
        if (text.includes('skip to main content') || text.includes('skip to content')) {
          $(el).remove();
        }
      });
      
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

      // NEW: Deep Scan for SPA Data (Next.js, Svelte, etc.)
      let spaData = '';
      
      // Check body attributes for data (Droga5 pattern)
      const bodyPageData = $('body').attr('data-pagedata');
      if (bodyPageData) {
        try {
          const parsed = JSON.parse(bodyPageData);
          const jobs = parsed.jobs || [];
          if (Array.isArray(jobs) && jobs.length > 0) {
            const structuredJobs = jobs.map((j: any) => ({
              id: `d5-${j.ID || j.job_id || Math.random().toString(36).substring(7)}`,
              title: j.title || 'Unknown Title',
              company: j.company || 'Droga5',
              location: j.location || (j.country ? `${j.location || ''} ${j.country}`.trim() : 'Unknown'),
              link: j.application_link || j.permalink || urlStr,
              description: (j.description || 'No description').replace(/<[^>]*>/g, ' ').substring(0, 500) + '...',
              salary: 'Unknown',
              seniority: j.job_level || 'Unknown'
            }));
            console.log(`Successfully extracted ${structuredJobs.length} jobs from Droga5 data-pagedata`);
            return res.json({
              text: `Found ${structuredJobs.length} jobs in Droga5's internal data source.`,
              jobs: structuredJobs,
              detectedBoard: 'Droga5'
            });
          }
          spaData += JSON.stringify(parsed) + ' ';
        } catch (e) {}
      }

      $('script').each((_, el) => {
        const content = $(el).html();
        if (content) {
          // Look for Next.js data
          if (content.includes('__NEXT_DATA__')) {
            try {
              const data = JSON.parse(content);
              spaData += JSON.stringify(data.props?.pageProps || data.props || {}) + ' ';
            } catch (e) {}
          }
          // Look for other common state objects
          if (content.includes('window.__INITIAL_STATE__') || 
              content.includes('window.__APOLLO_STATE__') ||
              content.includes('window.__PRELOADED_STATE__') ||
              content.includes('window.__REDUX_STATE__') ||
              content.includes('window.__NUXT__') ||
              content.includes('window.__DATA__')) {
            spaData += content.substring(0, 10000) + ' '; // Take a larger chunk of the state
          }
        }
      });

      // Now we can remove all scripts
      $('script').remove();

      // Try to find the main content area if it exists
      let mainContent = $('main, #content, .content, #main, [role="main"], article, .jobs-list, .vacancies-list, [class*="job-list"], [class*="vacancy-list"], [class*="career-list"], .Careers__DepartmentTitle, .Careers__JobTitle, .Careers__Section').text();
      
      // If main content is sparse or doesn't seem to contain jobs, fallback to body
      const jobKeywords = ['job', 'vacancy', 'career', 'position', 'role', 'apply', 'salary', 'director', 'manager', 'designer', 'developer', 'engineer'];
      const hasJobKeywords = jobKeywords.some(k => mainContent.toLowerCase().includes(k));

      if (!mainContent || mainContent.length < 500 || !hasJobKeywords) {
        mainContent = $('body').text();
      }

      // If still sparse, try to grab all headers as a last resort
      if (mainContent.length < 500) {
        mainContent += ' ' + $('h1, h2, h3, h4').map((_, el) => $(el).text()).get().join(' ');
      }

      const text = (mainContent + ' ' + jsonLdData + ' ' + spaData + ' ' + extraContent).replace(/\s+/g, ' ').trim().substring(0, 30000);
      
      console.log(`Extracted text length for ${urlStr}: ${text.length}`);
      if (text.length < 100) {
        console.log(`CRITICAL: Very low content for ${urlStr}. HTML snippet: ${html.substring(0, 1000)}`);
      }

      // Generic Holding Company Fallback - ALWAYS try if domain matches, as these are known difficult SPAs
      let holdingCompanyMatch = null;
      for (const domain in HOLDING_COMPANY_WORKDAY_MAP) {
        // Match against full domain or just the name part (e.g., 'droga5' from 'droga5.com')
        const brandSlug = domain.split('.')[0];
        const isKnownBoardUrl = urlStr.includes('smartrecruiters.com') || 
                                urlStr.includes('greenhouse.io') || 
                                urlStr.includes('lever.co') || 
                                urlStr.includes('workable.com') ||
                                urlStr.includes('ashbyhq.com');

        if (urlStr.toLowerCase().includes(domain.toLowerCase()) || (urlStr.toLowerCase().includes(brandSlug) && !isKnownBoardUrl)) {
          holdingCompanyMatch = HOLDING_COMPANY_WORKDAY_MAP[domain];
          console.log(`Matched holding company domain/slug for ${domain}: ${urlStr}`);
          break;
        }
      }

      if (holdingCompanyMatch) {
        try {
          const { host, tenant, siteId, brandName } = holdingCompanyMatch;
          const apiEndpoint = siteId 
            ? `https://${host}/wday/cxs/recruiting/rest/${tenant}/${siteId}/jobs`
            : `https://${host}/wday/cxs/recruiting/rest/${tenant}/jobs`;
          
          console.log(`Holding company fallback triggered for ${urlStr}. Target API: ${apiEndpoint}, Search: ${brandName}`);
          
          // Try with brandName first
          let accRes = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'User-Agent': commonHeaders['User-Agent']
            },
            body: JSON.stringify({ appliedFacets: {}, limit: 50, offset: 0, searchText: brandName })
          });
          
          let accData = accRes.ok ? await accRes.json() : null;

          // If no jobs found with brandName, try a broader search if brandName had a number (like Droga5 -> Droga)
          if ((!accData || !accData.jobPostings || accData.jobPostings.length === 0) && brandName && /\d/.test(brandName)) {
            const broaderBrand = brandName.replace(/\d+$/, '');
            console.log(`No jobs for ${brandName}, trying broader search: ${broaderBrand}`);
            accRes = await fetch(apiEndpoint, {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'User-Agent': commonHeaders['User-Agent']
              },
              body: JSON.stringify({ appliedFacets: {}, limit: 50, offset: 0, searchText: broaderBrand })
            });
            if (accRes.ok) accData = await accRes.json();
          }
          
          if (accData && accData.jobPostings && accData.jobPostings.length > 0) {
            const jobsList = accData.jobPostings.map((j: any) => ({
              id: `wd-${j.bulletinId || j.jobPostingId || Math.random().toString(36).substring(7)}`,
              title: j.title,
              company: brandName,
              location: j.locationsText || 'Unknown',
              link: `https://${host}/en-US/${siteId || tenant}${j.externalPath}`,
              description: `Found via ${host} API.`,
              salary: 'Unknown',
              seniority: 'Unknown'
            }));
            
            const jobsText = jobsList.map((j: any) => `[${j.title}](${j.link}) - ${j.location}`).join('\n');
            console.log(`Returning ${jobsList.length} structured jobs for ${brandName}`);
            return res.json({ 
              text: `Found ${brandName} jobs via ${host} API:\n\n${jobsText}`,
              jobs: jobsList,
              detectedBoard: 'Workday'
            });
          } else {
            console.log(`No jobs found in API response for ${brandName} or API request failed.`);
          }
        } catch (e: any) {
          console.error(`Holding company fallback error for ${urlStr}:`, e.message);
        }
      }

      // Smart Check: If text is too short, try to find any career-related links
      if (text.length < 1500) {
        console.log(`Sparse content detected for ${urlStr} (${text.length} chars). Checking for career links...`);
        let careerLinks = '';
        $('a').each((_, el) => {
          const href = $(el).attr('href');
          const linkText = $(el).text().toLowerCase();
          if (href && (linkText.includes('career') || linkText.includes('job') || linkText.includes('opening') || linkText.includes('work with us'))) {
             careerLinks += ` [${$(el).text().trim()}](${href}) `;
          }
        });
        if (careerLinks) {
          return res.json({ 
            text: `The page content was sparse, but found these potential career links: ${careerLinks}`,
            detectedBoard
          });
        }
      }

      res.json({ text, detectedBoard });
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

  // Publicis Groupe API Proxy (iCIMS vanity portal)
  app.get('/api/publicis-jobs', async (req, res) => {
    try {
      const maxJobs = parseInt(req.query.limit as string) || 4000;
      let allJobs: any[] = [];
      let offset = 0;
      const limit = 100;
      
      while (allJobs.length < maxJobs) {
        const response = await fetch(`https://careers.publicisgroupe.com/api/jobs?limit=${limit}&offset=${offset}`);
        if (!response.ok) break;
        
        const data: any = await response.json();
        if (!data.jobs || data.jobs.length === 0) break;
        
        allJobs = [...allJobs, ...data.jobs];
        offset += limit;
        
        if (allJobs.length >= (data.totalCount || 3000)) break;
      }
      
      res.json({ jobs: allJobs, totalCount: allJobs.length });
    } catch (error: any) {
      res.status(500).json({ error: 'Failed to connect to Publicis Careers API' });
    }
  });

  // SmartRecruiters API Proxy
  app.get('/api/smartrecruiters-jobs', async (req, res) => {
    const { company } = req.query;
    if (!company) return res.status(400).json({ error: 'Company ID is required' });

    try {
      const response = await fetch(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`);
      if (!response.ok) {
        return res.status(response.status).json({ 
          error: `SmartRecruiters API returned ${response.status}: ${response.statusText}`,
          company 
        });
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error(`SmartRecruiters fetch error for ${company}:`, error.message);
      res.status(500).json({ error: 'Failed to connect to SmartRecruiters API' });
    }
  });

  // Greenhouse API Proxy
  app.get('/api/greenhouse-jobs', async (req, res) => {
    const { boardId } = req.query;
    if (!boardId) return res.status(400).json({ error: 'Board ID is required' });

    try {
      const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardId}/jobs`);
      if (!response.ok) {
        // Return the status from Greenhouse if it's not a success
        return res.status(response.status).json({ 
          error: `Greenhouse API returned ${response.status}: ${response.statusText}`,
          boardId 
        });
      }
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error(`Greenhouse fetch error for ${boardId}:`, error.message);
      res.status(500).json({ error: 'Failed to connect to Greenhouse API' });
    }
  });

  // Extension ZIP Generation
  app.get('/api/extension/download', async (req, res) => {
    try {
      const zip = new JSZip();
      const extensionDir = path.resolve('extension');
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const currentHost = req.headers.host;
      const appUrl = (process.env.APP_URL || `${protocol}://${currentHost}`).replace(/\/$/, '');
      const frontendUrl = (process.env.FRONTEND_URL || appUrl).replace(/\/$/, '');

      // Add files to ZIP
      const manifest = await fs.readFile(path.join(extensionDir, 'manifest.json'), 'utf8');
      const popupHtml = await fs.readFile(path.join(extensionDir, 'popup.html'), 'utf8');
      const popupCss = await fs.readFile(path.join(extensionDir, 'popup.css'), 'utf8');
      const popupJsTemplate = await fs.readFile(path.join(extensionDir, 'popup.js.template'), 'utf8');

      // Replace placeholders in popup.js
      const popupJs = popupJsTemplate
        .replaceAll('__API_BASE_URL__', appUrl)
        .replaceAll('__FRONTEND_URL__', frontendUrl);

      zip.file('manifest.json', manifest);
      zip.file('popup.html', popupHtml);
      zip.file('popup.css', popupCss);
      zip.file('popup.js', popupJs);

      // Add icon.svg
      const iconPath = path.join(extensionDir, 'icon.svg');
      if (await fs.pathExists(iconPath)) {
        const iconData = await fs.readFile(iconPath);
        zip.file('icon.svg', iconData);
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
