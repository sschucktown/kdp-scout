export {};

import type { BookObservation } from '../models/book.js';

type RelevanceClassification = 'Direct' | 'Adjacent' | 'Irrelevant';
type AuthorityStatus = 'True authority' | 'Ordinary incumbent' | 'Unclear';

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

interface AuthorityReview {
  query: string;
  asin: string;
  status: AuthorityStatus;
  note?: string;
  updatedAt: string;
}

type AuthorityReviewMap = Record<string, AuthorityReview>;

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const AUTHORITY_STORAGE_KEY = 'authorityReviews';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function authorityKey(query: string, asin: string): string {
  return `${normalizeQuery(query)}::${asin.toUpperCase()}`;
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

function uniqueOrganicDirectResults(search: SavedSearchCapture): SavedSearchResult[] {
  const unique = new Map<string, SavedSearchResult>();

  for (const result of search.results) {
    if (result.relevance !== 'Direct') continue;
    const existing = unique.get(result.asin);

    if (!existing) {
      unique.set(result.asin, { ...result });
      continue;
    }

    existing.sponsored = existing.sponsored && result.sponsored;
    if (result.position < existing.position) existing.position = result.position;
    if (existing.ratingCount === undefined && result.ratingCount !== undefined) {
      existing.ratingCount = result.ratingCount;
    }
  }

  return [...unique.values()]
    .filter((result) => !result.sponsored)
    .sort((left, right) => left.position - right.position);
}

function ratingFor(result: SavedSearchResult, observation: BookObservation | undefined): number | undefined {
  return observation?.ratingCount ?? result.ratingCount;
}

function candidatesFor(
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): SavedSearchResult[] {
  return uniqueOrganicDirectResults(search).filter((result) => {
    const ratings = ratingFor(result, latestObservations.get(result.asin));
    return ratings !== undefined && ratings >= 500;
  });
}

async function getAuthorityReviews(): Promise<AuthorityReviewMap> {
  const stored = await chrome.storage.local.get(AUTHORITY_STORAGE_KEY);
  const value = stored[AUTHORITY_STORAGE_KEY];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as AuthorityReviewMap)
    : {};
}

async function saveAuthorityReview(
  search: SavedSearchCapture,
  result: SavedSearchResult,
  status: AuthorityStatus,
  note: string,
): Promise<boolean> {
  const trimmedNote = note.trim();
  if (status === 'True authority' && trimmedNote.length === 0) return false;

  const reviews = await getAuthorityReviews();
  const key = authorityKey(search.query, result.asin);
  reviews[key] = {
    query: normalizeQuery(search.query),
    asin: result.asin,
    status,
    note: trimmedNote || undefined,
    updatedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [AUTHORITY_STORAGE_KEY]: reviews });
  return true;
}

function summaryMetric(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'authority-summary-metric';

  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;

  item.append(labelEl, valueEl);
  return item;
}

function renderCandidate(
  search: SavedSearchCapture,
  result: SavedSearchResult,
  observation: BookObservation | undefined,
  existing: AuthorityReview | undefined,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'authority-candidate';

  const title = document.createElement('a');
  title.className = 'authority-candidate-title';
  title.href = result.url;
  title.target = '_blank';
  title.rel = 'noreferrer';
  title.textContent = `#${result.position} ${result.title}`;

  const ratings = ratingFor(result, observation);
  const meta = document.createElement('p');
  meta.className = 'authority-candidate-meta';
  meta.textContent = [
    result.asin,
    ratings === undefined ? 'No rating count' : `${ratings.toLocaleString()} ratings`,
    observation?.publisher ? `Publisher: ${observation.publisher}` : 'Publisher not captured',
  ].join(' · ');

  const note = document.createElement('textarea');
  note.className = 'authority-note';
  note.rows = 2;
  note.value = existing?.note ?? '';
  note.placeholder = 'Evidence note: publisher, author, brand, audience, or category dominance';
  note.setAttribute('aria-label', `Authority evidence note for ${result.title}`);

  const controls = document.createElement('div');
  controls.className = 'authority-controls';

  const statusLine = document.createElement('p');
  statusLine.className = 'authority-status-line';
  statusLine.textContent = existing
    ? `${existing.status} · updated ${new Date(existing.updatedAt).toLocaleString()}`
    : 'Not reviewed';

  const statuses: AuthorityStatus[] = ['True authority', 'Ordinary incumbent', 'Unclear'];
  for (const status of statuses) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary authority-status-button';
    if (existing?.status === status) button.classList.add('selected');
    button.textContent = status;
    button.addEventListener('click', async () => {
      const saved = await saveAuthorityReview(search, result, status, note.value);
      if (!saved) {
        statusLine.textContent = 'Add an evidence note before marking True authority.';
        note.focus();
        return;
      }
      statusLine.textContent = `${status} · saved`;
    });
    controls.append(button);
  }

  note.addEventListener('change', async () => {
    if (!existing) return;
    const saved = await saveAuthorityReview(search, result, existing.status, note.value);
    if (!saved) {
      statusLine.textContent = 'True authority requires a non-empty evidence note.';
      return;
    }
    statusLine.textContent = `${existing.status} · note saved`;
  });

  card.append(title, meta, note, controls, statusLine);
  return card;
}

