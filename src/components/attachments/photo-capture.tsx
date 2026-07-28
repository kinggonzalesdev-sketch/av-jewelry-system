'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';

import { uploadAttachmentAction } from '@/lib/attachments/actions';
import {
  ATTACHMENT_MAX_BYTES,
  attachmentErrorMessage,
  classifyMediaError,
  COMPRESS_QUALITY,
  humanFileSize,
  isAllowedContentType,
  targetDimensions,
  type AttachmentErrorKind,
} from '@/lib/attachments/image';
import {
  EMPTY_UPLOAD_ATTACHMENT_STATE,
  type AttachmentPurpose,
  type RelatedEntityType,
  type UploadAttachmentState,
} from '@/lib/attachments/types';

/**
 * PhotoCapture — the real camera + file attachment control (Part B).
 *
 * Honest by construction:
 *   - The rear camera is opened where supported; every failure maps to a SPECIFIC
 *     message (permission denied, no camera, unsupported browser) and always
 *     leaves the file-picker fallback available. Desktop users use the fallback.
 *   - The image is compressed/resized on-device before upload.
 *   - Upload goes through the RLS-scoped server action; the browser never holds a
 *     storage key. Progress and a clear success/failure are shown — success is
 *     only claimed when the server confirms the row was written.
 *
 * The media/canvas calls need a real browser + secure context; the pure pieces
 * (resize math, validation, error wording) live in `@/lib/attachments/image` and
 * are unit-tested there.
 */

type Prepared = {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  source: 'camera' | 'file_upload';
};

async function compressToBlob(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = targetDimensions(naturalWidth, naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-2d-context');
  ctx.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', COMPRESS_QUALITY),
  );
  if (!blob) throw new Error('encode-failed');
  return { blob, width, height };
}

