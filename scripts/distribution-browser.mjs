import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer';
import { verifyLayoutWorkflow } from '../tests/layout.browser.mjs';
import { verifyReviewedAuthoring } from '../tests/review.browser.mjs';
import { verifyTagsAndNeighborhood } from '../tests/tags-neighborhood.browser.mjs';

export async function runDistributionBrowser(url, name) {
  const output = resolve(import.meta.dirname, '../test-results'); await mkdir(output, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: process.env.AXCANVAS_BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [] });
  const page = await browser.newPage();
  try {
    const layout = await verifyLayoutWorkflow(page, url);
    const review = await verifyReviewedAuthoring(page, url);
    const regions = await verifyTagsAndNeighborhood(page, url);
    await page.screenshot({ path: join(output, `distribution-${name}.png`), fullPage: true });
    return { layout, review, regions };
  } catch (error) { await page.screenshot({ path: join(output, `distribution-${name}-failure.png`), fullPage: true }); throw error; }
  finally { await browser.close(); }
}
