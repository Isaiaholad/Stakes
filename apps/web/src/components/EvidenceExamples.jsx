const evidenceExamples = [
  {
    title: 'eFootball final score',
    game: 'eFootball',
    src: '/media/examples/efootball-result-example.jpg',
    alt: 'Redacted eFootball final score example showing a clear full-time result',
    note: 'Final score and full-time state are visible.'
  }
];

export default function EvidenceExamples({
  title = 'Good screenshot examples',
  description = 'Upload result screens where the score, winner, and final state are easy to read.',
  compact = false,
  className = ''
}) {
  return (
    <section className={`rounded-[24px] border border-slate/10 bg-white/85 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{title}</p>
          <p className="mt-1 text-xs leading-5 text-slate/65">{description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-mint/20 px-3 py-1 text-[11px] font-semibold text-emerald-800">
          AI ready
        </span>
      </div>

      <div className={`mt-3 grid gap-3 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {evidenceExamples.map((example) => (
          <article key={example.src} className="overflow-hidden rounded-[18px] border border-slate/10 bg-ink text-sand">
            <div className="flex items-center justify-between px-3 py-2 text-xs">
              <span className="font-semibold">{example.title}</span>
              <span className="text-sand/60">{example.game}</span>
            </div>
            <img
              src={example.src}
              alt={example.alt}
              loading="lazy"
              className={`w-full bg-black object-contain ${compact ? 'max-h-44' : 'max-h-72'}`}
            />
            <p className="px-3 py-2 text-[11px] leading-4 text-sand/70">{example.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
