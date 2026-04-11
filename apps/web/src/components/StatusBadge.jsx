const classes = {
  'Pending Index': 'bg-sand text-ink',
  'Pending Acceptance': 'bg-amber-100 text-amber-800',
  'Acceptance Timed Out': 'bg-amber-100 text-amber-800',
  'Open For Join': 'bg-coral/10 text-coral',
  Active: 'bg-mint/20 text-emerald-700',
  'Declaration Open': 'bg-indigo-100 text-indigo-800',
  'Result Submitted': 'bg-indigo-100 text-indigo-800',
  'Review Period': 'bg-amber-100 text-amber-800',
  'Ready To Finalize': 'bg-mint/20 text-emerald-700',
  'Needs Dispute': 'bg-rose-100 text-rose-700',
  'Settlement Due': 'bg-rose-100 text-rose-700',
  Disputed: 'bg-rose-100 text-rose-700',
  Completed: 'bg-ink text-sand',
  'Split Completed': 'bg-ink text-sand',
  Cancelled: 'bg-slate/10 text-slate'
};

const labels = {
  'Result Submitted': 'Single Declaration',
  'Review Period': 'Review Period',
  'Ready To Finalize': 'Matched Result',
  'Needs Dispute': 'Conflicting Results',
  'Settlement Due': 'Auto Settlement'
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${classes[status] || 'bg-slate/10 text-slate'}`}>
      {labels[status] || status}
    </span>
  );
}
