export {};

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

function appendCount(container: HTMLElement, label: string, value: number): void {
  const item = document.createElement('span');
  item.append(document.createTextNode(label));
  const valueEl = document.createElement('strong');
  valueEl.textContent = value.toLocaleString();
  item.append(valueEl);
  container.append(item);
}

function renderSavedSearches(searches: SavedSearchCapture[]): void {
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
      row.append(position, content);
      results.append(row);
    }

    details.append(summary, results);
    article.append(title, date, countGrid, details);
    savedSearchesList.append(article);
  }
}

async function refreshSavedSearchesView(): Promise<SavedSearchCapture[]> {
  const searches = await getSavedSearches();
  renderSavedSearches(searches);
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
  const searches = await getSavedSearches();
  if (searches.length === 0) return;

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
  ];

  const rows: string[] = [];
  for (const search of searches) {
    for (const result of search.results) {
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
      ].map(csvValue).join(','));
    }
  }

  const csv = `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}\r\n`;
  downloadText(`kdp-scout-searches-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
}

async function exportSearchesJson(): Promise<void> {
  const searches = await getSavedSearches();
  if (searches.length === 0) return;

  downloadText(
    `kdp-scout-searches-${localDateKey(new Date())}.json`,
    JSON.stringify(searches, null, 2),
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
  renderSavedSearches([]);
}

savedSearchesTab?.addEventListener('click', showSavedSearchesView);
captureTab?.addEventListener('click', hideSavedSearchesView);
observationsTab?.addEventListener('click', hideSavedSearchesView);
exportSearchesCsvButton?.addEventListener('click', () => void exportSearchesCsv());
exportSearchesJsonButton?.addEventListener('click', () => void exportSearchesJson());
clearSearchesButton?.addEventListener('click', () => void clearSavedSearches());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[SEARCH_STORAGE_KEY]) return;
  void refreshSavedSearchesView();
});

void refreshSavedSearchesView();
