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

const captureTab = document.querySelector<HTMLButtonElement>('#capture-tab');
const observationsTab = document.querySelector<HTMLButtonElement>('#observations-tab');
const savedSearchesTab = document.querySelector<HTMLButtonElement>('#saved-searches-tab');
const captureView = document.querySelector<HTMLElement>('#capture-view');
const observationsView = document.querySelector<HTMLElement>('#observations-view');
const savedSearchesView = document.querySelector<HTMLElement>('#saved-searches-view');
const savedSearchCount = document.querySelector<HTMLElement>('#saved-search-count');
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');
const savedSearchesEmpty = document.querySelector<HTMLParagraphElement>('#saved-searches-empty');
const exportSearchesCsvButton = document.querySelector<HTMLButtonElement>('#export-searches-csv');
const exportSearchesJsonButton = document.querySelector<HTMLButtonElement>('#export-searches-json');
const clearSearchesButton = document.querySelector<HTMLButtonElement>('#clear-searches');
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvValue(value: string | number | boolean | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function getSavedSearches(): Promise<SavedSearchCapture[]> {
  const stored = await chrome.storage.local.get(SEARCH_STORAGE_KEY);
  return Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? (stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[])
    : [];
}

async function getBookObservations(): Promise<BookObservation[]> {
  const stored = await chrome.storage.local.get(BOOK_STORAGE_KEY);
  return Array.isArray(stored[BOOK_STORAGE_KEY])
    ? (stored[BOOK_STORAGE_KEY] as BookObservation[])
    : [];
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

function getCounts(search: SavedSearchCapture): {
  direct: number;
  adjacent: number;
  irrelevant: number;
  unclassified: number;
} {
  let direct = 0;
  let adjacent = 0;
  let irrelevant = 0;
  let unclassified = 0;

  for (const result of search.results) {
    if (result.relevance === 'Direct') direct += 1;
    else if (result.relevance === 'Adjacent') adjacent += 1;
    else if (result.relevance === 'Irrelevant') irrelevant += 1;
    else unclassified += 1;
  }

  return { direct, adjacent, irrelevant, unclassified };
}

function getDirectCoverage(
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): { total: number; observed: number; withBsr: number } {
  const directAsins = new Set(
    search.results
      .filter((result) => result.relevance === 'Direct')
      .map((result) => result.asin),
  );

  let observed = 0;
  let withBsr = 0;
  for (const asin of directAsins) {
    const observation = latestObservations.get(asin);
    if (!observation) continue;
    observed += 1;
    if (observation.booksBsr !== undefined) withBsr += 1;
  }

  return { total: directAsins.size, observed, withBsr };
}

function appendCount(container: HTMLElement, label: string, value: number): void {
  const item = document.createElement('span');
  item.append(document.createTextNode(label));
  const valueEl = document.createElement('strong');
  valueEl.textContent = value.toLocaleString();
  item.append(valueEl);
  container.append(item);
}

function observationSummary(observation: BookObservation): string {
  const parts = [
    observation.booksBsr === undefined ? undefined : `BSR #${observation.booksBsr.toLocaleString()}`,
    observation.publicationDate ? `Published ${observation.publicationDate}` : undefined,
    observation.publisher,
    observation.pageCount === undefined ? undefined : `${observation.pageCount.toLocaleString()} pages`,
  ].filter((value): value is string => Boolean(value));

  const details = parts.length > 0 ? parts.join(' · ') : 'Product details captured';
  return `${details} · observed ${new Date(observation.observedAt).toLocaleString()}`;
}

function renderSavedSearches(
  searches: SavedSearchCapture[],
  latestObservations: Map<string, BookObservation>,
): void {
  if (savedSearchCount) savedSearchCount.textContent = searches.length.toLocaleString();
  if (savedSearchesList) savedSearchesList.replaceChildren();
  if (savedSearchesEmpty) savedSearchesEmpty.hidden = searches.length > 0;
  if (exportSearchesCsvButton) exportSearchesCsvButton.disabled = searches.length === 0;
  if (exportSearchesJsonButton) exportSearchesJsonButton.disabled = searches.length === 0;
  if (clearSearchesButton) clearSearchesButton.disabled = searches.length === 0;

  if (!savedSearchesList) return;

  const sorted = [...searches].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  for (const search of sorted) {
    const counts = getCounts(search);
    const coverage = getDirectCoverage(search, latestObservations);
    const article = document.createElement('article');
    article.className = 'saved-search-item';

    const title = document.createElement('p');
    title.className = 'saved-search-title';
    title.textContent = search.query || 'Untitled search';

    const date = document.createElement('p');
    date.className = 'saved-search-date';
    date.textContent = `Captured ${new Date(search.capturedAt).toLocaleString()} · ${search.results.length.toLocaleString()} results`;

    const countGrid = document.createElement('div');
    countGrid.className = 'saved-search-counts';
    appendCount(countGrid, 'Direct', counts.direct);
    appendCount(countGrid, 'Adjacent', counts.adjacent);
    appendCount(countGrid, 'Irrelevant', counts.irrelevant);
    appendCount(countGrid, 'Unclassified', counts.unclassified);

    const coverageLine = document.createElement('p');
    coverageLine.className = 'saved-search-date';
    coverageLine.textContent = coverage.total === 0
      ? 'Direct product coverage: no Direct ASINs classified.'
      : `Direct product coverage: ${coverage.observed}/${coverage.total} unique ASINs observed · ${coverage.withBsr} with Books BSR`;

    const details = document.createElement('details');
    details.className = 'saved-search-details';
    const summary = document.createElement('summary');
    summary.textContent = `View ${search.results.length.toLocaleString()} results`;

    const results = document.createElement('div');
    results.className = 'saved-search-results';

    for (const result of search.results) {
      const row = document.createElement('div');
      row.className = 'saved-search-result';

      const position = document.createElement('div');
      position.className = 'saved-search-result-position';
      position.textContent = `#${result.position}`;

      const content = document.createElement('div');
      const resultTitle = document.createElement('a');
      resultTitle.className = 'saved-search-result-title';
      resultTitle.href = result.url;
      resultTitle.target = '_blank';
      resultTitle.rel = 'noreferrer';
      resultTitle.textContent = result.title;

      const meta = document.createElement('p');
      meta.className = 'saved-search-result-meta';

      const relevance = document.createElement('span');
      relevance.className = 'relevance-label';
      relevance.textContent = result.relevance ?? 'Unclassified';
      meta.append(relevance);

      const metadata = [
        result.asin,
        result.sponsored ? 'Sponsored' : 'Organic',
        result.displayPrice ?? 'No price',
        result.ratingCount === undefined ? 'No ratings' : `${result.ratingCount.toLocaleString()} ratings`,
      ].join(' · ');
      meta.append(document.createTextNode(metadata));

      content.append(resultTitle, meta);

      const latestObservation = latestObservations.get(result.asin);
      if (latestObservation) {
        const observationMeta = document.createElement('p');
        observationMeta.className = 'saved-search-result-meta';
        observationMeta.textContent = observationSummary(latestObservation);
        content.append(observationMeta);
      } else if (result.relevance === 'Direct') {
        const missingObservation = document.createElement('p');
        missingObservation.className = 'saved-search-result-meta';
        missingObservation.textContent = 'No product observation captured yet.';
        content.append(missingObservation);
      }

      row.append(position, content);
      results.append(row);
    }

    details.append(summary, results);
    article.append(title, date, countGrid, coverageLine, details);
    savedSearchesList.append(article);
  }
}

async function refreshSavedSearchesView(): Promise<SavedSearchCapture[]> {
  const [searches, observations] = await Promise.all([getSavedSearches(), getBookObservations()]);
  renderSavedSearches(searches, latestObservationByAsin(observations));
  return searches;
}

function showSavedSearchesView(): void {
  if (captureView) captureView.hidden = true;
  if (observationsView) observationsView.hidden = true;
  if (savedSearchesView) savedSearchesView.hidden = false;
  captureTab?.classList.remove('active');
  observationsTab?.classList.remove('active');
  savedSearchesTab?.classList.add('active');
  if (refreshButton) refreshButton.hidden = true;
  void refreshSavedSearchesView();
}

function hideSavedSearchesView(): void {
  if (savedSearchesView) savedSearchesView.hidden = true;
  savedSearchesTab?.classList.remove('active');
}

async function exportSearchesCsv(): Promise<void> {
  const [searches, observations] = await Promise.all([getSavedSearches(), getBookObservations()]);
  if (searches.length === 0) return;
  const latestObservations = latestObservationByAsin(observations);

  const headers = [
    'searchId',
    'capturedAt',
    'query',
    'searchUrl',
    'position',
    'sponsored',
    'relevance',
    'asin',
    'title',
    'productUrl',
    'displayPrice',
    'ratingCount',
    'latestObservedAt',
    'latestBooksBsr',
    'latestPublisher',
    'latestPublicationDate',
    'latestPageCount',
    'latestObservedPrice',
    'latestObservedRatingCount',
  ];

  const rows: string[] = [];
  for (const search of searches) {
    for (const result of search.results) {
      const observation = latestObservations.get(result.asin);
      rows.push([
        search.id,
        search.capturedAt,
        search.query,
        search.url,
        result.position,
        result.sponsored,
        result.relevance,
        result.asin,
        result.title,
        result.url,
        result.displayPrice,
        result.ratingCount,
        observation?.observedAt,
        observation?.booksBsr,
        observation?.publisher,
        observation?.publicationDate,
        observation?.pageCount,
        observation?.displayPrice,
        observation?.ratingCount,
      ].map(csvValue).join(','));
    }
  }

  const csv = `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}\r\n`;
  downloadText(`kdp-scout-searches-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
}

async function exportSearchesJson(): Promise<void> {
  const [searches, observations] = await Promise.all([getSavedSearches(), getBookObservations()]);
  if (searches.length === 0) return;
  const latestObservations = latestObservationByAsin(observations);

  const enrichedSearches = searches.map((search) => ({
    ...search,
    results: search.results.map((result) => ({
      ...result,
      latestObservation: latestObservations.get(result.asin) ?? null,
    })),
  }));

  downloadText(
    `kdp-scout-searches-${localDateKey(new Date())}.json`,
    JSON.stringify(enrichedSearches, null, 2),
    'application/json;charset=utf-8',
  );
}

async function clearSavedSearches(): Promise<void> {
  const searches = await getSavedSearches();
  if (searches.length === 0) return;

  const confirmed = window.confirm(
    `Delete all ${searches.length.toLocaleString()} saved search snapshot${searches.length === 1 ? '' : 's'} from this Chrome profile?`,
  );
  if (!confirmed) return;

  await chrome.storage.local.remove(SEARCH_STORAGE_KEY);
  renderSavedSearches([], new Map());
}

savedSearchesTab?.addEventListener('click', showSavedSearchesView);
captureTab?.addEventListener('click', hideSavedSearchesView);
observationsTab?.addEventListener('click', hideSavedSearchesView);
exportSearchesCsvButton?.addEventListener('click', () => void exportSearchesCsv());
exportSearchesJsonButton?.addEventListener('click', () => void exportSearchesJson());
clearSearchesButton?.addEventListener('click', () => void clearSavedSearches());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY]) return;
  void refreshSavedSearchesView();
});

void refreshSavedSearchesView();
