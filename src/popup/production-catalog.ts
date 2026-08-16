export {};

type AccuracyStatus = 'unassessed' | 'maintainable' | 'redesign' | 'not-maintainable';
type ExtensionStatus = 'credible' | 'needs-differentiation' | 'cannibalizing';

type ProductionRequirementKey =
  | 'registered-dietitian-review'
  | 'physician-clinician-review'
  | 'physical-therapist-review'
  | 'licensed-therapist-review'
  | 'attorney-review'
  | 'credentialed-dog-trainer-review'
  | 'subject-matter-expert'
  | 'exam-outline-mapping'
  | 'original-practice-questions'
  | 'nutritional-calculations'
  | 'recipe-testing'
  | 'illustration'
  | 'photography'
  | 'annual-updates'
  | 'state-specific-updates'
  | 'regulatory-monitoring'
  | 'trademark-review'
  | 'medical-claim-review'
  | 'accessibility-large-print'
  | 'companion-digital-resources';

type CatalogExtensionType =
  | 'Adjacent buyer segment'
  | 'Different life stage'
  | 'Companion workbook'
  | 'Practice-test book'
  | 'Flashcards'
  | 'Meal planner'
  | 'Recipe variation'
  | 'Audio cram guide'
  | 'Updated annual edition'
  | 'State-specific edition'
  | 'Large-print edition'
  | 'Bundle or box set'
  | 'Related diagnosis or constraint'
  | 'Parent guide and child workbook'
  | 'Beginner and advanced edition'
  | 'Other';

interface SavedSearchCapture {
  id: string;
  capturedAt: string;
  query: string;
}