export function PhotoCapture({
  relatedEntityType,
  relatedEntityId,
  purpose = 'photo',
  label = 'Attach photo',
  onUploaded,
}: {
  relatedEntityType: RelatedEntityType;
  relatedEntityId: string;
  purpose?: AttachmentPurpose;
  label?: string;
  onUploaded?: (attachment: NonNullable<UploadAttachmentState['attachment']>) => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    uploadAttachmentAction,
    EMPTY_UPLOAD_ATTACHMENT_STATE,
  );

  const [mode, setMode] = useState<'idle' | 'camera' | 'preview'>('idle');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [localError, setLocalError] = useState<AttachmentErrorKind | null>(null);
  // Rear ('environment') by default; a Switch camera button flips to the front.
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  // Bumped each time a new stream is opened so the attach effect re-runs (initial
  // open AND camera switch), re-binding the live stream to the <video>.
  const [streamTick, setStreamTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cameraSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function reset() {
    stopStream();
    if (prepared) URL.revokeObjectURL(prepared.url);
    setPrepared(null);
    setLocalError(null);
    setMode('idle');
  }

  // Stop the camera if the component unmounts mid-capture.
  useEffect(() => () => stopStream(), []);

  // Bind the live stream to the <video> AFTER it is mounted in camera mode. Doing
  // this in an effect (not a microtask) guarantees the element exists — the earlier
  // microtask could run before React committed the <video>, which left the preview
  // black. Re-runs on every new stream (initial open and camera switch).
  useEffect(() => {
    if (mode !== 'camera') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [mode, streamTick]);

  // When the server confirms the upload, bubble it up and return to idle.
  useEffect(() => {
    if (state.attachment) {
      onUploaded?.(state.attachment);
      // Responding to a server-action result is a valid effect: clear the local
      // capture state and re-fetch the server component so the new attachment
      // appears. This runs once per successful upload.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reset();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.attachment]);

  async function startCamera(facing: 'environment' | 'user' = facingMode) {
    setLocalError(null);
    if (!cameraSupported) {
      setLocalError('unsupported_browser');
      return;
    }
    // Release any current stream before opening a new one (e.g. on camera switch).
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: false,
      });
      streamRef.current = stream;
      setStreamTick((n) => n + 1); // the attach effect binds it to the <video>
      setMode('camera');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : 'unknown';
      setLocalError(classifyMediaError(name));
    }
  }

  // Flip between the rear and front camera and reopen the stream.
  async function switchCamera() {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    await startCamera(next);
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    try {
      const out = await compressToBlob(video, video.videoWidth, video.videoHeight);
      stopStream();
      setPrepared({
        blob: out.blob,
        url: URL.createObjectURL(out.blob),
        width: out.width,
        height: out.height,
        source: 'camera',
      });
      setMode('preview');
    } catch {
      setLocalError('unknown');
    }
  }

  async function onFilePicked(file: File) {
    setLocalError(null);
    if (!isAllowedContentType(file.type)) {
      setLocalError('invalid_type');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setLocalError('file_too_large');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const out = await compressToBlob(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      setPrepared({
        blob: out.blob,
        url: URL.createObjectURL(out.blob),
        width: out.width,
        height: out.height,
        source: 'file_upload',
      });
      setMode('preview');
    } catch {
      setLocalError('unknown');
    }
  }

  function confirmUpload() {
    if (!prepared) return;
    const fd = new FormData();
    fd.set('relatedEntityType', relatedEntityType);
    fd.set('relatedEntityId', relatedEntityId);
    fd.set('purpose', purpose);
    fd.set('source', prepared.source);
    fd.set('width', String(prepared.width));
    fd.set('height', String(prepared.height));
    fd.set('fileName', `${purpose}-${Date.now()}.jpg`);
    fd.set('file', new File([prepared.blob], `${purpose}.jpg`, { type: 'image/jpeg' }));
    formAction(fd);
  }

  const shownError = localError ? attachmentErrorMessage(localError) : state.error;

  return (
    <div
      className="rounded-xl border border-border bg-card p-3"
      data-testid="photo-capture"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {pending ? (
          <span
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground"
          >
            Uploading…
          </span>
        ) : null}
      </div>

      {/* IDLE: the two entry points. File fallback is ALWAYS available. */}
      {mode === 'idle' ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={pending}
            data-testid="photo-take"
            className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-gold/90 disabled:opacity-50"
          >
            <span aria-hidden="true">▣</span> Take Photo
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            data-testid="photo-choose"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Choose file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
            data-testid="photo-file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFilePicked(f);
              e.target.value = ''; // allow re-picking the same file
            }}
          />
        </div>
      ) : null}

      {/* CAMERA: live preview (tap to capture) + capture / switch / cancel. */}
      {mode === 'camera' ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void capturePhoto()}
            title="Tap the preview to capture"
            aria-label="Capture photo"
            className="block w-full cursor-pointer overflow-hidden rounded-lg"
          >
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="max-h-72 w-full rounded-lg bg-black object-contain"
              data-testid="photo-video"
            />
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void capturePhoto()}
              data-testid="photo-capture-btn"
              className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-black hover:bg-gold/90"
            >
              <span aria-hidden="true">◉</span> Capture
            </button>
            <button
              type="button"
              onClick={() => void switchCamera()}
              data-testid="photo-switch"
              title="Switch between the rear and front camera"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span aria-hidden="true">⟳</span> Switch camera
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* PREVIEW: retake / confirm / cancel before anything is uploaded. */}
      {mode === 'preview' && prepared ? (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={prepared.url}
            alt="Attachment preview"
            className="max-h-72 w-full rounded-lg object-contain"
            data-testid="photo-preview"
          />
          <p className="text-xs text-muted-foreground">
            {prepared.width}×{prepared.height} · {humanFileSize(prepared.blob.size)} ·{' '}
            {prepared.source === 'camera' ? 'Camera' : 'File upload'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmUpload}
              disabled={pending}
              data-testid="photo-confirm"
              className="rounded-md bg-gold px-3 py-2 text-sm font-semibold text-black hover:bg-gold/90 disabled:opacity-50"
            >
              {pending ? 'Uploading…' : 'Confirm & upload'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (prepared) URL.revokeObjectURL(prepared.url);
                setPrepared(null);
                setLocalError(null);
                setMode('idle');
              }}
              disabled={pending}
              data-testid="photo-retake"
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {shownError ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <p role="alert" className="text-xs text-destructive">
            {shownError}
          </p>
          <button
            type="button"
            onClick={() => {
              setLocalError(null);
              if (prepared) confirmUpload();
            }}
            className="shrink-0 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
            data-testid="photo-retry"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.success && !state.error ? (
        <p className="mt-2 text-xs text-muted-foreground">{state.success}</p>
      ) : null}
    </div>
  );
}
