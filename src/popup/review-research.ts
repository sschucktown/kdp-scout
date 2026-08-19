export {};

import type { BookObservation } from '../models/book.js';
import type { CapturedReview } from '../models/review.js';

type RelevanceClassification = 'Direct' | 'Adjacent' | 'Irrelevant';
type ReviewEvidenceKind =
  | 'Repeated complaint'
  | 'Missing topic'
  | 'Accuracy concern'
  | 'Poor organization'
  | 'Weak illustrations'
  | 'Small print'
  | 'Insufficient examples'
  | 'Unrealistic plan'
  | 'Difficult navigation'
  | 'Outdated information'
  | 'Buyer language'
  | 'Desired outcome'
  | 'Recommendation reason'
  | 'Abandonment reason'
  | 'Other';

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

interface ReviewScreen {
  query: string;
  asin: string;
  reviewsAnalyzed: number;
  updatedAt: string;
}

interface ReviewEvidence {
  id: string;
  query: string;
  asin: string;
  kind: ReviewEvidenceKind;
  theme: string;
  detail?: string;
  mentions: number;
  createdAt: string;
  updatedAt: string;
}

interface ReviewResearchStore {
  screens: Record<string, ReviewScreen>;
  evidence: ReviewEvidence[];
}

interface ThemeSummary {
  theme: string;
  books: Set<string>;
  mentions: number;
  kinds: Set<ReviewEvidenceKind>;
}

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const REVIEW_STORAGE_KEY = 'reviewResearch';
const CAPTURED_REVIEW_STORAGE_KEY = 'capturedReviews';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

const EVIDENCE_KINDS: ReviewEvidenceKind[] = [
  'Repeated complaint',
  'Missing topic',
  'Accuracy concern',
  'Poor organization',
  'Weak illustrations',
  'Small print',
  'Insufficient examples',
  'Unrealistic plan',
  'Difficult navigation',
  'Outdated information',
  'Buyer language',
  'Desired outcome',
  'Recommendation reason',
  'Abandonment reason',
  'Other',
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeTheme(theme: string): string {
  return theme.trim().toLowerCase().replace(/\s+/g, ' ');
}

function researchKey(query: string, asin: string): string {
  return `${normalizeQuery(query)}::${asin.toUpperCase()}`;
}

function emptyStore(): ReviewResearchStore {
  return { screens: {}, evidence: [] };
}

function parseStore(value: unknown): ReviewResearchStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyStore();
  const candidate = value as Partial<ReviewResearchStore>;
  return {
    screens: candidate.screens && typeof candidate.screens === 'object' && !Array.isArray(candidate.screens)
      ? candidate.screens as Record<string, ReviewScreen>
      : {},
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence as ReviewEvidence[] : [],
  };
}

async function getStore(): Promise<ReviewResearchStore> {
  const stored = await chrome.storage.local.get(REVIEW_STORAGE_KEY);
  return parseStore(stored[REVIEW_STORAGE_KEY]);
}

async function writeStore(store: ReviewResearchStore): Promise<void> {
  await chrome.storage.local.set({ [REVIEW_STORAGE_KEY]: store });
}

function latestObservationByAsin(observations: BookObservation[]): Map<string, BookObservation> {
  const latest = new Map<string, BookObservation>();
  for (const observation of observations) {
    if (!observation.asin) continue;
    const existing = latest.get(observation.asin);
    if (!existing || observation.observedAt > existing.observedAt) latest.set(observation.asin, observation);
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
    if (existing.ratingCount === undefined && result.ratingCount !== undefined) existing.ratingCount = result.ratingCount;
  }
  return [...unique.values()].filter((result) => !result.sponsored);
}

function reviewTargets(
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): SavedSearchResult[] {
  return uniqueOrganicDirectResults(search).sort((left, right) => {
    const leftBsr = latestObservations.get(left.asin)?.booksBsr;
    const rightBsr = latestObservations.get(right.asin)?.booksBsr;
    const leftWinner = leftBsr !== undefined && leftBsr <= 35_000;
    const rightWinner = rightBsr !== undefined && rightBsr <= 35_000;
    if (leftWinner !== rightWinner) return leftWinner ? -1 : 1;
    if (leftBsr !== undefined && rightBsr !== undefined && leftBsr !== rightBsr) return leftBsr - rightBsr;
    if (leftBsr !== undefined && rightBsr === undefined) return -1;
    if (leftBsr === undefined && rightBsr !== undefined) return 1;
    return left.position - right.position;
  });
}

