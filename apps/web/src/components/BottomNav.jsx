import { Compass, Home, PlusSquare, Wallet } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/create', label: 'Create', icon: PlusSquare },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/vault', label: 'Vault', icon: Wallet }
];

export default function BottomNav() {
  return (
    <nav className="fixed bottom-4 left-1/2 z-20 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center justify-around rounded-full border border-white/70 bg-white/90 px-2 py-2 shadow-glow backdrop-blur">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center rounded-full px-3 py-2 text-xs font-medium transition ${
              isActive ? 'bg-ink text-sand' : 'text-slate/70'
            }`
          }
        >
          <Icon className="mb-1 h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
