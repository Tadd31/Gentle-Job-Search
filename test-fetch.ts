import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

async function test() {
  const url = 'https://careerssearch.saga.co.uk/';
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
  });
  const html = await response.text();
  const $ = cheerio.load(html);
  
  console.log('--- SELECTOR CHECK ---');
  ['main', '#content', '.content', '#main', '[role="main"]', 'body'].forEach(sel => {
    const text = $(sel).text().replace(/\s+/g, ' ').trim();
    console.log(`Selector "${sel}": ${text.length} chars`);
    if (text.includes('Data Analyst')) {
      console.log(`  -> Selector "${sel}" CONTAINS "Data Analyst"`);
    }
  });

  const content = $('#content');
  if (content.length > 0) {
    console.log('\n--- HEADERS INSIDE #content ---');
    content.find('header').each((i, el) => {
      console.log(`Header ${i}: ${$(el).text().trim().substring(0, 50)}...`);
    });
  }
  
  // Check links
  console.log('\n--- LINKS CHECK ---');
  $('a').slice(0, 10).each((i, el) => {
    console.log(`Link ${i}: ${$(el).text().trim()} -> ${$(el).attr('href')}`);
  });
}

test();