function screenFor(store: ReviewResearchStore, query: string, asin: string): ReviewScreen | undefined {
  return store.screens[researchKey(query, asin)];
}

function evidenceFor(store: ReviewResearchStore, query: string, asin?: string): ReviewEvidence[] {
  const normalized = normalizeQuery(query);
  return store.evidence.filter((entry) =>
    entry.query === normalized && (asin === undefined || entry.asin === asin.toUpperCase()));
}

function capturedReviewKey(review: CapturedReview): string {
  return review.reviewId
    ? `${review.asin.toUpperCase()}::amazon::${review.reviewId.toUpperCase()}`
    : `${review.asin.toUpperCase()}::content::${review.body.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function capturedCountForAsin(reviews: CapturedReview[], asin: string): number {
  return new Set(
    reviews
      .filter((review) => review.asin.toUpperCase() === asin.toUpperCase())
      .map(capturedReviewKey),
  ).size;
}

function capturedProgress(reviews: CapturedReview[], targets: SavedSearchResult[]): { total: number; covered: number } {
  const targetAsins = new Set(targets.map((target) => target.asin.toUpperCase()));
  const keys = new Set<string>();
  const coveredAsins = new Set<string>();
  for (const review of reviews) {
    const asin = review.asin.toUpperCase();
    if (!targetAsins.has(asin)) continue;
    keys.add(capturedReviewKey(review));
    coveredAsins.add(asin);
  }
  return { total: keys.size, covered: coveredAsins.size };
}

function recurringThemes(store: ReviewResearchStore, query: string): ThemeSummary[] {
  const summaries = new Map<string, ThemeSummary>();
  for (const entry of evidenceFor(store, query)) {
    const key = normalizeTheme(entry.theme);
    if (!key) continue;
    const existing = summaries.get(key) ?? {
      theme: entry.theme.trim(),
      books: new Set<string>(),
      mentions: 0,
      kinds: new Set<ReviewEvidenceKind>(),
    };
    existing.books.add(entry.asin);
    existing.mentions += entry.mentions;
    existing.kinds.add(entry.kind);
    summaries.set(key, existing);
  }
  return [...summaries.values()]
    .filter((summary) => summary.books.size >= 2)
    .sort((left, right) => right.books.size - left.books.size || right.mentions - left.mentions || left.theme.localeCompare(right.theme));
}

function summaryMetric(label: string, value: string, note?: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'review-summary-metric';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  if (note) {
    const noteEl = document.createElement('small');
    noteEl.textContent = note;
    item.append(noteEl);
  }
  return item;
}

function option(value: string, label = value): HTMLOptionElement {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
}

function targetLabel(result: SavedSearchResult, observation: BookObservation | undefined): string {
  const bsr = observation?.booksBsr === undefined ? 'no BSR' : `#${observation.booksBsr.toLocaleString()}`;
  return `#${result.position} · ${bsr} · ${result.title}`;
}

function reviewsUrl(result: SavedSearchResult): string {
  return `https://www.amazon.com/product-reviews/${encodeURIComponent(result.asin.toUpperCase())}`;
}

