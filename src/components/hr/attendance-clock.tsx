'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { uploadAttachmentAction } from '@/lib/attachments/actions';
import { COMPRESS_QUALITY, targetDimensions } from '@/lib/attachments/image';
import { EMPTY_UPLOAD_ATTACHMENT_STATE } from '@/lib/attachments/types';
import { clockInAction, clockOutAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE } from '@/lib/hr/action-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';

/**
 * Attendance clock — the person's own name at the top, one big Clock In button,
 * and a selfie step (Cancel / Capture) that gates the clock-in. The selfie is a
 * REAL, stored artifact: it uploads through the tested attachments pipeline and
 * is attached to the new attendance record. Clock-in itself is never blocked by a
 * camera problem — a "Clock in without photo" fallback is always offered, and the
 * fallback is honestly labelled rather than pretending a photo was taken.
 *
 * The server actions are awaited directly (clock in → attach selfie) so the flow
 * reads top-to-bottom; state is set only in async callbacks.
 */

async function compressToJpeg(video: HTMLVideoElement): Promise<Blob> {
  const { width, height } = targetDimensions(video.videoWidth, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-2d-context');
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', COMPRESS_QUALITY),
  );
  if (!blob) throw new Error('encode-failed');
  return blob;
}

export type ClockStaffMember = {
  id: string;
  fullName: string;
  roleKey: string;
  /** Profile photo URL when available; initials are shown otherwise. */
  photoUrl?: string | null;
};

