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

function latestObservationByAsin(observations: BookObservation[]): Map<string, BookObservation> {
  const latest = new Map<string, BookObservation>();

  for (const observation of observations) {
    if (!observation.asin) continue;
    const existing = latest.get(observation.asin);
    if (!existing || observation.observedAt > existing.observedAt) {
      latest.set(observation.asin, observation);
    }
  }

  return latest;
}

function createNextCard(
  result: SavedSearchResult,
  label: string,
  buttonLabel: string,
  status: HTMLParagraphElement,
  extraMeta?: string,
): HTMLElement {
  const nextCard = document.createElement('div');
  nextCard.className = 'audit-queue-next';

  const nextLabel = document.createElement('span');
  nextLabel.className = 'audit-queue-next-label';
  nextLabel.textContent = label;

  const title = document.createElement('p');
  title.className = 'audit-queue-title';
  title.textContent = `#${result.position} ${result.title}`;

  const meta = document.createElement('p');
  meta.className = 'audit-queue-meta';
  meta.textContent = [
    result.asin,
    result.sponsored ? 'Sponsored' : 'Organic',
    extraMeta,
  ].filter((value): value is string => Boolean(value)).join(' · ');

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'secondary audit-queue-open';
  openButton.dataset.asin = result.asin;
  openButton.textContent = buttonLabel;
  openButton.addEventListener('click', async () => {
    openButton.disabled = true;
    openButton.textContent = 'Opening…';
    try {
      await chrome.tabs.create({ url: result.url, active: true });
    } catch {
      openButton.disabled = false;
      openButton.textContent = buttonLabel;
      status.textContent = 'Could not open the Amazon product page.';
    }
  });

  nextCard.append(nextLabel, title, meta, openButton);
  return nextCard;
}

function renderQueue(
  article: HTMLElement,
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): void {
  article.querySelector('.audit-queue')?.remove();

  const direct = uniqueDirectResults(search);
  const uncaptured = direct.filter((result) => !latestObservations.has(result.asin));
  const needsBsrRetry = direct.filter((result) => {
    const observation = latestObservations.get(result.asin);
    return Boolean(observation) && observation?.booksBsr === undefined;
  });

  const panel = document.createElement('section');
  panel.className = 'audit-queue';

  const headingRow = document.createElement('div');
  headingRow.className = 'audit-queue-heading-row';

  const heading = document.createElement('p');
  heading.className = 'audit-queue-heading';
  heading.textContent = 'Audit queue';

  const remaining = document.createElement('span');
  remaining.className = 'audit-queue-count';
  const totalRemaining = uncaptured.length + needsBsrRetry.length;
  remaining.textContent = `${totalRemaining.toLocaleString()} incomplete`;

  headingRow.append(heading, remaining);

  const status = document.createElement('p');
  status.className = 'audit-queue-status';
  panel.append(headingRow, status);

  if (direct.length === 0) {
    remaining.textContent = '0 incomplete';
    status.textContent = 'No unique Direct competitors are classified in this search.';
  } else if (totalRemaining === 0) {
    remaining.textContent = 'Complete';
    status.textContent = `All ${direct.length.toLocaleString()} unique Direct competitors have a saved product observation with Books BSR.`;
  } else {
    status.textContent = `${uncaptured.length.toLocaleString()} uncaptured · ${needsBsrRetry.length.toLocaleString()} need BSR retry · ${direct.length.toLocaleString()} unique Direct total.`;

    const uncapturedSection = document.createElement('div');
    uncapturedSection.className = 'audit-queue-section';

    const uncapturedHeading = document.createElement('p');
    uncapturedHeading.className = 'audit-queue-subheading';
    uncapturedHeading.textContent = `Product capture · ${uncaptured.length.toLocaleString()} remaining`;
    uncapturedSection.append(uncapturedHeading);

    const nextUncaptured = uncaptured[0];
    if (nextUncaptured) {
      uncapturedSection.append(createNextCard(
        nextUncaptured,
        'Next uncaptured',
        'Open next uncaptured',
        status,
      ));
    } else {
      const complete = document.createElement('p');
      complete.className = 'audit-queue-status';
      complete.textContent = 'Every unique Direct competitor has at least one saved observation.';
      uncapturedSection.append(complete);
    }

    const retrySection = document.createElement('div');
    retrySection.className = 'audit-queue-section';

    const retryHeading = document.createElement('p');
    retryHeading.className = 'audit-queue-subheading';
    retryHeading.textContent = `BSR retry · ${needsBsrRetry.length.toLocaleString()} remaining`;
    retrySection.append(retryHeading);

    const nextRetry = needsBsrRetry[0];
    if (nextRetry) {
      const observation = latestObservations.get(nextRetry.asin);
      const observedText = observation
        ? `last observed ${new Date(observation.observedAt).toLocaleString()}`
        : undefined;
      retrySection.append(createNextCard(
        nextRetry,
        'Next missing BSR',
        'Open next BSR retry',
        status,
        observedText,
      ));
    } else {
      const complete = document.createElement('p');
      complete.className = 'audit-queue-status';
      complete.textContent = 'No captured Direct competitors are missing Books BSR.';
      retrySection.append(complete);
    }

    panel.append(uncapturedSection, retrySection);
  }

  const marketSummary = article.querySelector('.market-summary');
  const details = article.querySelector('.saved-search-details');
  if (marketSummary) article.insertBefore(panel, marketSummary);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

async function getData(): Promise<{
  searches: SavedSearchCapture[];
  latestObservations: Map<string, BookObservation>;
}> {
  const stored = await chrome.storage.local.get([SEARCH_STORAGE_KEY, BOOK_STORAGE_KEY]);
  const searches = Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? (stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[])
    : [];
  const observations = Array.isArray(stored[BOOK_STORAGE_KEY])
    ? (stored[BOOK_STORAGE_KEY] as BookObservation[])
    : [];

  return { searches, latestObservations: latestObservationByAsin(observations) };
}

async function renderAuditQueues(): Promise<void> {
  if (!savedSearchesList) return;

  const { searches, latestObservations } = await getData();
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderQueue(article, search, latestObservations);
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
