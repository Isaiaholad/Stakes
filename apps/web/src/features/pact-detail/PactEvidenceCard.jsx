import { ExternalLink, Gavel, RefreshCcw, Upload } from 'lucide-react';
import { formatDateTime, formatRelative } from '../../lib/formatters.js';

function formatBytes(sizeBytes) {
  const value = Number(sizeBytes || 0);
  if (!value) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let currentValue = value;
  let index = 0;
  while (currentValue >= 1024 && index < units.length - 1) {
    currentValue /= 1024;
    index += 1;
  }

  return `${currentValue.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

const uploadStatusShell = {
  uploading: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  uploaded: 'border-emerald-200 bg-mint/16 text-emerald-900',
  failed: 'border-rose-200 bg-rose-50 text-rose-950'
};

export default function PactEvidenceCard({
  pact,
  catboxUploadConfigured,
  disputeEvidenceDraft,
  setDisputeEvidenceDraft,
  pendingEvidenceFile,
  setPendingEvidenceFile,
  evidenceUploads,
  evidenceHistory,
  currentUserStoredEvidenceLinks = [],
  evidenceHistoryQuery,
  uploadDisputeFileMutation,
  disputeEvidenceMutation,
  handleEvidenceSubmit,
  now
}) {
  const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || ''));

  if (pact.rawStatus !== 'Disputed') {
    return null;
  }

  return (
    <section className="rounded-[32px] border border-rose-200 bg-rose-50 p-5 shadow-glow">
      <div className="flex items-center gap-2">
        <Gavel className="h-5 w-5 text-rose-700" />
        <p className="font-display text-2xl text-ink">Dispute evidence</p>
      </div>
      <p className="mt-2 text-sm text-slate/70">
        Add proof for the arbiter to review.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[22px] border border-rose-100 bg-white px-4 py-3 text-sm text-slate/75">
          <p className="font-semibold text-ink">Creator proof status</p>
          <p className="mt-1">
            {pact.creatorEvidenceOnChain
              ? 'On-chain proof submitted'
              : pact.creatorEvidence
                ? 'File uploaded, proof not on-chain yet'
                : 'No proof submitted yet.'}
          </p>
        </div>
        <div className="rounded-[22px] border border-rose-100 bg-white px-4 py-3 text-sm text-slate/75">
          <p className="font-semibold text-ink">Counterparty proof status</p>
          <p className="mt-1">
            {pact.counterpartyEvidenceOnChain
              ? 'On-chain proof submitted'
              : pact.counterpartyEvidence
                ? 'File uploaded, proof not on-chain yet'
                : 'No proof submitted yet.'}
          </p>
        </div>
      </div>

      {pact.canSubmitEvidence ? (
        <form onSubmit={handleEvidenceSubmit} className="mt-4">
          <div className="rounded-[22px] border border-rose-200 bg-white px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">Upload proof</p>
                <p className="mt-1 text-xs text-slate/60">
                  Add screenshots or short videos that help explain what happened.
                </p>
              </div>
              <Upload className="h-5 w-5 text-rose-600" />
            </div>

            {catboxUploadConfigured ? (
              <>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => setPendingEvidenceFile(event.target.files?.[0] || null)}
                  className="mt-4 block w-full text-sm text-slate/70 file:mr-4 file:rounded-full file:border-0 file:bg-rose-100 file:px-4 file:py-2 file:font-semibold file:text-rose-700"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="min-w-0 text-xs text-slate/60">
                    {pendingEvidenceFile
                      ? `${pendingEvidenceFile.name} • ${formatBytes(pendingEvidenceFile.size)}`
                      : 'Images are capped at 1 MB. Videos are capped at 10 MB.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => uploadDisputeFileMutation.mutate()}
                    disabled={uploadDisputeFileMutation.isPending || !pendingEvidenceFile}
                    className="shrink-0 rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {uploadDisputeFileMutation.isPending ? 'Uploading...' : 'Upload file'}
                  </button>
                </div>
                <p className="mt-3 text-xs text-amber-700">
                  Evidence links may be visible to pact participants and arbiters. Do not upload sensitive files unrelated to the dispute.
                </p>
              </>
            ) : (
              <p className="mt-4 text-xs text-amber-700">File upload is not configured yet.</p>
            )}
          </div>

          {evidenceUploads.length ? (
            <div className="mt-4 space-y-3">
              {evidenceUploads.map((upload) => (
                <div
                  key={upload.id}
                  className={`rounded-[22px] border px-4 py-4 text-sm ${uploadStatusShell[upload.status] || uploadStatusShell.uploading}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{upload.name}</p>
                    <p className="text-xs opacity-70">{upload.status}</p>
                  </div>
                  <p className="mt-1 text-xs opacity-75">{formatBytes(upload.sizeBytes)}</p>
                  {upload.url ? (
                    <a
                      href={upload.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-2 text-xs font-semibold underline underline-offset-4"
                    >
                      Open file link
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                  {upload.error ? <p className="mt-2 text-xs">{upload.error}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {currentUserStoredEvidenceLinks.length ? (
            <p className="mt-3 text-xs text-amber-700">
              {currentUserStoredEvidenceLinks.length} uploaded file link{currentUserStoredEvidenceLinks.length === 1 ? '' : 's'} ready to submit on-chain.
            </p>
          ) : null}

          <textarea
            value={disputeEvidenceDraft}
            onChange={(event) => setDisputeEvidenceDraft(event.target.value)}
            placeholder="Add a short proof summary for the arbiter"
            rows={4}
            className="mt-4 w-full rounded-[22px] border border-rose-200 bg-white px-4 py-4 outline-none"
          />
          <button
            type="submit"
            disabled={
              disputeEvidenceMutation.isPending ||
              (!disputeEvidenceDraft.trim() &&
                !evidenceUploads.some((item) => item.status === 'uploaded') &&
                !currentUserStoredEvidenceLinks.length)
            }
            className="mt-4 w-full rounded-full bg-rose-600 px-5 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {disputeEvidenceMutation.isPending ? 'Submitting proof...' : 'Submit dispute proof'}
          </button>
        </form>
      ) : pact.currentUserOnChainEvidence ? (
        <p className="mt-4 text-sm text-slate/70">You already submitted proof on-chain for this dispute.</p>
      ) : null}

      <div className="mt-5 rounded-[24px] border border-rose-200 bg-white/85 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-ink">Submitted proof and uploads</p>
            <p className="mt-1 text-xs text-slate/60">Proof files and notes attached to this pact.</p>
          </div>
          <button
            type="button"
            onClick={() => evidenceHistoryQuery.refetch()}
            className="inline-flex items-center gap-2 rounded-full bg-sand px-3 py-2 text-xs font-semibold text-ink"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {evidenceHistoryQuery.isLoading && !evidenceHistory.length ? (
            <p className="text-sm text-slate/70">Loading evidence history...</p>
          ) : evidenceHistory.length ? (
            evidenceHistory.map((item) => (
              <div key={`${item.id}-${item.created_at}`} className="rounded-[20px] border border-slate/10 bg-sand/70 px-4 py-4 text-sm text-slate/80">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-ink">{item.original_name || 'Submitted proof'}</p>
                  <p className="text-xs text-slate/55" title={formatDateTime(item.created_at)}>
                    {formatRelative(item.created_at, now)}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate/60">
                  <span>Uploader: {item.participant_address}</span>
                  <span>Size: {formatBytes(item.size_bytes)}</span>
                </div>
                {isHttpUrl(item.evidence_uri) ? (
                  <a
                    href={item.evidence_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-2 font-semibold text-ink underline underline-offset-4"
                  >
                    Open evidence link
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate/70">{item.evidence_uri}</p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-slate/70">No evidence uploads recorded for this pact yet.</p>
          )}
          {evidenceHistoryQuery.error ? (
            <p className="text-sm text-amber-700">Submitted proof could not refresh right now.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
