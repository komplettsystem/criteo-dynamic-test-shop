import { Page } from '@playwright/test';

export interface PageSignals {
  url: string;
  variant: string;
  pageType: string;
  dataLayer: Record<string, unknown>[];
  digitalData: Record<string, unknown> | null;
  jsonLd: Record<string, unknown>[];
  openGraph: Record<string, string>;
  title: string;
  h1: string;
}

/** Extract all structured-data signals from the current page. */
export async function extractSignals(
  page: Page,
  variant: string,
  pageType: string,
): Promise<PageSignals> {
  // Give inline scripts time to execute (they're synchronous, but wait for DOM)
  await page.waitForLoadState('domcontentloaded');

  const signals = await page.evaluate(() => {
    // DataLayer
    const dl = (window as any).dataLayer as unknown[] | undefined;
    const dataLayer: Record<string, unknown>[] = (Array.isArray(dl) ? dl : [])
      .filter(e => e && typeof e === 'object') as Record<string, unknown>[];

    // CEDDL digitalData
    const digitalData = (window as any).digitalData ?? null;

    // JSON-LD
    const jsonLd: Record<string, unknown>[] = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try { jsonLd.push(JSON.parse(el.textContent || '{}')); } catch { /* skip invalid */ }
    });

    // OpenGraph + product: meta tags
    const openGraph: Record<string, string> = {};
    document.querySelectorAll('meta[property], meta[name]').forEach(el => {
      const key = el.getAttribute('property') || el.getAttribute('name') || '';
      const val = el.getAttribute('content') || '';
      if (key.startsWith('og:') || key.startsWith('product:') || key.startsWith('twitter:')) {
        openGraph[key] = val;
      }
    });

    return {
      dataLayer,
      digitalData,
      jsonLd,
      openGraph,
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
    };
  });

  return {
    url: page.url(),
    variant,
    pageType,
    ...signals,
  };
}

/** Find a JSON-LD block by @type. */
export function findJsonLdByType(
  blocks: Record<string, unknown>[],
  type: string,
): Record<string, unknown> | null {
  return blocks.find(b => b['@type'] === type) ?? null;
}

/** Find all dataLayer events matching a given event name or eventName field. */
export function findDlEvents(
  dl: Record<string, unknown>[],
  eventName: string,
): Record<string, unknown>[] {
  return dl.filter(
    e => e['event'] === eventName || e['eventName'] === eventName,
  );
}

/** Extract ecommerce items from a dataLayer event (handles both GA4 and non-standard). */
export function extractDlItems(event: Record<string, unknown>): Record<string, unknown>[] {
  const ec = (event['ecommerce'] || event['commerce']) as Record<string, unknown> | undefined;
  if (!ec) return [];
  const items = (ec['items'] || ec['products']) as unknown[] | undefined;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}
