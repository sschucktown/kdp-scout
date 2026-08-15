import type { BookDraft, BookObservation } from '../models/book.js';

const STORAGE_KEY = 'bookObservations';

const statusEl = document.querySelector<HTMLParagraphElement>('#status');
const cardEl = document.querySelector<HTMLElement>('#book-card');
const saveButton = document.querySelector<HTMLButtonElement>('#save');
const refreshButton = document.querySelector<HTMLButtonElement>('#refresh');
const diagnosticsButton = document.querySelector<HTMLButtonElement>('#diagnostics');
const diagnosticsPanel = document.querySelector<HTMLElement>('#diagnostics-panel');
const diagnosticsOutput = document.querySelector<HTMLTextAreaElement>('#diagnostics-output');
const captureTab = document.querySelector<HTMLButtonElement>('#capture-tab');
const observationsTab = document.querySelector<HTMLButtonElement>('#observations-tab');
const captureView = document.querySelector<HTMLElement>('#capture-view');
const observationsView = document.querySelector<HTMLElement>('#observations-view');
const observationCount = document.querySelector<HTMLElement>('#observation-count');
const observationsList = document.querySelector<HTMLElement>('#observations-list');
const observationsEmpty = document.querySelector<HTMLParagraphElement>('#observations-empty');
const exportCsvButton = document.querySelector<HTMLButtonElement>('#export-csv');
const exportJsonButton = document.querySelector<HTMLButtonElement>('#export-json');
const clearObservationsButton = document.querySelector<HTMLButtonElement>('#clear-observations');

let currentBook: BookDraft | null = null;

function setText(selector: string, value: string | number | undefined): void {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value === undefined || value === '' ? '—' : String(value);
}

function setStatus(message: string, kind: 'normal' | 'error' | 'success' = 'normal'): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('error', kind === 'error');
  statusEl.classList.toggle('success', kind === 'success');
}

function renderBook(book: BookDraft): void {
  setText('#title', book.title);
  setText('#asin', book.asin);
  setText('#price', book.displayPrice);
  setText('#ratings', book.ratingCount?.toLocaleString());
  setText('#bsr', book.booksBsr ? `#${book.booksBsr.toLocaleString()}` : undefined);
  setText('#publisher', book.publisher);
  setText('#publication-date', book.publicationDate);
  setText('#pages', book.pageCount?.toLocaleString());

  if (cardEl) cardEl.hidden = false;
  if (saveButton) saveButton.disabled = !book.asin || !book.title;
}

async function getObservations(): Promise<BookObservation[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY])
    ? (stored[STORAGE_KEY] as BookObservation[])
    : [];
}

function updateObservationCount(observations: BookObservation[]): void {
  if (observationCount) observationCount.textContent = observations.length.toLocaleString();
}

function addObservationMeta(container: HTMLElement, label: string, value: string): void {
  const item = document.createElement('span');
  const labelEl = document.createElement('strong');
  labelEl.textContent = `${label}: `;
  item.append(labelEl, document.createTextNode(value));
  container.append(item);
}

function renderObservations(observations: BookObservation[]): void {
  updateObservationCount(observations);

  if (observationsList) observationsList.replaceChildren();
  if (observationsEmpty) observationsEmpty.hidden = observations.length > 0;
  if (exportCsvButton) exportCsvButton.disabled = observations.length === 0;
  if (exportJsonButton) exportJsonButton.disabled = observations.length === 0;
  if (clearObservationsButton) clearObservationsButton.disabled = observations.length === 0;

  if (!observationsList) return;

  const sorted = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  for (const observation of sorted) {
    const article = document.createElement('article');
    article.className = 'observation-item';

    const title = document.createElement('p');
    title.className = 'observation-title';
    title.textContent = observation.title ?? observation.asin ?? 'Untitled book';

    const meta = document.createElement('p');
    meta.className = 'observation-meta';
    addObservationMeta(meta, 'ASIN', observation.asin ?? '—');
    addObservationMeta(meta, 'BSR', observation.booksBsr ? `#${observation.booksBsr.toLocaleString()}` : '—');
    addObservationMeta(meta, 'Price', observation.displayPrice ?? '—');
    addObservationMeta(meta, 'Ratings', observation.ratingCount?.toLocaleString() ?? '—');

    const observed = document.createElement('p');
    observed.className = 'observation-date';
    observed.textContent = `Observed ${new Date(observation.observedAt).toLocaleString()}`;

    article.append(title, meta, observed);
    observationsList.append(article);
  }
}

