'use server';

import { revalidatePath } from 'next/cache';

import {
  approveCaptureReview,
  listPendingCaptureReviews,
  rejectCaptureReview,
} from '@/lib/capture/review';
import type { CaptureReviewResult, CaptureReviewRow } from '@/lib/capture/review-types';

export async function listPendingCaptureReviewsAction(): Promise<CaptureReviewRow[]> {
  return listPendingCaptureReviews();
}

export async function approveCaptureReviewAction(
  reviewId: string,
): Promise<CaptureReviewResult> {
  const res = await approveCaptureReview(reviewId);
  if (res.ok) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
    revalidatePath('/dashboard');
  }
  return res;
}

export async function rejectCaptureReviewAction(
  reviewId: string,
  reason?: string | null,
): Promise<CaptureReviewResult> {
  const res = await rejectCaptureReview(reviewId, reason ?? null);
  if (res.ok) revalidatePath('/orders');
  return res;
}
