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

interface BsrHistoryStats {
  count: number;
  spanDays: number;
  firstBsr: number;
  latestBsr: number;
  medianBsr: number;
  bestBsr: number;
  worstBsr: number;
}

interface MarketHistorySummary {
  organicDirect: number;
  withHistory: number;
  multiPoint: number;
  ninetyDayCoverage: number;
  currentWinners: number;
  winnersWithNinetyDays: number;
}

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const DAY_MS = 24 * 60 * 60 * 1000;
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle];
  if (current === undefined) return undefined;
  if (sorted.length % 2 === 1) return current;
  const previous = sorted[middle - 1];
  return previous === undefined ? undefined : (previous + current) / 2;
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

function bsrHistoryByAsin(observations: BookObservation[]): Map<string, BookObservation[]> {
  const grouped = new Map<string, BookObservation[]>();

  for (const observation of observations) {
    if (!observation.asin || observation.booksBsr === undefined) continue;
    const existing = grouped.get(observation.asin) ?? [];
    existing.push(observation);
    grouped.set(observation.asin, existing);
  }

  for (const history of grouped.values()) {
    history.sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  }

  return grouped;
}

function uniqueOrganicDirectResults(search: SavedSearchCapture): SavedSearchResult[] {
  const unique = new Map<string, SavedSearchResult>();

  for (const result of search.results) {
    if (result.relevance !== 'Direct') continue;
    const existing = unique.get(result.asin);

    if (!existing) {
      unique.set(result.asin, { ...result });
      continue;
    }

    // If the same ASIN appears both sponsored and organic, count it as organic.
    existing.sponsored = existing.sponsored && result.sponsored;
    if (result.position < existing.position) existing.position = result.position;
  }

  return [...unique.values()]
    .filter((result) => !result.sponsored)
    .sort((left, right) => left.position - right.position);
}

function statsFor(history: BookObservation[] | undefined): BsrHistoryStats | undefined {
  if (!history || history.length === 0) return undefined;

  const first = history[0];
  const latest = history[history.length - 1];
  if (!first || !latest || first.booksBsr === undefined || latest.booksBsr === undefined) return undefined;

  const values = history
    .map((observation) => observation.booksBsr)
    .filter((value): value is number => value !== undefined);
  const medianBsr = median(values);
  if (values.length === 0 || medianBsr === undefined) return undefined;

  const firstTime = Date.parse(first.observedAt);
  const latestTime = Date.parse(latest.observedAt);
  const spanDays = Number.isFinite(firstTime) && Number.isFinite(latestTime)
    ? Math.max(0, Math.floor((latestTime - firstTime) / DAY_MS))
    : 0;

  return {
    count: values.length,
    spanDays,
    firstBsr: first.booksBsr,
    latestBsr: latest.booksBsr,
    medianBsr,
    bestBsr: Math.min(...values),
    worstBsr: Math.max(...values),
  };
}

function calculateMarketHistory(
  search: SavedSearchCapture,
  histories: Map<string, BookObservation[]>,
  latestObservations: Map<string, BookObservation>,
): MarketHistorySummary {
  const organicDirect = uniqueOrganicDirectResults(search);
  let withHistory = 0;
  let multiPoint = 0;
  let ninetyDayCoverage = 0;
  let currentWinners = 0;
  let winnersWithNinetyDays = 0;

  for (const result of organicDirect) {
    const stats = statsFor(histories.get(result.asin));
    if (stats) {
      withHistory += 1;
      if (stats.count >= 2) multiPoint += 1;
      if (stats.spanDays >= 90) ninetyDayCoverage += 1;
    }

    const currentBsr = latestObservations.get(result.asin)?.booksBsr;
    if (currentBsr !== undefined && currentBsr <= 35_000) {
      currentWinners += 1;
      if (stats && stats.spanDays >= 90) winnersWithNinetyDays += 1;
    }
  }

  return {
    organicDirect: organicDirect.length,
    withHistory,
    multiPoint,
    ninetyDayCoverage,
    currentWinners,
    winnersWithNinetyDays,
  };
}

function historyMetric(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'bsr-history-metric';

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;

  item.append(labelEl, valueEl);
  return item;
}

