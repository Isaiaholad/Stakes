import { MessageSquare, RefreshCcw, Send } from 'lucide-react';
import { formatDateTime, formatRelative } from '../../lib/formatters.js';

export default function PactChatCard({
  address,
  comments,
  commentsQuery,
  chatAccessMessage,
  canCurrentWalletChat,
  requiresParticipantAccess,
  commentDraft,
  setCommentDraft,
  maxCommentLength,
  canPostComment,
  handleCommentSubmit,
  postCommentMutation,
  formatParticipant,
  now
}) {
  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-coral" />
        <p className="font-display text-2xl text-ink">Pact chat</p>
      </div>

      <div className="mt-4 rounded-[22px] border border-slate/10 bg-sand/55 px-4 py-4 text-sm text-slate/75">
        <p className="font-semibold text-ink">Chat access</p>
        <p className="mt-1">{chatAccessMessage}</p>
      </div>

      {requiresParticipantAccess ? (
        <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          This shared thread is restricted to pact participants and arbiters.
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {commentsQuery.isLoading && !comments.length ? (
          <div className="rounded-[22px] border border-dashed border-slate/15 bg-sand/40 px-4 py-6 text-sm text-slate/65">
            Loading shared pact messages...
          </div>
        ) : comments.length ? (
          comments.map((comment) => {
            const isMine = address && comment.authorAddress?.toLowerCase() === address.toLowerCase();

            return (
              <div
                key={comment.id}
                className={`rounded-[22px] border px-4 py-4 ${
                  isMine ? 'border-coral/20 bg-coral/10' : 'border-slate/10 bg-sand/65'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">
                    {isMine ? 'You' : formatParticipant(comment.authorAddress)}
                  </p>
                  <p className="text-xs text-slate/55" title={formatDateTime(comment.createdAt)}>
                    {formatRelative(comment.createdAt, now)}
                  </p>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate/80">{comment.message}</p>
              </div>
            );
          })
        ) : (
          <div className="rounded-[22px] border border-dashed border-slate/15 bg-sand/40 px-4 py-6 text-sm text-slate/65">
            No shared messages yet. Use this thread to coordinate the match or leave a ruling note.
          </div>
        )}
      </div>

      {commentsQuery.error ? (
        <div className="mt-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <div className="flex items-center justify-between gap-3">
            <p>Shared pact chat could not refresh right now.</p>
            <button
              type="button"
              onClick={() => commentsQuery.refetch()}
              className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-ink"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleCommentSubmit} className="mt-4">
        <textarea
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value.slice(0, maxCommentLength))}
          placeholder={
            !address
              ? 'Connect a wallet to post a shared message.'
              : !canCurrentWalletChat
                ? 'Only participants and arbiters can post in this pact thread.'
                : 'Add a shared comment for this pact...'
          }
          disabled={!address || !canCurrentWalletChat}
          rows={4}
          className="w-full rounded-[24px] border border-slate/10 bg-sand px-4 py-4 outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-slate/55">
            {commentDraft.length}/{maxCommentLength} characters
          </p>
          <button
            type="submit"
            disabled={!canPostComment || postCommentMutation.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {postCommentMutation.isPending ? 'Posting...' : 'Post message'}
          </button>
        </div>
      </form>
    </section>
  );
}
