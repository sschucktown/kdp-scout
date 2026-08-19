export interface CapturedReview {
  id: string;
  asin: string;
  reviewId?: string;
  title?: string;
  body: string;
  starRating?: number;
  reviewerName?: string;
  reviewDate?: string;
  verifiedPurchase?: boolean;
  helpfulVotes?: number;
  sourceUrl: string;
  capturedAt: string;
}

export interface ReviewPageDraft {
  asin: string;
  bookTitle?: string;
  sourceUrl: string;
  reviews: CapturedReview[];
  pageKind: 'list' | 'permalink';
  starFilter: 1 | 2 | 3 | 4 | 5 | 'all';
  reportedMatchingCount?: number;
  nextPageUrl?: string;
  blockedReason?: string;
}