function historyStatus(summary: MarketHistorySummary): string {
  if (summary.currentWinners === 0) {
    return '90-day BSR stability: unverified. No current organic winners have enough evidence to assess sustained performance yet.';
  }

  if (summary.winnersWithNinetyDays < summary.currentWinners) {
    return `90-day BSR stability: unverified. ${summary.winnersWithNinetyDays.toLocaleString()}/${summary.currentWinners.toLocaleString()} current organic winners have at least 90 days between captured BSR observations.`;
  }

  return `90-day history window available for all ${summary.currentWinners.toLocaleString()} current organic winners. Review the individual histories for consistency, seasonality, spikes, or decline before treating performance as sustained.`;
}

function renderMarketHistoryPanel(
  article: HTMLElement,
  summary: MarketHistorySummary,
): void {
  article.querySelector('.bsr-history-summary')?.remove();

  const panel = document.createElement('section');
  panel.className = 'bsr-history-summary';

  const heading = document.createElement('p');
  heading.className = 'bsr-history-heading';
  heading.textContent = 'BSR history · organic Direct ASINs';

  const grid = document.createElement('div');
  grid.className = 'bsr-history-grid';
  grid.append(
    historyMetric('Any BSR history', `${summary.withHistory}/${summary.organicDirect}`),
    historyMetric('2+ observations', `${summary.multiPoint}/${summary.organicDirect}`),
    historyMetric('90+ day span', `${summary.ninetyDayCoverage}/${summary.organicDirect}`),
    historyMetric('Current winners', summary.currentWinners.toLocaleString()),
    historyMetric('Winners with 90d', `${summary.winnersWithNinetyDays}/${summary.currentWinners || 0}`),
  );

  const status = document.createElement('p');
  status.className = 'bsr-history-status';
  status.textContent = historyStatus(summary);

  const note = document.createElement('p');
  note.className = 'bsr-history-note';
  note.textContent = 'Lower BSR is better. This panel summarizes observations captured by KDP Scout; it does not substitute for a credible historical-ranking source when deeper history is available.';

  panel.append(heading, grid, status, note);

  const readiness = article.querySelector('.readiness-guidance');
  const details = article.querySelector('.saved-search-details');
  if (readiness) article.insertBefore(panel, readiness);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

function percentMovement(firstBsr: number, latestBsr: number): string {
  if (firstBsr <= 0 || firstBsr === latestBsr) return 'unchanged';
  const percent = Math.abs(((latestBsr - firstBsr) / firstBsr) * 100);
  const direction = latestBsr < firstBsr ? 'better' : 'worse';
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}% ${direction}`;
}

function asinFromResultRow(row: HTMLElement): string | undefined {
  const link = row.querySelector<HTMLAnchorElement>('.saved-search-result-title');
  if (!link) return undefined;
  const match = link.href.match(/\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i);
  return match?.[1]?.toUpperCase();
}

function renderResultHistory(article: HTMLElement, histories: Map<string, BookObservation[]>): void {
  const rows = article.querySelectorAll<HTMLElement>('.saved-search-result');

  for (const row of rows) {
    row.querySelector('.bsr-history-result')?.remove();
    const asin = asinFromResultRow(row);
    if (!asin) continue;
    const stats = statsFor(histories.get(asin));
    if (!stats) continue;

    const content = row.children[1];
    if (!(content instanceof HTMLElement)) continue;

    const line = document.createElement('p');
    line.className = 'saved-search-result-meta bsr-history-result';

    if (stats.count === 1) {
      line.textContent = `BSR history: 1 observation · #${stats.latestBsr.toLocaleString()} · 0-day span`;
    } else {
      line.textContent = [
        `BSR history: ${stats.count.toLocaleString()} observations`,
        `${stats.spanDays.toLocaleString()}-day span`,
        `median #${Math.round(stats.medianBsr).toLocaleString()}`,
        `range #${stats.bestBsr.toLocaleString()}–#${stats.worstBsr.toLocaleString()}`,
        `first #${stats.firstBsr.toLocaleString()} → latest #${stats.latestBsr.toLocaleString()} (${percentMovement(stats.firstBsr, stats.latestBsr)})`,
      ].join(' · ');
    }

    content.append(line);
  }
}

async function getData(): Promise<{
  searches: SavedSearchCapture[];
  histories: Map<string, BookObservation[]>;
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
    histories: bsrHistoryByAsin(observations),
    latestObservations: latestObservationByAsin(observations),
  };
}

async function renderBsrHistory(): Promise<void> {
  if (!savedSearchesList) return;

  const { searches, histories, latestObservations } = await getData();
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderMarketHistoryPanel(article, calculateMarketHistory(search, histories, latestObservations));
    renderResultHistory(article, histories);
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderBsrHistory());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY]) return;
  void renderBsrHistory();
});

void renderBsrHistory();
