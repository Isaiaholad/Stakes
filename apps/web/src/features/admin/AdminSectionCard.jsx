export default function AdminSectionCard({ title, body, children }) {
  return (
    <section className="rounded-[32px] bg-white/80 p-5 shadow-glow">
      <div>
        <p className="font-display text-2xl text-ink">{title}</p>
        <p className="text-sm text-slate/70">{body}</p>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}
