export {};

import type { BookObservation } from '../models/book.js';

type RelevanceClassification = 'Direct' | 'Adjacent' | 'Irrelevant';
type InkType = 'black' | 'standard-color' | 'premium-color';
type TrimType = 'regular' | 'large';
type KindleRoyaltyPlan = 35 | 70;

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

interface EconomicsAssumption {
  query: string;
  paperbackPrice: number;
  pageCount: number;
  inkType?: InkType;
  trimType?: TrimType;
  adCostPerPaperbackSale: number;
  productionCost: number;
  monthlyOngoingCost: number;
  kindlePrice?: number;
  kindleRoyaltyPlan: KindleRoyaltyPlan;
  kindleDeliveryCost: number;
  updatedAt: string;
}

type EconomicsStore = Record<string, EconomicsAssumption>;

interface MarketReference {
  medianPrice?: number;
  medianPageCount?: number;
  priceSamples: number;
  pageSamples: number;
}

interface PrintCalculation {
  printingCost: number;
  royaltyRate: number;
  grossRoyalty: number;
  contributionAfterAds: number;
}

const SEARCH_STORAGE_KEY = 'searchCaptures';
const BOOK_STORAGE_KEY = 'bookObservations';
const ECONOMICS_STORAGE_KEY = 'economicsAssumptions';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseMoney(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

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

function money(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `$${value.toFixed(2)}`;
}

function integer(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : Math.ceil(value).toLocaleString();
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
    if (existing.displayPrice === undefined && result.displayPrice !== undefined) existing.displayPrice = result.displayPrice;
  }
  return [...unique.values()].filter((result) => !result.sponsored);
}

function marketReference(
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
): MarketReference {
  const prices: number[] = [];
  const pages: number[] = [];

  for (const result of uniqueOrganicDirectResults(search)) {
    const observation = latestObservations.get(result.asin);
    const price = parseMoney(observation?.displayPrice ?? result.displayPrice);
    if (price !== undefined && price > 0) prices.push(price);
    if (observation?.pageCount !== undefined && observation.pageCount > 0) pages.push(observation.pageCount);
  }

  return {
    medianPrice: median(prices),
    medianPageCount: median(pages),
    priceSamples: prices.length,
    pageSamples: pages.length,
  };
}

function getStore(value: unknown): EconomicsStore {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as EconomicsStore
    : {};
}

async function readStore(): Promise<EconomicsStore> {
  const stored = await chrome.storage.local.get(ECONOMICS_STORAGE_KEY);
  return getStore(stored[ECONOMICS_STORAGE_KEY]);
}

function paperbackPrintingCost(pageCount: number, inkType: InkType, trimType: TrimType): number | undefined {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return undefined;
  const large = trimType === 'large';

  // Amazon.com KDP paperback printing-cost schedule, current for 2026.
  if (inkType === 'black') {
    if (pageCount < 24 || pageCount > 828) return undefined;
    if (pageCount <= 110) return large ? 2.84 : 2.30;
    return 1 + pageCount * (large ? 0.017 : 0.012);
  }

  if (inkType === 'standard-color') {
    if (pageCount < 72 || pageCount > 600) return undefined;
    return 1 + pageCount * (large ? 0.0402 : 0.0255);
  }

  if (pageCount < 24 || pageCount > 828 || pageCount === 41) return undefined;
  if (pageCount <= 40) return large ? 4.20 : 3.60;
  return 1 + pageCount * (large ? 0.08 : 0.065);
}

function paperbackRoyaltyRate(price: number): number | undefined {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  return price >= 9.99 ? 0.60 : 0.50;
}

function calculatePrint(
  price: number,
  pageCount: number,
  inkType: InkType,
  trimType: TrimType,
  adCostPerSale: number,
): PrintCalculation | undefined {
  const printingCost = paperbackPrintingCost(pageCount, inkType, trimType);
  const royaltyRate = paperbackRoyaltyRate(price);
  if (printingCost === undefined || royaltyRate === undefined) return undefined;
  const grossRoyalty = royaltyRate * price - printingCost;
  return {
    printingCost,
    royaltyRate,
    grossRoyalty,
    contributionAfterAds: grossRoyalty - Math.max(0, adCostPerSale),
  };
}