async function refreshObservationsView(): Promise<BookObservation[]> {
  const observations = await getObservations();
  renderObservations(observations);
  return observations;
}

function switchView(view: 'capture' | 'observations'): void {
  const showCapture = view === 'capture';
  if (captureView) captureView.hidden = !showCapture;
  if (observationsView) observationsView.hidden = showCapture;
  captureTab?.classList.toggle('active', showCapture);
  observationsTab?.classList.toggle('active', !showCapture);
  if (refreshButton) refreshButton.hidden = !showCapture;

  if (!showCapture) void refreshObservationsView();
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sameBookValues(left: BookDraft, right: BookDraft): boolean {
  return left.asin === right.asin
    && left.title === right.title
    && left.url === right.url
    && left.displayPrice === right.displayPrice
    && left.ratingCount === right.ratingCount
    && left.booksBsr === right.booksBsr
    && left.publisher === right.publisher
    && left.publicationDate === right.publicationDate
    && left.pageCount === right.pageCount;
}

function isSameDayDuplicate(observations: BookObservation[], book: BookDraft, now: Date): boolean {
  const today = localDateKey(now);
  return observations.some((observation) =>
    observation.asin === book.asin
    && localDateKey(new Date(observation.observedAt)) === today
    && sameBookValues(observation, book),
  );
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

function csvValue(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportObservationsCsv(): Promise<void> {
  const observations = await getObservations();
  if (observations.length === 0) return;

  const headers = [
    'id',
    'observedAt',
    'asin',
    'title',
    'url',
    'displayPrice',
    'ratingCount',
    'booksBsr',
    'publisher',
    'publicationDate',
    'pageCount',
  ];
  const rows = observations.map((observation) => [
    observation.id,
    observation.observedAt,
    observation.asin,
    observation.title,
    observation.url,
    observation.displayPrice,
    observation.ratingCount,
    observation.booksBsr,
    observation.publisher,
    observation.publicationDate,
    observation.pageCount,
  ].map(csvValue).join(','));

  const csv = `\uFEFF${headers.join(',')}\r\n${rows.join('\r\n')}\r\n`;
  downloadText(`kdp-scout-observations-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
}

async function exportObservationsJson(): Promise<void> {
  const observations = await getObservations();
  if (observations.length === 0) return;

  downloadText(
    `kdp-scout-observations-${localDateKey(new Date())}.json`,
    JSON.stringify(observations, null, 2),
    'application/json;charset=utf-8',
  );
}

async function clearObservations(): Promise<void> {
  const observations = await getObservations();
  if (observations.length === 0) return;

  const confirmed = window.confirm(`Delete all ${observations.length.toLocaleString()} saved observations from this Chrome profile?`);
  if (!confirmed) return;

  await chrome.storage.local.remove(STORAGE_KEY);
  renderObservations([]);
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

function extractAmazonBook(): BookDraft {
  const normalize = (value: string | null | undefined): string =>
    (value ?? '')
      .replace(/[\u200e\u200f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const text = (selector: string): string =>
    normalize(document.querySelector(selector)?.textContent);

  const firstText = (...selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const value = text(selector);
      if (value) return value;
    }
    return undefined;
  };

  const firstMatchingText = (selectors: string[], pattern: RegExp): string | undefined => {
    for (const selector of selectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        const value = normalize(element.textContent);
        if (value && pattern.test(value)) return value;
      }
    }
    return undefined;
  };

  const url = new URL(window.location.href);
  const urlAsin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
  const inputAsin = document.querySelector<HTMLInputElement>('#ASIN')?.value;
  const asin = normalize(urlAsin ?? inputAsin).toUpperCase() || undefined;

  const detailElements = Array.from(
    document.querySelectorAll(
      '#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr, #bookDetails_feature_div li',
    ),
  );
  const detailLines = detailElements
    .map((element) => normalize(element.textContent))
    .filter(Boolean);

  const detailValue = (...labels: string[]): string | undefined => {
    for (const label of labels) {
      const lowerLabel = label.toLowerCase();
      const line = detailLines.find((candidate) => candidate.toLowerCase().startsWith(lowerLabel));
      if (!line) continue;

      const remainder = line.slice(label.length).replace(/^\s*[:：]\s*/, '').trim();
      if (remainder) return remainder;
    }
    return undefined;
  };

  const bodyText = normalize(document.body?.innerText);
  const pageText = detailLines.join('\n') || bodyText;
  const rankSection = pageText.match(/Best Sellers Rank[\s\S]{0,700}/i)?.[0] ?? pageText;
  const booksBsrMatch = rankSection.match(/#([\d,]+)\s+in\s+Books\b/i);
  const booksBsr = booksBsrMatch?.[1]
    ? Number.parseInt(booksBsrMatch[1].replace(/,/g, ''), 10)
    : undefined;

  const ratingCandidates = [
    firstText('#acrCustomerReviewText'),
    firstText('#acrCustomerReviewLink'),
    firstText('#averageCustomerReviews'),
    firstText('#averageCustomerReviews_feature_div'),
    firstText('[data-hook="total-review-count"]'),
    firstMatchingText(
      [
        'a[href*="#customerReviews"]',
        'a[href*="customerReviews"]',
        'a[href*="product-reviews"]',
        '[aria-label*="rating" i]',
        '[aria-label*="review" i]',
      ],
      /(?:\([\d,]+\)|[\d,]+\s+(?:ratings?|reviews?))/i,
    ),
  ].filter((value): value is string => Boolean(value));

  let ratingCount: number | undefined;
  for (const candidate of ratingCandidates) {
    const labeledMatch = candidate.match(/([\d,]+)\s+(?:ratings?|reviews?)/i);
    const parentheticalMatch = candidate.match(/\(([\d,]+)\)/);
    const bareMatch = candidate.match(/^\s*([\d,]+)\s*$/);
    const raw = labeledMatch?.[1] ?? parentheticalMatch?.[1] ?? bareMatch?.[1];
    if (!raw) continue;

    const parsed = Number.parseInt(raw.replace(/,/g, ''), 10);
    if (Number.isFinite(parsed)) {
      ratingCount = parsed;
      break;
    }
  }

  if (ratingCount === undefined) {
    const titleRegion = normalize(
      document.querySelector('#centerCol')?.textContent ??
      document.querySelector('#title_feature_div')?.parentElement?.textContent,
    );
    const fallbackRating =
      titleRegion.match(/\b[0-5](?:\.\d)?(?:\s*out of 5 stars)?[\s\S]{0,120}?\(([\d,]+)\)/i)?.[1] ??
      titleRegion.match(/\(([\d,]+)\)/)?.[1];
    if (fallbackRating) ratingCount = Number.parseInt(fallbackRating.replace(/,/g, ''), 10);
  }

  const pricePattern = /\$\s*([\d,]+(?:\.\d{2})?)/;
  const priceCandidate =
    firstText(
      '#tmmSwatches .swatchElement.selected .slot-price',
      '#tmmSwatches .swatchElement.selected .a-color-price',
      '#tmmSwatches .swatchElement.selected .a-price .a-offscreen',
      '#tmmSwatches .swatchElement.selected',
      '#tmmSwatches .a-button-selected',
      '#formats .a-button-selected',
      '#mediaTab_content_landing',
      '#mediaNoAccordion .a-price .a-offscreen',
      '#corePrice_feature_div .a-offscreen',
      '.priceToPay .a-offscreen',
      '#buybox .a-price .a-offscreen',
      '#buybox',
      '#desktop_unifiedPrice',
      '#newBuyBoxPrice',
      '#price',
    ) ??
    firstMatchingText(
      [
        '#tmmSwatches *',
        '#formats *',
        '#buybox *',
        '#rightCol *',
        '[id*="mediaTab"] *',
      ],
      pricePattern,
    );

  let displayPrice: string | undefined;
  const priceMatch = priceCandidate?.match(pricePattern);
  if (priceMatch?.[1]) {
    displayPrice = `$${priceMatch[1]}`;
  } else {
    const format = firstText('#productSubtitle') || firstText('#mediaTabs .a-active') || 'Paperback';
    const escapedFormat = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const formatPrice = bodyText.match(new RegExp(`${escapedFormat}[\\s\\S]{0,300}?\\$\\s*([\\d,]+(?:\\.\\d{2})?)`, 'i'))?.[1]
      ?? bodyText.match(/Paperback[\s\S]{0,300}?\$\s*([\d,]+(?:\.\d{2})?)/i)?.[1];
    if (formatPrice) displayPrice = `$${formatPrice}`;
  }

  const publisher = detailValue('Publisher');
  const publicationDate = detailValue('Publication date', 'Publication Date');
  const pageValue = detailValue('Print length', 'Paperback', 'Hardcover');
  const pageCountMatch = pageValue?.match(/([\d,]+)\s+pages?/i);
  const pageCount = pageCountMatch?.[1]
    ? Number.parseInt(pageCountMatch[1].replace(/,/g, ''), 10)
    : undefined;

  return {
    asin,
    title: text('#productTitle') || undefined,
    url: asin ? `https://www.amazon.com/dp/${asin}` : window.location.href,
    displayPrice,
    ratingCount,
    booksBsr,
    publisher,
    publicationDate,
    pageCount,
  };
}

function extractAmazonDiagnostics(): Record<string, unknown> {
  const normalize = (value: string | null | undefined): string =>
    (value ?? '')
      .replace(/[\u200e\u200f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const describe = (element: Element): Record<string, string | null> => ({
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    className: typeof element.className === 'string' ? element.className.slice(0, 300) : null,
    ariaLabel: element.getAttribute('aria-label'),
    href: element.getAttribute('href'),
    text: normalize(element.textContent).slice(0, 300),
    html: element.outerHTML.slice(0, 1200),
  });

  const leafMatches = (rootSelector: string, pattern: RegExp, limit = 15): Array<Record<string, string | null>> => {
    const roots = Array.from(document.querySelectorAll(rootSelector));
    const matches: Array<Record<string, string | null>> = [];
    const seen = new Set<Element>();

    for (const root of roots) {
      const elements = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const element of elements) {
        if (seen.has(element)) continue;
        seen.add(element);

        const value = normalize(element.textContent);
        if (!value || value.length > 180 || !pattern.test(value)) continue;

        const childHasSameSignal = Array.from(element.children).some((child) => {
          const childValue = normalize(child.textContent);
          return childValue.length <= 180 && pattern.test(childValue);
        });
        if (childHasSameSignal) continue;

        matches.push(describe(element));
        if (matches.length >= limit) return matches;
      }
    }

    return matches;
  };

  const contextMatches = (pattern: RegExp, limit = 12): string[] => {
    const body = normalize(document.body?.innerText);
    const results: string[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

    while ((match = regex.exec(body)) && results.length < limit) {
      const start = Math.max(0, match.index - 140);
      const end = Math.min(body.length, match.index + match[0].length + 140);
      results.push(body.slice(start, end));
      if (match[0].length === 0) regex.lastIndex += 1;
    }

    return results;
  };

  return {
    url: window.location.href,
    title: normalize(document.querySelector('#productTitle')?.textContent),
    centerText: normalize(document.querySelector('#centerCol')?.textContent).slice(0, 2200),
    ratingNodes: leafMatches(
      '#centerCol, #averageCustomerReviews_feature_div, #title_feature_div',
      /(?:\([\d,]+\)|\b[0-5](?:\.\d)?\b|ratings?|reviews?)/i,
    ),
    priceNodes: leafMatches(
      '#rightCol, #buybox, #tmmSwatches, #formats, #mediaTabs, #mediaNoAccordion',
      /\$\s*[\d,]+(?:\.\d{2})?/,
    ),
    ratingContexts: contextMatches(/\([\d,]+\)/g),
    priceContexts: contextMatches(/\$\s*[\d,]+(?:\.\d{2})?/g),
  };
}

async function capturePage(): Promise<void> {
  currentBook = null;
  if (cardEl) cardEl.hidden = true;
  if (saveButton) saveButton.disabled = true;
  setStatus('Reading this page…');

  try {
    const tab = await getActiveTab();
    const tabUrl = tab.url ?? '';

    if (!/^https:\/\/(?:www\.)?amazon\.com\//i.test(tabUrl)) {
      throw new Error('Open an Amazon.com book product page, then click KDP Scout.');
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: extractAmazonBook,
    });

    const book = injection?.result as BookDraft | undefined;
    if (!book?.asin || !book.title) {
      throw new Error('This does not look like an Amazon book product page, or the page layout was not recognized.');
    }

    currentBook = book;
    renderBook(book);
    setStatus('Page captured. Review the fields before saving.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read this page.';
    setStatus(message, 'error');
  }
}

async function copyDiagnostics(): Promise<void> {
  try {
    const tab = await getActiveTab();
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: extractAmazonDiagnostics,
    });

    const diagnostics = JSON.stringify(injection?.result ?? {}, null, 2);
    if (diagnosticsOutput) {
      diagnosticsOutput.value = diagnostics;
      diagnosticsOutput.select();
    }
    if (diagnosticsPanel) diagnosticsPanel.hidden = false;

    try {
      await navigator.clipboard.writeText(diagnostics);
      setStatus('Diagnostics copied. Paste them into ChatGPT.', 'success');
    } catch {
      setStatus('Diagnostics generated. Copy the text below and paste it into ChatGPT.', 'success');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to collect diagnostics.';
    setStatus(message, 'error');
  }
}

async function saveObservation(): Promise<void> {
  if (!currentBook?.asin || !currentBook.title) return;

  if (saveButton) saveButton.disabled = true;

  const now = new Date();
  const observations = await getObservations();

  if (isSameDayDuplicate(observations, currentBook, now)) {
    setStatus('Already saved today with the same values. Duplicate skipped.', 'success');
    if (saveButton) saveButton.disabled = false;
    return;
  }

  const observation: BookObservation = {
    ...currentBook,
    id: crypto.randomUUID(),
    observedAt: now.toISOString(),
  };

  observations.push(observation);
  await chrome.storage.local.set({ [STORAGE_KEY]: observations });
  updateObservationCount(observations);

  setStatus(`Saved locally. ${observations.length.toLocaleString()} observation${observations.length === 1 ? '' : 's'} stored.`, 'success');
  if (saveButton) saveButton.disabled = false;
}

refreshButton?.addEventListener('click', () => void capturePage());
saveButton?.addEventListener('click', () => void saveObservation());
diagnosticsButton?.addEventListener('click', () => void copyDiagnostics());
captureTab?.addEventListener('click', () => switchView('capture'));
observationsTab?.addEventListener('click', () => switchView('observations'));
exportCsvButton?.addEventListener('click', () => void exportObservationsCsv());
exportJsonButton?.addEventListener('click', () => void exportObservationsJson());
clearObservationsButton?.addEventListener('click', () => void clearObservations());

void refreshObservationsView();
void capturePage();