async function saveScreen(query: string, asin: string, reviewsAnalyzed: number): Promise<void> {
  const store = await getStore();
  const key = researchKey(query, asin);
  store.screens[key] = {
    query: normalizeQuery(query),
    asin: asin.toUpperCase(),
    reviewsAnalyzed,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
}

async function addEvidence(
  query: string,
  asin: string,
  kind: ReviewEvidenceKind,
  theme: string,
  detail: string,
  mentions: number,
): Promise<boolean> {
  const trimmedTheme = theme.trim();
  if (!trimmedTheme) return false;
  const now = new Date().toISOString();
  const store = await getStore();
  store.evidence.push({
    id: crypto.randomUUID(),
    query: normalizeQuery(query),
    asin: asin.toUpperCase(),
    kind,
    theme: trimmedTheme,
    detail: detail.trim() || undefined,
    mentions,
    createdAt: now,
    updatedAt: now,
  });
  await writeStore(store);
  return true;
}

async function deleteEvidence(id: string): Promise<void> {
  const store = await getStore();
  store.evidence = store.evidence.filter((entry) => entry.id !== id);
  await writeStore(store);
}

function renderRecurringThemes(panel: HTMLElement, store: ReviewResearchStore, query: string): void {
  const themes = recurringThemes(store, query);
  const section = document.createElement('div');
  section.className = 'review-recurring';
  const heading = document.createElement('p');
  heading.className = 'review-subheading';
  heading.textContent = 'Repeated across competitors';
  section.append(heading);

  if (themes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'review-research-note';
    empty.textContent = 'No theme has evidence from two or more competitors yet. Reuse the same short theme label when the same issue or desire appears in another book.';
    section.append(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'review-theme-list';
    for (const theme of themes.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'review-theme-row';
      const name = document.createElement('strong');
      name.textContent = theme.theme;
      const meta = document.createElement('span');
      meta.textContent = `${theme.books.size} books · ${theme.mentions.toLocaleString()} mention${theme.mentions === 1 ? '' : 's'} · ${[...theme.kinds].join(', ')}`;
      row.append(name, meta);
      list.append(row);
    }
    section.append(list);
  }

  panel.append(section);
}

function renderTargetEvidence(
  container: HTMLElement,
  query: string,
  asin: string,
  store: ReviewResearchStore,
): void {
  container.replaceChildren();
  const entries = evidenceFor(store, query, asin).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (entries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'review-research-note';
    empty.textContent = 'No structured review evidence saved for this competitor yet.';
    container.append(empty);
    return;
  }

  for (const entry of entries.slice(0, 12)) {
    const row = document.createElement('div');
    row.className = 'review-evidence-row';
    const body = document.createElement('div');
    const theme = document.createElement('strong');
    theme.textContent = entry.theme;
    const meta = document.createElement('span');
    meta.textContent = `${entry.kind} · ${entry.mentions.toLocaleString()} mention${entry.mentions === 1 ? '' : 's'}`;
    body.append(theme, meta);
    if (entry.detail) {
      const detail = document.createElement('p');
      detail.textContent = entry.detail;
      body.append(detail);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary review-delete';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void deleteEvidence(entry.id));
    row.append(body, remove);
    container.append(row);
  }
}

function renderPanel(
  article: HTMLElement,
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
  store: ReviewResearchStore,
  capturedReviews: CapturedReview[],
): void {
  article.querySelector('.review-research')?.remove();
  const targets = reviewTargets(search, latestObservations);
  const progress = capturedProgress(capturedReviews, targets);
  const repeated = recurringThemes(store, search.query).length;

  const panel = document.createElement('section');
  panel.className = 'review-research';

  const heading = document.createElement('p');
  heading.className = 'review-research-heading';
  heading.textContent = 'Buyer review evidence · product design';

  const summary = document.createElement('div');
  summary.className = 'review-summary-grid';
  summary.append(
    summaryMetric('Reviews captured', progress.total.toLocaleString(), progress.total >= 50 ? 'Production range: 50–100' : progress.total >= 30 ? 'Initial capture target reached' : 'Initial target: 30'),
    summaryMetric('Competitors covered', `${progress.covered}/${targets.length}`),
    summaryMetric('Repeated themes', repeated.toLocaleString(), 'Evidence in 2+ books'),
  );

  const note = document.createElement('p');
  note.className = 'review-research-note';
  note.textContent = 'Captured reviews are the source corpus; they have not been labeled relevant or analyzed. After review, the method targets about 30 relevant reviews for an initial screen and 50–100 before greenlighting production.';
  panel.append(heading, summary, note);

  if (targets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'review-research-note';
    empty.textContent = 'No organic Direct competitors are available for review research in this saved search.';
    panel.append(empty);
  } else {
    const form = document.createElement('div');
    form.className = 'review-research-form';

    const targetSelect = document.createElement('select');
    targetSelect.className = 'review-target-select';
    targetSelect.setAttribute('aria-label', 'Competitor for buyer review research');
    for (const target of targets) {
      targetSelect.append(option(target.asin, targetLabel(target, latestObservations.get(target.asin))));
    }

    const openReviews = document.createElement('a');
    openReviews.className = 'secondary review-open-link';
    openReviews.target = '_blank';
    openReviews.rel = 'noreferrer';
    openReviews.textContent = 'Open customer reviews';

    const capturedLine = document.createElement('p');
    capturedLine.className = 'review-captured-line';

    const kindSelect = document.createElement('select');
    kindSelect.className = 'review-kind-select';
    kindSelect.setAttribute('aria-label', 'Review evidence type');
    for (const kind of EVIDENCE_KINDS) kindSelect.append(option(kind));

    const themeInput = document.createElement('input');
    themeInput.type = 'text';
    themeInput.className = 'review-theme-input';
    themeInput.placeholder = 'Short reusable theme, e.g. print too small';
    themeInput.setAttribute('aria-label', 'Review evidence theme');

    const datalist = document.createElement('datalist');
    const datalistId = `review-themes-${search.id}`;
    datalist.id = datalistId;
    const existingThemes = [...new Set(evidenceFor(store, search.query).map((entry) => entry.theme))].sort();
    for (const theme of existingThemes) datalist.append(option(theme));
    themeInput.setAttribute('list', datalistId);

    const mentionsInput = document.createElement('input');
    mentionsInput.type = 'number';
    mentionsInput.min = '1';
    mentionsInput.step = '1';
    mentionsInput.value = '1';
    mentionsInput.className = 'review-mentions-input';
    mentionsInput.setAttribute('aria-label', 'Number of review mentions represented');

    const detailInput = document.createElement('textarea');
    detailInput.className = 'review-detail-input';
    detailInput.rows = 2;
    detailInput.placeholder = 'Optional paraphrase/context. Avoid copying long review text.';
    detailInput.setAttribute('aria-label', 'Review evidence detail');

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'secondary review-add';
    addButton.textContent = 'Add evidence';

    const status = document.createElement('p');
    status.className = 'review-status-line';

    const evidenceList = document.createElement('div');
    evidenceList.className = 'review-evidence-list';

    const syncTarget = async (): Promise<void> => {
      const asin = targetSelect.value;
      const target = targets.find((item) => item.asin === asin) ?? targets[0];
      if (!target) return;
      openReviews.href = reviewsUrl(target);
      const freshStore = await getStore();
      capturedLine.textContent = `Captured reviews for this ASIN: ${capturedCountForAsin(capturedReviews, asin).toLocaleString()}`;
      renderTargetEvidence(evidenceList, search.query, asin, freshStore);
    };

    targetSelect.addEventListener('change', () => void syncTarget());

    addButton.addEventListener('click', async () => {
      const mentionsParsed = Number.parseInt(mentionsInput.value, 10);
      const mentions = Number.isFinite(mentionsParsed) && mentionsParsed >= 1 ? mentionsParsed : 1;
      const saved = await addEvidence(
        search.query,
        targetSelect.value,
        kindSelect.value as ReviewEvidenceKind,
        themeInput.value,
        detailInput.value,
        mentions,
      );
      if (!saved) {
        status.textContent = 'Add a short theme before saving evidence.';
        themeInput.focus();
        return;
      }
      themeInput.value = '';
      detailInput.value = '';
      mentionsInput.value = '1';
      status.textContent = 'Review evidence saved.';
    });

    form.append(targetSelect, openReviews, capturedLine, kindSelect, themeInput, datalist, mentionsInput, detailInput, addButton, status, evidenceList);
    panel.append(form);
    void syncTarget();
  }

  renderRecurringThemes(panel, store, search.query);

  const readiness = article.querySelector('.readiness-guidance');
  const details = article.querySelector('.saved-search-details');
  if (readiness) article.insertBefore(panel, readiness);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

async function getData(): Promise<{
  searches: SavedSearchCapture[];
  latestObservations: Map<string, BookObservation>;
  store: ReviewResearchStore;
  capturedReviews: CapturedReview[];
}> {
  const stored = await chrome.storage.local.get([SEARCH_STORAGE_KEY, BOOK_STORAGE_KEY, REVIEW_STORAGE_KEY, CAPTURED_REVIEW_STORAGE_KEY]);
  const searches = Array.isArray(stored[SEARCH_STORAGE_KEY]) ? stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[] : [];
  const observations = Array.isArray(stored[BOOK_STORAGE_KEY]) ? stored[BOOK_STORAGE_KEY] as BookObservation[] : [];
  return {
    searches,
    latestObservations: latestObservationByAsin(observations),
    store: parseStore(stored[REVIEW_STORAGE_KEY]),
    capturedReviews: Array.isArray(stored[CAPTURED_REVIEW_STORAGE_KEY])
      ? stored[CAPTURED_REVIEW_STORAGE_KEY] as CapturedReview[]
      : [],
  };
}

async function renderReviewResearch(): Promise<void> {
  if (!savedSearchesList) return;
  const { searches, latestObservations, store, capturedReviews } = await getData();
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderPanel(article, search, latestObservations, store, capturedReviews);
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderReviewResearch());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY] && !changes[REVIEW_STORAGE_KEY] && !changes[CAPTURED_REVIEW_STORAGE_KEY]) return;
  void renderReviewResearch();
});

void renderReviewResearch();
