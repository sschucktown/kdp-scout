export {};

import type { BookObservation } from '../models/book.js';

type RelevanceClassification = 'Direct' | 'Adjacent' | 'Irrelevant';
type ReadinessKind = 'collect' | 'fail' | 'caution' | 'promising';

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

interface GateEvidence {
  gateDirect: number;
  uncaptured: number;
  needsBsrRetry: number;
  bsrComplete: number;
  winners35k: number;
  winnersUnder300: number;
  review500Plus: number;
  publicationKnown: number;
  recentWinnerProxy: number;
  kind: ReadinessKind;
  label: string;
  summary: string;
  nextAction: string;
}

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

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

function uniqueDirectResults(search: SavedSearchCapture): SavedSearchResult[] {
  const unique = new Map<string, SavedSearchResult>();

  for (const result of search.results) {
    if (result.relevance !== 'Direct') continue;
    const existing = unique.get(result.asin);

    if (!existing) {
      unique.set(result.asin, { ...result });
      continue;
    }

    // If an ASIN appears both sponsored and organic, treat it as organic for the gate.
    existing.sponsored = existing.sponsored && result.sponsored;
    if (existing.ratingCount === undefined && result.ratingCount !== undefined) {
      existing.ratingCount = result.ratingCount;
    }
    if (existing.displayPrice === undefined && result.displayPrice !== undefined) {
      existing.displayPrice = result.displayPrice;
    }
    if (result.position < existing.position) existing.position = result.position;
  }

  return [...unique.values()].sort((left, right) => left.position - right.position);
}

function ratingFor(result: SavedSearchResult, observation: BookObservation | undefined): number | undefined {
  return observation?.ratingCount ?? result.ratingCount;
}

function validPublicationDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function calculateGateEvidence(
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): GateEvidence {
  const gateResults = uniqueDirectResults(search).filter((result) => !result.sponsored);
  const capturedAt = new Date(search.capturedAt);
  const recentCutoff = new Date(capturedAt);
  recentCutoff.setMonth(recentCutoff.getMonth() - 18);

  let uncaptured = 0;
  let needsBsrRetry = 0;
  let winners35k = 0;
  let winnersUnder300 = 0;
  let review500Plus = 0;
  let publicationKnown = 0;
  let recentWinnerProxy = 0;

  for (const result of gateResults) {
    const observation = latestObservations.get(result.asin);
    if (!observation) uncaptured += 1;
    else if (observation.booksBsr === undefined) needsBsrRetry += 1;

    const ratings = ratingFor(result, observation);
    if (ratings !== undefined && ratings >= 500) review500Plus += 1;

    const bsr = observation?.booksBsr;
    if (bsr !== undefined && bsr <= 35_000) {
      winners35k += 1;
      if (ratings !== undefined && ratings < 300) winnersUnder300 += 1;
    }

    const publishedAt = validPublicationDate(observation?.publicationDate);
    if (publishedAt) {
      publicationKnown += 1;
      if (
        bsr !== undefined
        && bsr <= 35_000
        && publishedAt >= recentCutoff
        && publishedAt <= capturedAt
      ) {
        recentWinnerProxy += 1;
      }
    }
  }

  const incomplete = uncaptured + needsBsrRetry;
  const bsrComplete = gateResults.length - incomplete;

  if (gateResults.length < 8) {
    return {
      gateDirect: gateResults.length,
      uncaptured,
      needsBsrRetry,
      bsrComplete,
      winners35k,
      winnersUnder300,
      review500Plus,
      publicationKnown,
      recentWinnerProxy,
      kind: 'fail',
      label: 'Initial gate fails',
      summary: `Only ${gateResults.length.toLocaleString()} unique organic Direct competitors are present. The method generally looks for at least 8–10 directly relevant page-one results.`,
      nextAction: 'Recheck the organic page-one scope or narrow/change the search phrase before doing deeper production research.',
    };
  }

  if (incomplete > 0) {
    return {
      gateDirect: gateResults.length,
      uncaptured,
      needsBsrRetry,
      bsrComplete,
      winners35k,
      winnersUnder300,
      review500Plus,
      publicationKnown,
      recentWinnerProxy,
      kind: 'collect',
      label: 'Collect more data',
      summary: `${bsrComplete.toLocaleString()}/${gateResults.length.toLocaleString()} organic Direct competitors have Books BSR. Finish the incomplete records before applying the initial demand and competition gate.`,
      nextAction: `Finish the audit queue: ${uncaptured.toLocaleString()} uncaptured + ${needsBsrRetry.toLocaleString()} BSR retries remain in the organic gate set.`,
    };
  }

  if (winners35k < 3) {
    return {
      gateDirect: gateResults.length,
      uncaptured,
      needsBsrRetry,
      bsrComplete,
      winners35k,
      winnersUnder300,
      review500Plus,
      publicationKnown,
      recentWinnerProxy,
      kind: 'fail',
      label: 'Initial demand gate fails',
      summary: `The complete current snapshot has ${winners35k.toLocaleString()} organic Direct books at BSR ≤35,000; the method generally requires at least three independent winners.`,
      nextAction: 'Verify that the search phrase and page-one relevance are correct before rejecting or materially narrowing the market.',
    };
  }

  if (recentWinnerProxy < 2) {
    return {
      gateDirect: gateResults.length,
      uncaptured,
      needsBsrRetry,
      bsrComplete,
      winners35k,
      winnersUnder300,
      review500Plus,
      publicationKnown,
      recentWinnerProxy,
      kind: 'caution',
      label: 'Recent-entrant evidence weak',
      summary: `Demand clears the three-winner threshold, but only ${recentWinnerProxy.toLocaleString()} ${recentWinnerProxy === 1 ? 'recent winner proxy' : 'recent winner proxies'} currently meet both publication ≤18 months and BSR ≤35,000.`,
      nextAction: 'Manually assess recent entrant credibility before calling the initial gate passed, then verify 90-day BSR stability.',
    };
  }

  if (review500Plus >= 4) {
    return {
      gateDirect: gateResults.length,
      uncaptured,
      needsBsrRetry,
      bsrComplete,
      winners35k,
      winnersUnder300,
      review500Plus,
      publicationKnown,
      recentWinnerProxy,
      kind: 'caution',
      label: 'Competition needs review',
      summary: `${review500Plus.toLocaleString()} organic Direct competitors have 500+ reviews. That is only an authority-candidate proxy; publisher, author, brand, audience, and category dominance still require manual review.`,
      nextAction: 'Review those high-review competitors for true authority status, then verify 90-day BSR stability.',
    };
  }

  return {
    gateDirect: gateResults.length,
    uncaptured,
    needsBsrRetry,
    bsrComplete,
    winners35k,
    winnersUnder300,
    review500Plus,
    publicationKnown,
    recentWinnerProxy,
    kind: 'promising',
    label: 'Initial snapshot looks promising',
    summary: `The organic page-one snapshot clears the core demand threshold with ${winners35k.toLocaleString()} books at BSR ≤35,000 and ${recentWinnerProxy.toLocaleString()} recent winner proxies.`,
    nextAction: 'Next verify 90-day BSR stability, then study buyer reviews, define the product wedge, and validate economics before any final verdict.',
  };
}

