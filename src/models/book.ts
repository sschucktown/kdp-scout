export interface BookDraft {
  asin?: string;
  title?: string;
  url: string;
  displayPrice?: string;
  ratingCount?: number;
  booksBsr?: number;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
}

export interface BookObservation extends BookDraft {
  id: string;
  observedAt: string;
}