interface CatalogExtension {
  id: string;
  type: CatalogExtensionType;
  concept: string;
  distinctBuyerUse?: string;
  status: ExtensionStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProductionCatalogAssessment {
  query: string;
  requirements: ProductionRequirementKey[];
  accuracyStatus: AccuracyStatus;
  productionNote?: string;
  extensions: CatalogExtension[];
  updatedAt: string;
}

type ProductionCatalogStore = Record<string, ProductionCatalogAssessment>;

const SEARCH_STORAGE_KEY = 'searchCaptures';
const STORAGE_KEY = 'productionCatalogAssessments';
const savedSearchesList = document.querySelector<HTMLElement>('#saved-searches-list');

const REQUIREMENTS: Array<{ key: ProductionRequirementKey; label: string }> = [
  { key: 'registered-dietitian-review', label: 'Registered dietitian review' },
  { key: 'physician-clinician-review', label: 'Physician or clinician review' },
  { key: 'physical-therapist-review', label: 'Physical therapist review' },
  { key: 'licensed-therapist-review', label: 'Licensed therapist review' },
  { key: 'attorney-review', label: 'Attorney review' },
  { key: 'credentialed-dog-trainer-review', label: 'Credentialed dog trainer review' },
  { key: 'subject-matter-expert', label: 'Subject-matter expert' },
  { key: 'exam-outline-mapping', label: 'Exam-outline mapping' },
  { key: 'original-practice-questions', label: 'Original practice questions' },
  { key: 'nutritional-calculations', label: 'Nutritional calculations' },
  { key: 'recipe-testing', label: 'Recipe testing' },
  { key: 'illustration', label: 'Illustration' },
  { key: 'photography', label: 'Photography' },
  { key: 'annual-updates', label: 'Annual updates' },
  { key: 'state-specific-updates', label: 'State-specific updates' },
  { key: 'regulatory-monitoring', label: 'Regulatory monitoring' },
  { key: 'trademark-review', label: 'Trademark review' },
  { key: 'medical-claim-review', label: 'Medical-claim review' },
  { key: 'accessibility-large-print', label: 'Accessibility / large-print design' },
  { key: 'companion-digital-resources', label: 'Companion digital resources' },
];

const EXTENSION_TYPES: CatalogExtensionType[] = [
  'Adjacent buyer segment',
  'Different life stage',
  'Companion workbook',
  'Practice-test book',
  'Flashcards',
  'Meal planner',
  'Recipe variation',
  'Audio cram guide',
  'Updated annual edition',
  'State-specific edition',
  'Large-print edition',
  'Bundle or box set',
  'Related diagnosis or constraint',
  'Parent guide and child workbook',
  'Beginner and advanced edition',
  'Other',
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseStore(value: unknown): ProductionCatalogStore {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as ProductionCatalogStore
    : {};
}

async function readStore(): Promise<ProductionCatalogStore> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return parseStore(stored[STORAGE_KEY]);
}

async function writeAssessment(assessment: ProductionCatalogAssessment): Promise<void> {
  const store = await readStore();
  store[normalizeQuery(assessment.query)] = assessment;
  await chrome.storage.local.set({ [STORAGE_KEY]: store });
}

function defaultAssessment(query: string): ProductionCatalogAssessment {
  return {
    query: normalizeQuery(query),
    requirements: [],
    accuracyStatus: 'unassessed',
    extensions: [],
    updatedAt: new Date().toISOString(),
  };
}

function accuracyLabel(status: AccuracyStatus): string {
  switch (status) {
    case 'maintainable': return 'Reliably maintainable';
    case 'redesign': return 'Requires redesign';
    case 'not-maintainable': return 'Not reliably maintainable';
    default: return 'Unassessed';
  }
}

function extensionStatusLabel(status: ExtensionStatus): string {
  switch (status) {
    case 'credible': return 'Credible distinct extension';
    case 'needs-differentiation': return 'Needs differentiation';
    case 'cannibalizing': return 'Likely cannibalizing';
  }
}

function option(value: string, label = value): HTMLOptionElement {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
}

function metric(label: string, value: string, note?: string): HTMLElement {
  const item = document.createElement('div');
  item.className = 'production-catalog-metric';
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

function catalogSummary(assessment: ProductionCatalogAssessment): {
  credible: number;
  needsDifferentiation: number;
  cannibalizing: number;
} {
  let credible = 0;
  let needsDifferentiation = 0;
  let cannibalizing = 0;
  for (const extension of assessment.extensions) {
    if (extension.status === 'credible') credible += 1;
    else if (extension.status === 'needs-differentiation') needsDifferentiation += 1;
    else cannibalizing += 1;
  }
  return { credible, needsDifferentiation, cannibalizing };
}

function readinessText(assessment: ProductionCatalogAssessment): { label: string; detail: string; className: string } {
  const summary = catalogSummary(assessment);
  if (assessment.accuracyStatus === 'not-maintainable') {
    return {
      label: 'Reject or fundamentally redesign',
      detail: 'Accuracy cannot currently be maintained reliably. The validation method treats this as a hard stop even if demand is attractive.',
      className: 'production-catalog-danger',
    };
  }
  if (assessment.accuracyStatus === 'redesign') {
    return {
      label: 'Production redesign required',
      detail: 'The concept needs a lower-risk scope or production plan before greenlighting.',
      className: 'production-catalog-caution',
    };
  }
  if (assessment.accuracyStatus === 'unassessed') {
    return {
      label: 'Production risk unassessed',
      detail: 'Record the accuracy-maintenance judgment before treating production burden as resolved.',
      className: 'production-catalog-caution',
    };
  }
  if (summary.credible < 3) {
    return {
      label: 'Catalog depth incomplete',
      detail: `${summary.credible}/3 credible non-cannibalizing extensions recorded. The method asks for at least three natural follow-on products.`,
      className: 'production-catalog-caution',
    };
  }
  return {
    label: 'Production/catalog evidence recorded',
    detail: 'Accuracy is marked maintainable and at least three credible distinct extensions are recorded. This still does not replace demand, wedge, economics, or BSR-history validation.',
    className: 'production-catalog-good',
  };
}

function renderExtensions(
  container: HTMLElement,
  assessment: ProductionCatalogAssessment,
): void {
  container.replaceChildren();
  if (assessment.extensions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'production-catalog-note';
    empty.textContent = 'No catalog extensions recorded yet.';
    container.append(empty);
    return;
  }

  for (const extension of assessment.extensions) {
    const row = document.createElement('div');
    row.className = 'catalog-extension-row';

    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = extension.concept;
    const meta = document.createElement('span');
    meta.textContent = `${extension.type} · ${extensionStatusLabel(extension.status)}`;
    body.append(title, meta);

    if (extension.distinctBuyerUse) {
      const distinct = document.createElement('p');
      distinct.textContent = `Distinct buyer/use: ${extension.distinctBuyerUse}`;
      body.append(distinct);
    }
    if (extension.note) {
      const note = document.createElement('p');
      note.textContent = extension.note;
      body.append(note);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary production-catalog-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      const store = await readStore();
      const key = normalizeQuery(assessment.query);
      const current = store[key] ?? assessment;
      await writeAssessment({
        ...current,
        extensions: current.extensions.filter((item) => item.id !== extension.id),
        updatedAt: new Date().toISOString(),
      });
    });

    row.append(body, remove);
    container.append(row);
  }
}

function renderPanel(
  article: HTMLElement,
  search: SavedSearchCapture,
  store: ProductionCatalogStore,
): void {
  article.querySelector('.production-catalog-panel')?.remove();

  const key = normalizeQuery(search.query);
  const assessment = store[key] ?? defaultAssessment(search.query);
  const summary = catalogSummary(assessment);
  const readiness = readinessText(assessment);

  const panel = document.createElement('section');
  panel.className = `production-catalog-panel ${readiness.className}`;

  const headingRow = document.createElement('div');
  headingRow.className = 'production-catalog-heading-row';
  const heading = document.createElement('p');
  heading.className = 'production-catalog-heading';
  heading.textContent = 'Production burden + catalog expansion';
  const badge = document.createElement('span');
  badge.className = 'production-catalog-badge';
  badge.textContent = store[key] ? 'Saved' : 'Not saved';
  headingRow.append(heading, badge);

  const metrics = document.createElement('div');
  metrics.className = 'production-catalog-grid';
  metrics.append(
    metric('Requirements selected', assessment.requirements.length.toLocaleString()),
    metric('Accuracy maintainability', accuracyLabel(assessment.accuracyStatus)),
    metric('Credible extensions', `${summary.credible}/3`, 'Target: at least 3'),
    metric('Overlap / cannibalization', (summary.needsDifferentiation + summary.cannibalizing).toLocaleString()),
  );

  const status = document.createElement('p');
  status.className = 'production-catalog-status';
  const statusStrong = document.createElement('strong');
  statusStrong.textContent = readiness.label;
  status.append(statusStrong, document.createTextNode(` ${readiness.detail}`));

  panel.append(headingRow, metrics, status);

  const productionSection = document.createElement('div');
  productionSection.className = 'production-catalog-section';
  const productionHeading = document.createElement('p');
  productionHeading.className = 'production-catalog-subheading';
  productionHeading.textContent = 'Production requirements';
  const productionNote = document.createElement('p');
  productionNote.className = 'production-catalog-note';
  productionNote.textContent = 'Select every requirement that must be handled before launch. Reject or redesign a concept when accuracy cannot be reliably maintained.';

  const checklist = document.createElement('div');
  checklist.className = 'production-requirement-grid';
  const checkboxes = new Map<ProductionRequirementKey, HTMLInputElement>();
  for (const requirement of REQUIREMENTS) {
    const label = document.createElement('label');
    label.className = 'production-requirement';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = assessment.requirements.includes(requirement.key);
    checkboxes.set(requirement.key, checkbox);
    const text = document.createElement('span');
    text.textContent = requirement.label;
    label.append(checkbox, text);
    checklist.append(label);
  }

  const accuracySelect = document.createElement('select');
  accuracySelect.className = 'production-catalog-select';
  accuracySelect.append(
    option('unassessed', 'Accuracy maintainability: unassessed'),
    option('maintainable', 'Reliably maintainable'),
    option('redesign', 'Requires redesign'),
    option('not-maintainable', 'Not reliably maintainable'),
  );
  accuracySelect.value = assessment.accuracyStatus;

  const productionNotes = document.createElement('textarea');
  productionNotes.className = 'production-catalog-textarea';
  productionNotes.rows = 2;
  productionNotes.placeholder = 'Production/risk note: expert availability, testing burden, update cadence, liability, accessibility...';
  productionNotes.value = assessment.productionNote ?? '';

  const saveProduction = document.createElement('button');
  saveProduction.type = 'button';
  saveProduction.className = 'secondary production-catalog-save';
  saveProduction.textContent = 'Save production assessment';
  const productionStatus = document.createElement('p');
  productionStatus.className = 'production-catalog-note';

  saveProduction.addEventListener('click', async () => {
    const selected: ProductionRequirementKey[] = [];
    for (const requirement of REQUIREMENTS) {
      if (checkboxes.get(requirement.key)?.checked) selected.push(requirement.key);
    }
    await writeAssessment({
      ...assessment,
      query: key,
      requirements: selected,
      accuracyStatus: accuracySelect.value as AccuracyStatus,
      productionNote: productionNotes.value.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    productionStatus.textContent = 'Production assessment saved.';
  });

  productionSection.append(
    productionHeading,
    productionNote,
    checklist,
    accuracySelect,
    productionNotes,
    saveProduction,
    productionStatus,
  );
  panel.append(productionSection);

  const catalogSection = document.createElement('div');
  catalogSection.className = 'production-catalog-section';
  const catalogHeading = document.createElement('p');
  catalogHeading.className = 'production-catalog-subheading';
  catalogHeading.textContent = 'Catalog expansion';
  const catalogNote = document.createElement('p');
  catalogNote.className = 'production-catalog-note';
  catalogNote.textContent = 'Record at least three credible follow-on products. Near-duplicates that target the same buyer/search intent do not count.';

  const typeSelect = document.createElement('select');
  typeSelect.className = 'production-catalog-select';
  for (const type of EXTENSION_TYPES) typeSelect.append(option(type));

  const conceptInput = document.createElement('input');
  conceptInput.type = 'text';
  conceptInput.className = 'production-catalog-input';
  conceptInput.placeholder = 'Extension concept';

  const distinctInput = document.createElement('input');
  distinctInput.type = 'text';
  distinctInput.className = 'production-catalog-input';
  distinctInput.placeholder = 'Distinct buyer/use case (required for credible)';

  const extensionStatus = document.createElement('select');
  extensionStatus.className = 'production-catalog-select';
  extensionStatus.append(
    option('credible', 'Credible distinct extension'),
    option('needs-differentiation', 'Needs differentiation'),
    option('cannibalizing', 'Likely cannibalizing'),
  );

  const extensionNote = document.createElement('textarea');
  extensionNote.className = 'production-catalog-textarea';
  extensionNote.rows = 2;
  extensionNote.placeholder = 'Optional note';

  const addExtension = document.createElement('button');
  addExtension.type = 'button';
  addExtension.className = 'secondary production-catalog-save';
  addExtension.textContent = 'Add catalog extension';
  const catalogStatus = document.createElement('p');
  catalogStatus.className = 'production-catalog-note';

  addExtension.addEventListener('click', async () => {
    const concept = conceptInput.value.trim();
    const distinctBuyerUse = distinctInput.value.trim();
    const statusValue = extensionStatus.value as ExtensionStatus;
    if (!concept) {
      catalogStatus.textContent = 'Add an extension concept.';
      conceptInput.focus();
      return;
    }
    if (statusValue === 'credible' && !distinctBuyerUse) {
      catalogStatus.textContent = 'Credible extensions require a distinct buyer or use case.';
      distinctInput.focus();
      return;
    }

    const currentStore = await readStore();
    const current = currentStore[key] ?? assessment;
    const now = new Date().toISOString();
    const extension: CatalogExtension = {
      id: crypto.randomUUID(),
      type: typeSelect.value as CatalogExtensionType,
      concept,
      distinctBuyerUse: distinctBuyerUse || undefined,
      status: statusValue,
      note: extensionNote.value.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    await writeAssessment({
      ...current,
      query: key,
      extensions: [...current.extensions, extension],
      updatedAt: now,
    });
    conceptInput.value = '';
    distinctInput.value = '';
    extensionNote.value = '';
    catalogStatus.textContent = 'Catalog extension saved.';
  });

  const extensions = document.createElement('div');
  extensions.className = 'catalog-extension-list';
  renderExtensions(extensions, assessment);

  catalogSection.append(
    catalogHeading,
    catalogNote,
    typeSelect,
    conceptInput,
    distinctInput,
    extensionStatus,
    extensionNote,
    addExtension,
    catalogStatus,
    extensions,
  );
  panel.append(catalogSection);

  const readinessPanel = article.querySelector('.readiness-guidance');
  const details = article.querySelector('.saved-search-details');
  if (readinessPanel) article.insertBefore(panel, readinessPanel);
  else if (details) article.insertBefore(panel, details);
  else article.append(panel);
}

async function getData(): Promise<{ searches: SavedSearchCapture[]; store: ProductionCatalogStore }> {
  const stored = await chrome.storage.local.get([SEARCH_STORAGE_KEY, STORAGE_KEY]);
  const searches = Array.isArray(stored[SEARCH_STORAGE_KEY])
    ? stored[SEARCH_STORAGE_KEY] as SavedSearchCapture[]
    : [];
  return { searches, store: parseStore(stored[STORAGE_KEY]) };
}

async function renderProductionCatalog(): Promise<void> {
  if (!savedSearchesList) return;
  const { searches, store } = await getData();
  const sorted = [...searches].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
  const articles = Array.from(savedSearchesList.children)
    .filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element.classList.contains('saved-search-item'));

  for (let index = 0; index < Math.min(sorted.length, articles.length); index += 1) {
    const search = sorted[index];
    const article = articles[index];
    if (!search || !article) continue;
    renderPanel(article, search, store);
  }
}

if (savedSearchesList) {
  const observer = new MutationObserver(() => void renderProductionCatalog());
  observer.observe(savedSearchesList, { childList: true });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes[SEARCH_STORAGE_KEY] && !changes[STORAGE_KEY]) return;
  void renderProductionCatalog();
});

void renderProductionCatalog();