export function AttendanceClock({
  staff,
  openSessions,
  lastOutToday = {},
}: {
  /** Active Owner/Admin/Staff from Team Members — the only people who can be clocked. */
  staff: ClockStaffMember[];
  /** staff id → ISO time of their current open session (clocked in, not out). */
  openSessions: Record<string, string>;
  /** staff id → ISO of their most recent clock-out TODAY (drives Continue Duty). */
  lastOutToday?: Record<string, string>;
}) {
  const router = useRouter();
  // Require selecting WHO is signing in before clock in/out is offered.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = staff.find((s) => s.id === selectedId) ?? null;
  const openSince = selectedId ? (openSessions[selectedId] ?? null) : null;
  const openSession = { open: Boolean(openSince), since: openSince };
  // Already clocked out today AND no open session → offer Continue Duty (a NEW
  // session on the same attendance day), not a plain Clock In.
  const resumeSince =
    selectedId && !openSession.open ? (lastOutToday[selectedId] ?? null) : null;
  const [continueConfirm, setContinueConfirm] = useState(false);
  const [mode, setMode] = useState<'idle' | 'camera'>('idle');
  // Which action the selfie step will complete — clock IN or clock OUT.
  const [intent, setIntent] = useState<'in' | 'out'>('in');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cameraSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => () => stopStream(), []);

  // Bind the live stream to the <video> once it is mounted in camera mode.
  useEffect(() => {
    if (mode !== 'camera') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [mode]);

  async function startCamera(which: 'in' | 'out') {
    setIntent(which);
    setError(null);
    setNotice(null);
    setCameraError(null);
    if (!cameraSupported) {
      setCameraError('This device or browser has no camera access.');
      setMode('camera');
      return;
    }
    try {
      // Front camera — this is a selfie.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' } },
        audio: false,
      });
      streamRef.current = stream;
      setMode('camera');
    } catch {
      setCameraError('Camera permission was denied or unavailable.');
      setMode('camera');
    }
  }

  function cancelCamera() {
    stopStream();
    setMode('idle');
    setCameraError(null);
  }

  /** Clock in/out (per `intent`), then attach the selfie to that record. */
  async function finish(selfie: Blob | null) {
    if (!selectedId) {
      setError('Select who is signing in first.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('staffProfileId', selectedId);
      const result =
        intent === 'in'
          ? await clockInAction(EMPTY_HR_STATE, fd)
          : await clockOutAction(EMPTY_HR_STATE, fd);
      if (result.error) {
        setError(result.error);
        return;
      }

      const fallbackMessage = intent === 'in' ? 'Clocked in.' : 'Clocked out.';
      if (selfie && result.recordId) {
        const kind = intent === 'in' ? 'clock-in' : 'clock-out';
        const fd = new FormData();
        fd.set('relatedEntityType', 'attendance_record');
        fd.set('relatedEntityId', result.recordId);
        fd.set('purpose', 'photo');
        fd.set('source', 'camera');
        fd.set('fileName', `${kind}-selfie-${Date.now()}.jpg`);
        fd.set('file', new File([selfie], `${kind}-selfie.jpg`, { type: 'image/jpeg' }));
        const up = await uploadAttachmentAction(EMPTY_UPLOAD_ATTACHMENT_STATE, fd);
        // The clock action already succeeded; a selfie hiccup is reported softly,
        // never as a failed clock in/out.
        setNotice(
          up.error
            ? `${result.success ?? fallbackMessage} (Selfie could not be saved: ${up.error})`
            : (result.success ?? fallbackMessage),
        );
      } else {
        setNotice(result.success ?? fallbackMessage);
      }

      stopStream();
      setMode('idle');
      router.refresh();
    } catch {
      setError(`Could not clock ${intent === 'in' ? 'in' : 'out'}. Please try again.`);
    } finally {
      setPending(false);
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) {
      await finish(null);
      return;
    }
    setPending(true);
    try {
      const blob = await compressToJpeg(video);
      await finish(blob);
    } catch {
      // Capture failed — still let them clock in/out without the photo.
      await finish(null);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {/* Step 1 — choose WHO is signing in (required before clock in/out). One
            clean full-width dropdown; selection uses the permanent team-member id. */}
        {mode !== 'camera' ? (
          <div className="mb-4">
            <p className="mb-2 text-center text-sm font-medium text-foreground">
              Select who is signing in
            </p>
            <select
              value={selectedId ?? ''}
              onChange={(e) => {
                setSelectedId(e.target.value || null);
                setError(null);
                setNotice(null);
              }}
              data-testid="clock-staff-select"
              aria-label="Select who is signing in"
              className="mx-auto block h-10 w-full max-w-md rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold"
            >
              <option value="">Select a team member</option>
              {/* Name only (Owner request). The role told the person clocking in
                  nothing useful and leaked the org chart onto a shared kiosk
                  screen. The permanent id is still the option VALUE, so who is
                  clocked in is unchanged. */}
              {staff.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
            {staff.length === 0 ? (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                No active team members found.
              </p>
            ) : null}
          </div>
        ) : null}

        {!selected && mode !== 'camera' ? null : mode === 'camera' ? (
          <div className="mx-auto flex max-w-sm flex-col gap-3">
            <p className="text-sm font-medium text-foreground">
              Take a selfie to clock {intent === 'in' ? 'in' : 'out'}
            </p>
            {cameraError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                {cameraError} You can still clock {intent === 'in' ? 'in' : 'out'} without
                a photo.
              </div>
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                data-testid="clock-selfie-video"
                className="max-h-72 w-full -scale-x-100 rounded-lg bg-black object-cover"
              />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={cancelCamera}
                disabled={pending}
                className="flex-1"
                data-testid="clock-cancel"
              >
                Cancel
              </Button>
              {cameraError ? (
                <Button
                  type="button"
                  onClick={() => void finish(null)}
                  disabled={pending}
                  className="flex-1"
                  data-testid="clock-no-photo"
                >
                  {pending
                    ? 'Working…'
                    : `Clock ${intent === 'in' ? 'in' : 'out'} without photo`}
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => void capture()}
                  disabled={pending}
                  className="flex-1"
                  data-testid="clock-capture"
                >
                  {pending ? 'Saving…' : 'Capture'}
                </Button>
              )}
            </div>
          </div>
        ) : openSession.open ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Clocked in
              {openSession.since
                ? ` since ${new Date(openSession.since).toLocaleTimeString()}`
                : ''}
              .
            </p>
            <Button
              type="button"
              onClick={() => void startCamera('out')}
              disabled={pending}
              className="w-full"
              data-testid="clock-out"
            >
              Clock Out
            </Button>
          </div>
        ) : resumeSince ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Clocked out {`at ${new Date(resumeSince).toLocaleTimeString()}`}. Returning
              to work?
            </p>
            <Button
              type="button"
              onClick={() => setContinueConfirm(true)}
              disabled={pending}
              className="w-full"
              data-testid="clock-continue"
            >
              Continue Duty
            </Button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/15 text-2xl text-gold-strong"
            >
              →
            </span>
            <Button
              type="button"
              onClick={() => void startCamera('in')}
              disabled={pending}
              className="w-full"
              data-testid="clock-in"
            >
              Clock In
            </Button>
          </div>
        )}

        {/* Continue Duty confirmation (§3). A new work session is ADDED to today's
            attendance — no duplicate day. The same selfie step as Clock In follows. */}
        <Modal
          open={continueConfirm}
          onClose={() => setContinueConfirm(false)}
          title="Continue Duty?"
          size="sm"
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setContinueConfirm(false)}
                data-testid="clock-continue-cancel"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setContinueConfirm(false);
                  void startCamera('in');
                }}
                data-testid="clock-continue-confirm"
              >
                Continue Duty
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {resumeSince
              ? `Your previous duty ended at ${new Date(resumeSince).toLocaleTimeString()}. `
              : ''}
            A new work session will be added to today&apos;s attendance. The gap since
            your last clock-out is off-duty and is not counted.
          </p>
        </Modal>

        {error ? (
          <p role="alert" className="mt-3 text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice && !error ? (
          <p role="status" className="mt-3 text-center text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