function kindleRoyalty(price: number | undefined, plan: KindleRoyaltyPlan, deliveryCost: number): number | undefined {
  if (price === undefined || !Number.isFinite(price) || price <= 0) return undefined;
  if (plan === 35) return price * 0.35;
  return price * 0.70 - Math.max(0, deliveryCost);
}

function copiesFor(target: number, perSale: number | undefined, fixedMonthlyCost = 0): number | undefined {
  if (perSale === undefined || perSale <= 0) return undefined;
  return Math.ceil((target + Math.max(0, fixedMonthlyCost)) / perSale);
}

function inputNumber(value: number | undefined, min = 0, step = '0.01'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.step = step;
  input.value = value === undefined ? '' : String(value);
  input.className = 'economics-input';
  return input;
}

function field(label: string, control: HTMLElement, note?: string): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'economics-field';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  wrapper.append(labelEl, control);
  if (note) {
    const noteEl = document.createElement('small');
    noteEl.textContent = note;
    wrapper.append(noteEl);
  }
  return wrapper;
}

function metric(label: string, value: string, note?: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'economics-metric';
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

function selectControl<T extends string>(
  choices: Array<{ value: T | ''; label: string }>,
  selected: T | undefined,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'economics-select';
  for (const choice of choices) {
    const option = document.createElement('option');
    option.value = choice.value;
    option.textContent = choice.label;
    option.selected = choice.value === (selected ?? '');
    select.append(option);
  }
  return select;
}

function numberFrom(input: HTMLInputElement): number | undefined {
  if (input.value.trim() === '') return undefined;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : undefined;
}

function renderPanel(
  article: HTMLElement,
  search: SavedSearchCapture,
  latestObservations: Map<string, BookObservation>,
  store: EconomicsStore,
): void {
  article.querySelector('.economics-panel')?.remove();

  const reference = marketReference(search, latestObservations);
  const key = normalizeQuery(search.query);
  const saved = store[key];
  const defaultPrice = saved?.paperbackPrice ?? reference.medianPrice;
  const defaultPages = saved?.pageCount ?? (reference.medianPageCount === undefined ? undefined : Math.round(reference.medianPageCount));

  const panel = document.createElement('section');
  panel.className = 'economics-panel';

  const headingRow = document.createElement('div');
  headingRow.className = 'economics-heading-row';
  const heading = document.createElement('p');
  heading.className = 'economics-heading';
  heading.textContent = 'Economics · query assumptions';
  const badge = document.createElement('span');
  badge.className = 'economics-badge';
  badge.textContent = saved ? 'Saved' : 'Not saved';
  headingRow.append(heading, badge);

  const referenceLine = document.createElement('p');
  referenceLine.className = 'economics-reference';
  const priceReference = reference.medianPrice === undefined
    ? 'median price unavailable'
    : `median observed paperback price ${money(reference.medianPrice)} (${reference.priceSamples} books)`;
  const pageReference = reference.medianPageCount === undefined
    ? 'median page count unavailable'
    : `median observed page count ${Math.round(reference.medianPageCount).toLocaleString()} (${reference.pageSamples} books)`;
  referenceLine.textContent = `Market reference: ${priceReference} · ${pageReference}. These are competitor references, not a recommended product spec.`;

  const paperbackPrice = inputNumber(defaultPrice);
  paperbackPrice.setAttribute('aria-label', 'Target paperback price');
  const pageCount = inputNumber(defaultPages, 1, '1');
  pageCount.setAttribute('aria-label', 'Target paperback page count');
  const inkType = selectControl<InkType>([
    { value: '', label: 'Select ink type' },
    { value: 'black', label: 'Black ink' },
    { value: 'standard-color', label: 'Standard color' },
    { value: 'premium-color', label: 'Premium color' },
  ], saved?.inkType);
  inkType.setAttribute('aria-label', 'Paperback ink type');
  const trimType = selectControl<TrimType>([
    { value: '', label: 'Select trim class' },
    { value: 'regular', label: 'Regular trim' },
    { value: 'large', label: 'Large trim' },
  ], saved?.trimType);
  trimType.setAttribute('aria-label', 'Paperback trim class');

  const adCost = inputNumber(saved?.adCostPerPaperbackSale ?? 0);
  adCost.setAttribute('aria-label', 'Advertising cost per paperback sale');
  const productionCost = inputNumber(saved?.productionCost ?? 0);
  productionCost.setAttribute('aria-label', 'One-time production cost');
  const ongoingCost = inputNumber(saved?.monthlyOngoingCost ?? 0);
  ongoingCost.setAttribute('aria-label', 'Monthly ongoing update or review cost');

  const printFields = document.createElement('div');
  printFields.className = 'economics-fields';
  printFields.append(
    field('Target paperback price', paperbackPrice),
    field('Target page count', pageCount),
    field('Ink type', inkType, 'Amazon.com estimate'),
    field('Trim class', trimType, 'Large = >6.12 in wide or >9 in high'),
    field('Ad cost / paperback sale', adCost),
    field('One-time production cost', productionCost),
    field('Monthly update/review cost', ongoingCost),
  );

  const kindlePrice = inputNumber(saved?.kindlePrice);
  kindlePrice.setAttribute('aria-label', 'Target Kindle price');
  const kindlePlan = selectControl<'35' | '70'>([
    { value: '70', label: '70% option' },
    { value: '35', label: '35% option' },
  ], String(saved?.kindleRoyaltyPlan ?? 70) as '35' | '70');
  kindlePlan.setAttribute('aria-label', 'Kindle royalty option');
  const deliveryCost = inputNumber(saved?.kindleDeliveryCost ?? 0.06);
  deliveryCost.setAttribute('aria-label', 'Kindle delivery cost');

  const kindleFields = document.createElement('div');
  kindleFields.className = 'economics-fields economics-kindle-fields';
  kindleFields.append(
    field('Target Kindle price', kindlePrice, 'Optional'),
    field('Kindle royalty option', kindlePlan),
    field('Kindle delivery cost', deliveryCost, '70% option only; editable estimate'),
  );

  const results = document.createElement('div');
  results.className = 'economics-grid';
  const warning = document.createElement('p');
  warning.className = 'economics-warning';

  const recalculate = (): void => {
    const price = numberFrom(paperbackPrice);
    const pages = numberFrom(pageCount);
    const ads = numberFrom(adCost) ?? 0;
    const production = numberFrom(productionCost) ?? 0;
    const ongoing = numberFrom(ongoingCost) ?? 0;
    const ink = inkType.value as InkType | '';
    const trim = trimType.value as TrimType | '';
    const print = price !== undefined && pages !== undefined && ink && trim
      ? calculatePrint(price, Math.round(pages), ink, trim, ads)
      : undefined;

    const gross = print?.grossRoyalty;
    const contribution = print?.contributionAfterAds;
    const kindlePriceValue = numberFrom(kindlePrice);
    const plan = Number(kindlePlan.value) as KindleRoyaltyPlan;
    const kindleDelivery = numberFrom(deliveryCost) ?? 0;
    const kindle = kindleRoyalty(kindlePriceValue, plan, kindleDelivery);

    results.replaceChildren(
      metric('Printing cost', money(print?.printingCost)),
      metric('Paperback royalty rate', print ? `${Math.round(print.royaltyRate * 100)}%` : '—', 'Amazon.com list-price tier'),
      metric('Gross royalty / paperback', money(gross)),
      metric('After-ad contribution / sale', money(contribution)),
      metric('Copies for $500 gross/mo', integer(copiesFor(500, gross))),
      metric('Copies for $1,000 gross/mo', integer(copiesFor(1000, gross))),
      metric('Copies for $500 net/mo', integer(copiesFor(500, contribution, ongoing)), 'After ad + monthly ongoing cost'),
      metric('Copies for $1,000 net/mo', integer(copiesFor(1000, contribution, ongoing)), 'After ad + monthly ongoing cost'),
      metric('Production break-even copies', integer(copiesFor(production, contribution))),
      metric('Estimated Kindle royalty', money(kindle), plan === 70 ? 'US eligible-territory estimate' : '35% option'),
    );

    const messages: string[] = [];
    if (!ink || !trim) messages.push('Select ink type and trim class to calculate paperback economics.');
    if (ink && pages !== undefined) {
      const cost = trim ? paperbackPrintingCost(Math.round(pages), ink, trim) : undefined;
      if (trim && cost === undefined) messages.push('That page count is outside KDP’s supported range for the selected print specification.');
    }
    if (gross !== undefined && gross <= 0) messages.push('Paperback royalty is non-positive at these assumptions; the list price is below a viable level for this print cost.');
    if (contribution !== undefined && contribution <= 0) messages.push('Advertising cost consumes the full paperback royalty; after-ad contribution is non-positive.');
    if (plan === 70 && kindlePriceValue !== undefined && (kindlePriceValue < 2.99 || kindlePriceValue > 12.99)) {
      messages.push('The current Amazon.com 70% Kindle price band is $2.99–$12.99; other eligibility rules also apply.');
    }
    warning.textContent = messages.join(' ');
    warning.hidden = messages.length === 0;
  };

  for (const control of [paperbackPrice, pageCount, inkType, trimType, adCost, productionCost, ongoingCost, kindlePrice, kindlePlan, deliveryCost]) {
    control.addEventListener('input', recalculate);
    control.addEventListener('change', recalculate);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'secondary economics-save';
  save.textContent = 'Save economics assumptions';
  const status = document.createElement('p');
  status.className = 'economics-status';

  save.addEventListener('click', async () => {
    const price = numberFrom(paperbackPrice);
    const pages = numberFrom(pageCount);
    if (price === undefined || price <= 0 || pages === undefined || pages <= 0) {
      status.textContent = 'Enter a positive paperback price and page count before saving.';
      return;
    }

    const current = await readStore();
    current[key] = {
      query: key,
      paperbackPrice: price,
      pageCount: Math.round(pages),
      inkType: inkType.value ? inkType.value as InkType : undefined,
      trimType: trimType.value ? trimType.value as TrimType : undefined,
      adCostPerPaperbackSale: Math.max(0, numberFrom(adCost) ?? 0),
      productionCost: Math.max(0, numberFrom(productionCost) ?? 0),
      monthlyOngoingCost: Math.max(0, numberFrom(ongoingCost) ?? 0),
      kindlePrice: numberFrom(kindlePrice),
      kindleRoyaltyPlan: Number(kindlePlan.value) as KindleRoyaltyPlan,
      kindleDeliveryCost: Math.max(0, numberFrom(deliveryCost) ?? 0),
      updatedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [ECONOMICS_STORAGE_KEY]: current });
    badge.textContent = 'Saved';
    status.textContent = 'Economics assumptions saved for this search phrase.';
  });

  const sourceNote = document.createElement('p');
  sourceNote.className = 'economics-note';
  sourceNote.textContent = 'Paperback estimate uses current Amazon.com KDP royalty tiers and print-cost formulas. KDP rates can change; verify the final spec in Amazon’s Printing Cost & Royalty Calculator before greenlighting production. Gross-royalty targets follow the validation method: $500/month for six post-launch months is the practical initial success threshold; $1,000/month is a strong title.';

  const verifyLink = document.createElement('a');
  verifyLink.href = 'https://kdp.amazon.com/en_US/royalty-calculator';
  verifyLink.target = '_blank';
  verifyLink.rel = 'noreferrer';
  verifyLink.className = 'economics-verify';
  verifyLink.textContent = 'Verify in KDP calculator';

  panel.append(
    headingRow,
    referenceLine,
    printFields,
    kindleFields,
    results,
    warning,
    save,
    status,
    sourceNote,
    verifyLink,
  );
  recalculate();

  const reviewResearch = article.querySelector('.review-research');
  const readiness = article.querySelector('.readiness-guidance');
  const details = article.querySelector('.saved-search-details');
  if (reviewResearch) article.insertBefore(panel, reviewResearch);
  else if (readiness) article.insertBefore(panel, readiness);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

async function renderEconomics(): Promise<void> {
  if (!savedSearchesList) return;
  const stored = await chrome.storage.local.get([
    SEARCH_STORAGE_KEY,
    BOOK_STORAGE_KEY,
    ECONOMICS_STORAGE_KEY,
  ]);
  const searches = Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[]
    : [];
  const observations = Array.isArray(stored[BOOK_STORAGE_KEY])
    ? stored[BOOK_STORAGE_KEY] as BookObservation[]
    : [];
  const store = getStore(stored[ECONOMICS_STORAGE_KEY]);
  const latest = latestObservationByAsin(observations);
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderPanel(article, search, latest, store);
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderEconomics());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[BOOK_STORAGE_KEY] && !changes[ECONOMICS_STORAGE_KEY]) return;
  void renderEconomics();
});

void renderEconomics();
