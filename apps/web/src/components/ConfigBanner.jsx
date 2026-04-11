import { getMissingContractConfig } from '../lib/contracts.js';

export default function ConfigBanner() {
  const missing = getMissingContractConfig();

  if (missing.length) {
    return (
      <div className="rounded-[24px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Contract config missing</p>
        <p className="mt-2">Add these env vars in `apps/web/.env` before on-chain reads and writes can work:</p>
        <p className="mt-2 font-mono text-xs">{missing.join(', ')}</p>
      </div>
    );
  }

  return null;
}
