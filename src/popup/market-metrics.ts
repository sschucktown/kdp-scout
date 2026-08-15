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

interface MarketMetrics {
  directUnique: number;
  bsrObserved: number;
  bsr35kOrBetter: number;
  winningUnder300Reviews: number;
  review500Plus: number;
  publicationKnown: number;
  recent18Months: number;
  medianBsr?: number;
  bestBsr?: number;
  worstBsr?: number;
  medianRatings?: number;
  medianPrice?: number;
}

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) return undefined;
  return (left + right) / 2;
}

function parseDisplayedPrice(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/([\d,]+(?:\.\d{1,2})?)/);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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

function uniqueDirectResults(search: SavedSearchCapture): Map<string, SavedSearchResult> {
  const unique = new Map<string, SavedSearchResult>();

  for (const result of search.results) {
    if (result.relevance !== 'Direct') continue;
    const existing = unique.get(result.asin);
    if (!existing) {
      unique.set(result.asin, { ...result });
      continue;
    }

    if (existing.displayPrice === undefined && result.displayPrice !== undefined) {
      existing.displayPrice = result.displayPrice;
    }
    if (existing.ratingCount === undefined && result.ratingCount !== undefined) {
      existing.ratingCount = result.ratingCount;
    }
  }

  return unique;
}

function calculateMetrics(
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): MarketMetrics {
  const direct = uniqueDirectResults(search);
  const bsrValues: number[] = [];
  const ratingValues: number[] = [];
  const priceValues: number[] = [];

  let bsr35kOrBetter = 0;
  let winningUnder300Reviews = 0;
  let review500Plus = 0;
  let publicationKnown = 0;
  let recent18Months = 0;

  const capturedAt = new Date(search.capturedAt);
  const recentCutoff = new Date(capturedAt);
  recentCutoff.setMonth(recentCutoff.getMonth() - 18);

  for (const [asin, result] of direct) {
    const observation = latestObservations.get(asin);
    const bsr = observation?.booksBsr;
    const ratings = observation?.ratingCount ?? result.ratingCount;
    const price = parseDisplayedPrice(observation?.displayPrice) ?? parseDisplayedPrice(result.displayPrice);

    if (bsr !== undefined) {
      bsrValues.push(bsr);
      if (bsr <= 35_000) {
        bsr35kOrBetter += 1;
        if (ratings !== undefined && ratings < 300) winningUnder300Reviews += 1;
      }
    }

    if (ratings !== undefined) {
      ratingValues.push(ratings);
      if (ratings >= 500) review500Plus += 1;
    }

    if (price !== undefined) priceValues.push(price);

    if (observation?.publicationDate) {
      const publishedAt = new Date(observation.publicationDate);
      if (!Number.isNaN(publishedAt.getTime())) {
        publicationKnown += 1;
        if (publishedAt >= recentCutoff && publishedAt <= capturedAt) recent18Months += 1;
      }
    }
  }

  return {
    directUnique: direct.size,
    bsrObserved: bsrValues.length,
    bsr35kOrBetter,
    winningUnder300Reviews,
    review500Plus,
    publicationKnown,
    recent18Months,
    medianBsr: median(bsrValues),
    bestBsr: bsrValues.length > 0 ? Math.min(...bsrValues) : undefined,
    worstBsr: bsrValues.length > 0 ? Math.max(...bsrValues) : undefined,
    medianRatings: median(ratingValues),
    medianPrice: median(priceValues),
  };
}

function metric(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'market-metric';

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;

  item.append(labelEl, valueEl);
  return item;
}

function formatWhole(value: number | undefined): string {
  return value === undefined ? '—' : Math.round(value).toLocaleString();
}

function renderPanel(article: HTMLElement, metrics: MarketMetrics): void {
  article.querySelector('.market-summary')?.remove();

  const panel = document.createElement('section');
  panel.className = 'market-summary';

  const heading = document.createElement('p');
  heading.className = 'market-summary-heading';
  heading.textContent = 'Market metrics · unique Direct ASINs';

  const grid = document.createElement('div');
  grid.className = 'market-summary-grid';
  grid.append(
    metric('Unique Direct', metrics.directUnique.toLocaleString()),
    metric('BSR observed', `${metrics.bsrObserved}/${metrics.directUnique}`),
    metric('BSR ≤35k', metrics.bsr35kOrBetter.toLocaleString()),
    metric('BSR≤35k + <300 reviews', metrics.winningUnder300Reviews.toLocaleString()),
    metric('500+ reviews', metrics.review500Plus.toLocaleString()),
    metric('Published ≤18 mo', `${metrics.recent18Months}/${metrics.publicationKnown || 0} dated`),
    metric('Median BSR', metrics.medianBsr === undefined ? '—' : `#${formatWhole(metrics.medianBsr)}`),
    metric(
      'BSR range',
      metrics.bestBsr === undefined || metrics.worstBsr === undefined
        ? '—'
        : `#${metrics.bestBsr.toLocaleString()}–#${metrics.worstBsr.toLocaleString()}`,
    ),
    metric('Median reviews', formatWhole(metrics.medianRatings)),
    metric('Median price', metrics.medianPrice === undefined ? '—' : `$${metrics.medianPrice.toFixed(2)}`),
  );

  const note = document.createElement('p');
  note.className = 'market-summary-note';
  note.textContent = 'Uses latest linked product observations where available. Current BSR is a snapshot, not proof of sustained performance.';

  panel.append(heading, grid, note);

  const details = article.querySelector('.saved-search-details');
  if (details) article.insertBefore(panel, details);
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

  return {
    searches,
    latestObservations: latestObservationByAsin(observations),
  };
}

async function renderMarketMetrics(): Promise<void> {
  if (!savedSearchesList) return;
  const { searches, latestObservations } = await getData();
  const sorted = [...searches].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderPanel(article, calculateMetrics(search, latestObservations));
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderMarketMetrics());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY]) return;
  void renderMarketMetrics();
});

void renderMarketMetrics();
