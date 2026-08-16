export {};

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

const REVIEW_STORAGE_KEY = 'reviewResearch';
let normalizing = false;

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeTheme(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseStore(value: unknown): ReviewResearchStore | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ReviewResearchStore>;
  if (!Array.isArray(candidate.evidence)) return undefined;
  return {
    screens: candidate.screens && typeof candidate.screens === 'object' && !Array.isArray(candidate.screens)
      ? candidate.screens as Record<string, ReviewScreen>
      : {},
    evidence: candidate.evidence as ReviewEvidence[],
  };
}

function evidenceKey(entry: ReviewEvidence): string {
  return [
    normalizeQuery(entry.query),
    entry.asin.toUpperCase(),
    entry.kind,
    normalizeTheme(entry.theme),
  ].join('::');
}

function consolidate(store: ReviewResearchStore): { store: ReviewResearchStore; changed: boolean } {
  const merged = new Map<string, ReviewEvidence>();
  let changed = false;

  for (const entry of store.evidence) {
    const key = evidenceKey(entry);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...entry });
      continue;
    }

    changed = true;
    const entryIsNewer = entry.updatedAt > existing.updatedAt;
    existing.mentions += Math.max(1, entry.mentions || 1);
    existing.updatedAt = entryIsNewer ? entry.updatedAt : existing.updatedAt;
    existing.createdAt = entry.createdAt < existing.createdAt ? entry.createdAt : existing.createdAt;
    if (entryIsNewer && entry.detail) existing.detail = entry.detail;
    else if (!existing.detail && entry.detail) existing.detail = entry.detail;
  }

  return {
    store: { ...store, evidence: [...merged.values()] },
    changed,
  };
}

async function normalizeStoredEvidence(): Promise<void> {
  if (normalizing) return;
  const stored = await chrome.storage.local.get(REVIEW_STORAGE_KEY);
  const parsed = parseStore(stored[REVIEW_STORAGE_KEY]);
  if (!parsed) return;
  const result = consolidate(parsed);
  if (!result.changed) return;

  normalizing = true;
  try {
    await chrome.storage.local.set({ [REVIEW_STORAGE_KEY]: result.store });
  } finally {
    normalizing = false;
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[REVIEW_STORAGE_KEY]) return;
  void normalizeStoredEvidence();
});

void normalizeStoredEvidence();
