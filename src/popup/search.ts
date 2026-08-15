interface SearchResultDraft {
  position: number;
  sponsored: boolean;
  asin: string;
  title: string;
  url: string;
  displayPrice?: string;
  ratingCount?: number;
}

interface SearchDraft {
  query: string;
  url: string;
  results: SearchResultDraft[];
}

interface SearchCapture extends SearchDraft {
  id: string;
  capturedAt: string;
}

const SEARCH_STORAGE_KEY = 'searchCaptures';

const searchCard = document.querySelector<HTMLElement>('#search-card');
const productStatus = document.querySelector<HTMLParagraphElement>('#status');
const searchStatus = document.querySelector<HTMLParagraphElement>('#search-status');
const searchQuery = document.querySelector<HTMLElement>('#search-query');
const searchResultCount = document.querySelector<HTMLElement>('#search-result-count');
const searchResultsList = document.querySelector<HTMLElement>('#search-results-list');
const saveSearchButton = document.querySelector<HTMLButtonElement>('#save-search');
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
const bookCard = document.querySelector<HTMLElement>('#book-card');
const diagnosticsPanel = document.querySelector<HTMLElement>('#diagnostics-panel');

let currentSearch: SearchDraft | null = null;

function setSearchStatus(message: string, kind: 'normal' | 'error' | 'success' = 'normal'): void {
  if (!searchStatus) return;
  searchStatus.textContent = message;
  searchStatus.classList.toggle('error', kind === 'error');
  searchStatus.classList.toggle('success', kind === 'success');
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

function isAmazonSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /(^|\.)amazon\.com$/i.test(url.hostname)
      && (url.pathname === '/s' || Boolean(url.searchParams.get('k')));
  } catch {
    return false;
  }
}

function extractAmazonSearch(): SearchDraft {
  const normalize = (value: string | null | undefined): string =>
    (value ?? '')
      .replace(/[\u200e\u200f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const url = new URL(window.location.href);
  const searchBox = document.querySelector<HTMLInputElement>('#twotabsearchtextbox');
  const query = normalize(searchBox?.value || url.searchParams.get('k') || url.searchParams.get('field-keywords'));

  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-component-type="s-search-result"]'),
  );

  const results: SearchResultDraft[] = [];

  for (const node of nodes) {
    const titleLink = node.querySelector<HTMLAnchorElement>('h2 a');
    const rawHref = titleLink?.getAttribute('href') ?? '';
    const hrefAsin = rawHref.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
    const asin = normalize(node.dataset.asin || hrefAsin).toUpperCase();
    const title = normalize(
      node.querySelector('h2 a span')?.textContent
      ?? node.querySelector('h2 span')?.textContent,
    );

    if (!asin || asin.length !== 10 || !title) continue;

    const sponsored = Boolean(node.querySelector('[aria-label*="Sponsored" i]'))
      || Array.from(node.querySelectorAll('span')).some(
        (span) => normalize(span.textContent).toLowerCase() === 'sponsored',
      );

    const priceText = normalize(
      node.querySelector('.a-price .a-offscreen')?.textContent
      ?? node.querySelector('.a-color-price')?.textContent,
    );
    const priceMatch = priceText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    const displayPrice = priceMatch?.[1] ? `$${priceMatch[1]}` : undefined;

    const ratingCandidates = [
      ...Array.from(node.querySelectorAll('a[href*="customerReviews"], a[href*="product-reviews"]')),
      ...Array.from(node.querySelectorAll('span.a-size-base.s-underline-text')),
    ];

    let ratingCount: number | undefined;
    for (const candidate of ratingCandidates) {
      const value = normalize(candidate.textContent);
      const match = value.match(/(?:^|\()([\d,]+)(?:\)|\s+(?:ratings?|reviews?)|$)/i);
      if (!match?.[1]) continue;

      const parsed = Number.parseInt(match[1].replace(/,/g, ''), 10);
      if (Number.isFinite(parsed)) {
        ratingCount = parsed;
        break;
      }
    }

    results.push({
      position: results.length + 1,
      sponsored,
      asin,
      title,
      url: `https://www.amazon.com/dp/${asin}`,
      displayPrice,
      ratingCount,
    });
  }

  return {
    query,
    url: window.location.href,
    results,
  };
}

