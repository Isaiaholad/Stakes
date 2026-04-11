export default function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-[28px] border border-dashed border-slate/20 bg-white/70 p-6 text-center">
      <p className="font-display text-2xl text-ink">{title}</p>
      {body ? <p className="mt-2 text-sm text-slate/70">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
