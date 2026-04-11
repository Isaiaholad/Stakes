import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <p className="font-display text-3xl text-ink">Page not found</p>
      <p className="mt-2 text-sm text-slate/70">The app screen you’re looking for doesn’t exist anymore.</p>
      <Link to="/" className="mt-4 inline-flex rounded-full bg-ink px-4 py-3 text-sm font-semibold text-sand">
        Back home
      </Link>
    </section>
  );
}