function renderPanel(
  article: HTMLElement,
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
  reviews: AuthorityReviewMap,
): void {
  article.querySelector('.authority-review')?.remove();

  const candidates = candidatesFor(search, latestObservations);
  let trueAuthorities = 0;
  let ordinaryIncumbents = 0;
  let unclear = 0;
  let unreviewed = 0;

  for (const result of candidates) {
    const review = reviews[authorityKey(search.query, result.asin)];
    if (!review) unreviewed += 1;
    else if (review.status === 'True authority') trueAuthorities += 1;
    else if (review.status === 'Ordinary incumbent') ordinaryIncumbents += 1;
    else unclear += 1;
  }

  const panel = document.createElement('section');
  panel.className = 'authority-review';

  const heading = document.createElement('p');
  heading.className = 'authority-review-heading';
  heading.textContent = 'Authority review · organic Direct candidates';

  const summary = document.createElement('div');
  summary.className = 'authority-summary-grid';
  summary.append(
    summaryMetric('500+ candidates', candidates.length.toLocaleString()),
    summaryMetric('True authority', trueAuthorities.toLocaleString()),
    summaryMetric('Ordinary', ordinaryIncumbents.toLocaleString()),
    summaryMetric('Unclear / unreviewed', (unclear + unreviewed).toLocaleString()),
  );

  const note = document.createElement('p');
  note.className = 'authority-review-note';
  note.textContent = 'Authority requires approximately 500+ reviews plus strong publisher, author, brand, audience, or category dominance. KDP Scout currently uses captured Amazon rating count as the 500+ screening proxy.';

  panel.append(heading, summary, note);

  if (candidates.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'authority-empty';
    empty.textContent = 'No organic Direct competitors currently meet the 500+ rating-count screening threshold.';
    panel.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'authority-candidate-list';
    for (const result of candidates) {
      const review = reviews[authorityKey(search.query, result.asin)];
      list.append(renderCandidate(search, result, latestObservations.get(result.asin), review));
    }
    panel.append(list);
  }

  const readiness = article.querySelector('.readiness-guidance');
  const details = article.querySelector('.saved-search-details');
  if (readiness) article.insertBefore(panel, readiness);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

async function getData(): Promise<{
  searches: SavedSearchCapture[];
  latestObservations: Map<string, BookObservation>;
  reviews: AuthorityReviewMap;
}> {
  const stored = await chrome.storage.local.get([
    SEARCH_STORAGE_KEY,
    BOOK_STORAGE_KEY,
    AUTHORITY_STORAGE_KEY,
  ]);

  const searches = Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? (stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[])
    : [];
  const observations = Array.isArray(stored[BOOK_STORAGE_KEY])
    ? (stored[BOOK_STORAGE_KEY] as BookObservation[])
    : [];
  const rawReviews = stored[AUTHORITY_STORAGE_KEY];
  const reviews = rawReviews && typeof rawReviews === 'object' && !Array.isArray(rawReviews)
    ? (rawReviews as AuthorityReviewMap)
    : {};

  return {
    searches,
    latestObservations: latestObservationByAsin(observations),
    reviews,
  };
}

async function renderAuthorityReviews(): Promise<void> {
  if (!savedSearchesList) return;

  const { searches, latestObservations, reviews } = await getData();
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderPanel(article, search, latestObservations, reviews);
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderAuthorityReviews());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (
    !changes[SEARCH_STORAGE_KEY]
    && !changes[BOOK_STORAGE_KEY]
    && !changes[AUTHORITY_STORAGE_KEY]
  ) return;
  void renderAuthorityReviews();
});

void renderAuthorityReviews();