function evidenceItem(label: string, value: string, note?: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'readiness-evidence-item';

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

function renderPanel(article: HTMLElement, evidence: GateEvidence): void {
  article.querySelector('.readiness-guidance')?.remove();

  const panel = document.createElement('section');
  panel.className = `readiness-guidance readiness-${evidence.kind}`;

  const headingRow = document.createElement('div');
  headingRow.className = 'readiness-heading-row';

  const heading = document.createElement('p');
  heading.className = 'readiness-heading';
  heading.textContent = 'Readiness guidance';

  const badge = document.createElement('span');
  badge.className = 'readiness-badge';
  badge.textContent = evidence.label;

  headingRow.append(heading, badge);

  const summary = document.createElement('p');
  summary.className = 'readiness-summary';
  summary.textContent = evidence.summary;

  const grid = document.createElement('div');
  grid.className = 'readiness-evidence-grid';
  grid.append(
    evidenceItem('Organic Direct', evidence.gateDirect.toLocaleString(), 'Sponsored-only excluded · target generally 8–10+'),
    evidenceItem('BSR complete', `${evidence.bsrComplete}/${evidence.gateDirect}`),
    evidenceItem('BSR ≤35k', evidence.winners35k.toLocaleString(), 'Target: at least 3'),
    evidenceItem('Winning <300 reviews', `${evidence.winnersUnder300}/${evidence.winners35k || 0}`, 'Preferred, not a hard rule'),
    evidenceItem('500+ review candidates', evidence.review500Plus.toLocaleString(), 'Authority status unverified'),
    evidenceItem('Recent winner proxy', evidence.recentWinnerProxy.toLocaleString(), '≤18 mo + BSR ≤35k'),
  );

  const next = document.createElement('p');
  next.className = 'readiness-next';
  const nextLabel = document.createElement('strong');
  nextLabel.textContent = 'Next: ';
  next.append(nextLabel, document.createTextNode(evidence.nextAction));

  const caveat = document.createElement('p');
  caveat.className = 'readiness-caveat';
  caveat.textContent = 'Not a final Pursue / Watch / Reject verdict. 90-day BSR stability, true authority strength, review-derived buyer need, wedge, economics, production burden, and catalog expansion are not fully validated here.';

  panel.append(headingRow, summary, grid, next, caveat);

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

  return { searches, latestObservations: latestObservationByAsin(observations) };
}

async function renderReadinessGuidance(): Promise<void> {
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
    renderPanel(article, calculateGateEvidence(search, latestObservations));
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderReadinessGuidance());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY]) return;
  void renderReadinessGuidance();
});

void renderReadinessGuidance();
