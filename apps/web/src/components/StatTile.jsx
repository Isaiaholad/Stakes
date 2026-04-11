export default function StatTile({ label, value, accent = 'bg-ink text-sand' }) {
  return (
    <div className={`rounded-[24px] p-4 ${accent}`}>
      <p className="text-xs uppercase tracking-[0.24em] opacity-70">{label}</p>
      <p className="mt-3 font-display text-3xl">{value}</p>
    </div>
  );
}