function renderSearch(search: SearchDraft): void {
  if (searchQuery) searchQuery.textContent = search.query || '—';
  if (searchResultCount) searchResultCount.textContent = search.results.length.toLocaleString();
  if (searchResultsList) searchResultsList.replaceChildren();

  if (searchResultsList) {
    for (const result of search.results) {
      const article = document.createElement('article');
      article.className = 'search-result-item';

      const position = document.createElement('div');
      position.className = 'search-result-position';
      position.textContent = `#${result.position}`;

      const content = document.createElement('div');

      const title = document.createElement('p');
      title.className = 'search-result-title';
      title.textContent = result.title;

      const meta = document.createElement('p');
      meta.className = 'search-result-meta';
      const parts = [
        result.asin,
        result.displayPrice ?? 'No price',
        result.ratingCount === undefined ? 'No ratings' : `${result.ratingCount.toLocaleString()} ratings`,
      ];
      meta.textContent = parts.join(' · ');

      if (result.sponsored) {
        const badge = document.createElement('span');
        badge.className = 'sponsored-badge';
        badge.textContent = 'Sponsored';
        content.append(badge);
      }

      content.append(title, meta);
      article.append(position, content);
      searchResultsList.append(article);
    }
  }

  if (saveSearchButton) saveSearchButton.disabled = search.results.length === 0 || !search.query;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sameSearch(left: SearchCapture, right: SearchDraft): boolean {
  if (left.query !== right.query || left.results.length !== right.results.length) return false;

  return left.results.every((result, index) => {
    const other = right.results[index];
    return Boolean(other)
      && result.position === other.position
      && result.sponsored === other.sponsored
      && result.asin === other.asin
      && result.title === other.title
      && result.url === other.url
      && result.displayPrice === other.displayPrice
      && result.ratingCount === other.ratingCount;
  });
}

async function saveSearch(): Promise<void> {
  if (!currentSearch?.query || currentSearch.results.length === 0) return;
  if (saveSearchButton) saveSearchButton.disabled = true;

  const stored = await chrome.storage.local.get(SEARCH_STORAGE_KEY);
  const captures = Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? (stored[SEARCH_STORAGE_KEY] as SearchCapture[])
    : [];
  const now = new Date();

  const duplicate = captures.some((capture) =>
    localDateKey(new Date(capture.capturedAt)) === localDateKey(now)
    && sameSearch(capture, currentSearch!),
  );

  if (duplicate) {
    setSearchStatus('This exact search result set was already saved today. Duplicate skipped.', 'success');
    if (saveSearchButton) saveSearchButton.disabled = false;
    return;
  }

  captures.push({
    ...currentSearch,
    id: crypto.randomUUID(),
    capturedAt: now.toISOString(),
  });

  await chrome.storage.local.set({ [SEARCH_STORAGE_KEY]: captures });
  setSearchStatus(
    `Saved ${currentSearch.results.length.toLocaleString()} results locally for “${currentSearch.query}”.`,
    'success',
  );
  if (saveSearchButton) saveSearchButton.disabled = false;
}

async function refreshSearchCapture(): Promise<void> {
  currentSearch = null;
  if (saveSearchButton) saveSearchButton.disabled = true;
  setSearchStatus('Reading visible Amazon search results…');

  try {
    const tab = await getActiveTab();
    const tabUrl = tab.url ?? '';
    if (!isAmazonSearchUrl(tabUrl)) return;

    if (productStatus) productStatus.hidden = true;
    if (bookCard) bookCard.hidden = true;
    if (diagnosticsPanel) diagnosticsPanel.hidden = true;
    if (searchCard) searchCard.hidden = false;

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: extractAmazonSearch,
    });

    const search = injection?.result as SearchDraft | undefined;
    if (!search?.query) {
      throw new Error('Could not determine the Amazon search phrase.');
    }
    if (search.results.length === 0) {
      throw new Error('No standard Amazon search-result cards were recognized on this page.');
    }

    currentSearch = search;
    renderSearch(search);
    setSearchStatus(`Captured ${search.results.length.toLocaleString()} visible results. Review before saving.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to capture this Amazon search page.';
    setSearchStatus(message, 'error');
  }
}

async function initializeSearchCapture(): Promise<void> {
  try {
    const tab = await getActiveTab();
    if (!isAmazonSearchUrl(tab.url ?? '')) return;
    await refreshSearchCapture();
  } catch {
    // The existing product-page capture owns errors on non-search pages.
  }
}

saveSearchButton?.addEventListener('click', () => void saveSearch());
refreshButton?.addEventListener('click', () => void refreshSearchCapture());

void initializeSearchCapture();
