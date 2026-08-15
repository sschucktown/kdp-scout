export {};

import type { BookObservation } from '../models/book.js';

type RelevanceClassification = 'Direct' | 'Adjacent' | 'Irrelevant';

interface SavedSearchResult {
  position: number;
  sponsored: boolean;
  asin: string;
  title: string;
  url: string;
  displayPrice?: string;
  ratingCount?: number;
  relevance?: RelevanceClassification;
}

interface SavedSearchCapture {
  id: string;
  capturedAt: string;
  query: string;
  url: string;
  results: SavedSearchResult[];
}

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

function uniqueDirectResults(search: SavedSearchCapture): SavedSearchResult[] {
  const unique = new Map<string, SavedSearchResult>();

  for (const result of search.results) {
    if (result.relevance !== 'Direct' || unique.has(result.asin)) continue;
    unique.set(result.asin, result);
  }

  return [...unique.values()].sort((left, right) => left.position - right.position);
}

function observedAsins(observations: BookObservation[]): Set<string> {
  const asins = new Set<string>();
  for (const observation of observations) {
    if (observation.asin) asins.add(observation.asin);
  }
  return asins;
}

function renderQueue(
  article: HTMLElement,
  search: SavedSearchCapture,
  capturedAsins: Set<string>,
): void {
  article.querySelector('.audit-queue')?.remove();

  const direct = uniqueDirectResults(search);
  const missing = direct.filter((result) => !capturedAsins.has(result.asin));

  const panel = document.createElement('section');
  panel.className = 'audit-queue';

  const headingRow = document.createElement('div');
  headingRow.className = 'audit-queue-heading-row';

  const heading = document.createElement('p');
  heading.className = 'audit-queue-heading';
  heading.textContent = 'Audit queue';

  const remaining = document.createElement('span');
  remaining.className = 'audit-queue-count';
  remaining.textContent = `${missing.length.toLocaleString()} remaining`;

  headingRow.append(heading, remaining);

  const status = document.createElement('p');
  status.className = 'audit-queue-status';

  panel.append(headingRow, status);

  if (direct.length === 0) {
    remaining.textContent = '0 remaining';
    status.textContent = 'No unique Direct competitors are classified in this search.';
  } else if (missing.length === 0) {
    remaining.textContent = 'Complete';
    status.textContent = `All ${direct.length.toLocaleString()} unique Direct competitors have a saved product observation.`;
  } else {
    const next = missing[0];
    if (!next) return;

    status.textContent = `${missing.length.toLocaleString()} of ${direct.length.toLocaleString()} unique Direct competitors still need product capture.`;

    const nextCard = document.createElement('div');
    nextCard.className = 'audit-queue-next';

    const nextLabel = document.createElement('span');
    nextLabel.className = 'audit-queue-next-label';
    nextLabel.textContent = 'Next uncaptured';

    const title = document.createElement('p');
    title.className = 'audit-queue-title';
    title.textContent = `#${next.position} ${next.title}`;

    const meta = document.createElement('p');
    meta.className = 'audit-queue-meta';
    meta.textContent = `${next.asin} · ${next.sponsored ? 'Sponsored' : 'Organic'}`;

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'secondary audit-queue-open';
    openButton.dataset.asin = next.asin;
    openButton.textContent = 'Open next uncaptured';
    openButton.addEventListener('click', async () => {
      openButton.disabled = true;
      openButton.textContent = 'Opening…';
      try {
        await chrome.tabs.create({ url: next.url, active: true });
      } catch {
        openButton.disabled = false;
        openButton.textContent = 'Open next uncaptured';
        status.textContent = 'Could not open the Amazon product page.';
      }
    });

    nextCard.append(nextLabel, title, meta, openButton);
    panel.append(nextCard);
  }

  const marketSummary = article.querySelector('.market-summary');
  const details = article.querySelector('.saved-search-details');
  if (marketSummary) article.insertBefore(panel, marketSummary);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

async function getData(): Promise<{
  searches: SavedSearchCapture[];
  capturedAsins: Set<string>;
}> {
  const stored = await chrome.storage.local.get([SEARCH_STORAGE_KEY, BOOK_STORAGE_KEY]);
  const searches = Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? (stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[])
    : [];
  const observations = Array.isArray(stored[BOOK_STORAGE_KEY])
    ? (stored[BOOK_STORAGE_KEY] as BookObservation[])
    : [];

  return { searches, capturedAsins: observedAsins(observations) };
}

async function renderAuditQueues(): Promise<void> {
  if (!savedSearchesList) return;

  const { searches, capturedAsins } = await getData();
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderQueue(article, search, capturedAsins);
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderAuditQueues());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY]) return;
  void renderAuditQueues();
});

void renderAuditQueues();
