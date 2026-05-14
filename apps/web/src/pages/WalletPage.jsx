import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import ConnectionStatusCard from '../components/ConnectionStatusCard.jsx';
import ConfigBanner from '../components/ConfigBanner.jsx';
import ConnectCard from '../components/ConnectCard.jsx';
import ReadStatusNote from '../components/ReadStatusNote.jsx';
import { hasUsernameRegistryConfigured, isProtocolConfigured } from '../lib/contracts.js';
import { circleFaucetUrl } from '../lib/externalLinks.js';
import { formatToken } from '../lib/formatters.js';
import {
  approveVault,
  clearUsername,
  depositToVault,
  isValidUsername,
  normalizeUsername,
  readUsernameByAddress,
  readVaultSnapshot,
  setUsername,
  withdrawFromVault
} from '../lib/pacts.js';
import { useToastStore } from '../store/useToastStore.js';
import { useWalletStore } from '../store/useWalletStore.js';
import { buildTransactionToast } from '../lib/transactions.js';
import { parseUnits } from 'viem';

function parseTokenUnits(value, decimals) {
  try {
    return {
      units: parseUnits(String(value || '0'), decimals),
      valid: true
    };
  } catch {
    return {
      units: 0n,
      valid: false
    };
  }
}

export default function WalletPage() {
  const queryClient = useQueryClient();
  const address = useWalletStore((state) => state.address);
  const configured = isProtocolConfigured();
  const usernameRegistryConfigured = hasUsernameRegistryConfigured();
  const showToast = useToastStore((state) => state.showToast);
  const [depositAmount, setDepositAmount] = useState('10');
  const [depositFlowStep, setDepositFlowStep] = useState('idle');
  const [withdrawAmount, setWithdrawAmount] = useState('10');
  const [usernameInput, setUsernameInput] = useState('');

  const query = useQuery({
    queryKey: ['vault', address],
    queryFn: () => readVaultSnapshot(address),
    enabled: Boolean(address) && configured,
    refetchInterval: 60_000
  });

  const usernameQuery = useQuery({
    queryKey: ['username', address],
    queryFn: () => readUsernameByAddress(address),
    enabled: Boolean(address) && configured && usernameRegistryConfigured,
    refetchInterval: 60_000
  });

  useEffect(() => {
    if (typeof usernameQuery.data === 'string') {
      setUsernameInput(usernameQuery.data);
    }
  }, [usernameQuery.data]);

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (!query.data) {
        throw new Error('Vault balances are still loading. Try the deposit again in a moment.');
      }

      let approvalReceipt = null;

      if (depositNeedsApproval) {
        setDepositFlowStep('approving');
        approvalReceipt = await approveVault(address);
      }

      setDepositFlowStep('depositing');

      try {
        const depositReceipt = await depositToVault(address, depositAmount, query.data.decimals);
        return {
          approvalReceipt,
          depositReceipt
        };
      } catch (error) {
        const wrappedError = new Error(error?.message || 'Deposit failed.');
        wrappedError.approvalCompleted = Boolean(approvalReceipt);
        throw wrappedError;
      }
    },
    onSuccess: async ({ approvalReceipt, depositReceipt }) => {
      setDepositFlowStep('idle');
      await queryClient.invalidateQueries({ queryKey: ['vault', address] });
      showToast({
        variant: 'success',
        title: approvalReceipt ? 'Approval and deposit confirmed' : 'Deposit confirmed',
        ...buildTransactionToast(depositReceipt, {
          message: approvalReceipt
            ? 'Vault access was approved and your deposit completed.'
            : 'Your vault deposit is confirmed.'
        })
      });
    },
    onError: async (error) => {
      setDepositFlowStep('idle');
      if (error?.approvalCompleted) {
        await queryClient.invalidateQueries({ queryKey: ['vault', address] });
        showToast({
          variant: 'info',
          title: 'Approval completed, deposit still pending',
          message:
            'Vault access was approved, but the deposit did not finish. Try the same deposit again and you should not need to approve twice.'
        });
        return;
      }

      showToast({
        variant: 'error',
        title: 'Deposit failed',
        message: error.message
      });
    },
    onSettled: () => {
      setDepositFlowStep('idle');
    }
  });

  const withdrawMutation = useMutation({
    mutationFn: () => withdrawFromVault(address, withdrawAmount, query.data.decimals),
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries({ queryKey: ['vault', address] });
      showToast({
        variant: 'success',
        title: 'Withdrawal confirmed',
        ...buildTransactionToast(receipt, {
          message: 'Your vault withdrawal is confirmed.'
        })
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: 'Withdrawal failed',
        message: error.message
      });
    }
  });

  const setUsernameMutation = useMutation({
    mutationFn: () => setUsername(address, usernameInput),
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries({ queryKey: ['username', address] });
      showToast({
        variant: 'success',
        title: 'Username saved',
        ...buildTransactionToast(receipt, {
          message: 'Your username was saved on-chain.'
        })
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: 'Username failed',
        message: error.message
      });
    }
  });

  const clearUsernameMutation = useMutation({
    mutationFn: () => clearUsername(address),
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries({ queryKey: ['username', address] });
      showToast({
        variant: 'success',
        title: 'Username cleared',
        ...buildTransactionToast(receipt, {
          message: 'Your username was cleared on-chain.'
        })
      });
    },
    onError: (error) => {
      showToast({
        variant: 'error',
        title: 'Clear username failed',
        message: error.message
      });
    }
  });

  const depositValue = Number(depositAmount || 0);
  const withdrawValue = Number(withdrawAmount || 0);
  const walletBalance = Number(query.data?.walletBalance || 0);
  const availableBalance = Number(query.data?.availableBalance || 0);
  const decimals = Number(query.data?.decimals || 6);
  const tokenStep = decimals > 0 ? `0.${'0'.repeat(Math.max(decimals - 1, 0))}1` : '1';
  const depositParse = depositAmount && query.data ? parseTokenUnits(depositAmount || '0', decimals) : { units: 0n, valid: true };
  const rawAllowance = query.data?.allowance ?? 0n;
  const depositNeedsApproval = query.data ? BigInt(rawAllowance || 0) < depositParse.units : true;
  const depositButtonLabel = depositMutation.isPending
    ? depositFlowStep === 'approving'
      ? 'Approving vault access...'
      : 'Depositing...'
    : depositNeedsApproval
      ? 'Approve + deposit stablecoin'
      : 'Deposit stablecoin';
  const normalizedUsername = normalizeUsername(usernameInput);

  let depositValidationError = '';
  if (!depositValue || depositValue <= 0) {
    depositValidationError = 'Enter a deposit amount greater than zero.';
  } else if (!depositParse.valid) {
    depositValidationError = `Use no more than ${decimals} decimal places for ${query.data?.symbol || 'USDC'}.`;
  } else if (depositValue > walletBalance) {
    depositValidationError = 'Deposit amount is higher than your wallet balance.';
  }

  let withdrawValidationError = '';
  if (!withdrawValue || withdrawValue <= 0) {
    withdrawValidationError = 'Enter a withdrawal amount greater than zero.';
  } else if (withdrawValue > availableBalance) {
    withdrawValidationError = 'Withdrawal amount is higher than your available vault balance.';
  }

  let usernameValidationError = '';
  if (usernameRegistryConfigured && usernameInput && !isValidUsername(usernameInput)) {
    usernameValidationError = 'Username must use 3-20 lowercase letters, numbers, or underscores.';
  }

  if (!configured) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <ConnectCard compact />
      </div>
    );
  }

  if (query.isLoading && !query.data) {
    return <div className="py-12 text-sm text-slate/70">Loading vault balances...</div>;
  }

  if (query.error && !query.data) {
    return (
      <div className="space-y-5">
        <ConfigBanner />
        <ConnectionStatusCard
          error={query.error}
          fallbackTitle="Could not load vault data"
          onRetry={() => query.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ConfigBanner />
      <ReadStatusNote query={query} label="Vault balances" />
      <section className="rounded-[32px] bg-ink p-5 text-sand shadow-glow">
        <p className="text-xs uppercase tracking-[0.24em] text-sand/60">Pact vault</p>
        <p className="mt-3 font-display text-5xl">{formatToken(query.data.availableBalance, query.data.symbol)}</p>
        <p className="mt-3 text-sm text-sand/70">
          Reserved: {formatToken(query.data.reservedBalance, query.data.symbol)} | Wallet: {formatToken(query.data.walletBalance, query.data.symbol)}
        </p>
        <a
          href={circleFaucetUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-sand px-4 py-2 text-sm font-semibold text-ink"
        >
          Get testnet USDC
          <ExternalLink className="h-4 w-4" />
        </a>
      </section>

      <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
        <p className="font-display text-2xl text-ink">Deposit into the vault</p>
        <input
          type="number"
          min={tokenStep}
          step={tokenStep}
          value={depositAmount}
          onChange={(event) => setDepositAmount(event.target.value)}
          className="mt-4 w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
        />
        <p className="mt-2 text-xs text-slate/60">
          Supports decimal {query.data.symbol} amounts up to {decimals} places.
        </p>
        <button
          type="button"
          onClick={() => depositMutation.mutate()}
          disabled={depositMutation.isPending || Boolean(depositValidationError)}
          className="mt-4 w-full rounded-full bg-coral px-5 py-4 text-base font-semibold text-white"
        >
          {depositButtonLabel}
        </button>
        {!depositValidationError && depositNeedsApproval ? (
          <p className="mt-2 text-xs text-slate/60">
            First-time deposits need two wallet confirmations: one for approval, then one for the deposit itself.
          </p>
        ) : null}
        {depositValidationError ? (
          <div className="mt-3 space-y-2 text-sm text-amber-700">
            <p>{depositValidationError}</p>
            {depositValue > walletBalance ? (
              <a
                href={circleFaucetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
              >
                Get Arc Testnet USDC from Circle faucet
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
        <p className="font-display text-2xl text-ink">Withdraw available balance</p>
        <input
          type="number"
          min={tokenStep}
          step={tokenStep}
          value={withdrawAmount}
          onChange={(event) => setWithdrawAmount(event.target.value)}
          className="mt-4 w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
        />
        <button
          type="button"
          onClick={() => withdrawMutation.mutate()}
          disabled={withdrawMutation.isPending || Boolean(withdrawValidationError)}
          className="mt-4 w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand"
        >
          {withdrawMutation.isPending ? 'Withdrawing...' : 'Withdraw from vault'}
        </button>
        {withdrawValidationError ? <p className="mt-3 text-sm text-amber-700">{withdrawValidationError}</p> : null}
      </section>

      <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
        <p className="font-display text-2xl text-ink">Username</p>
        <p className="mt-2 text-sm text-slate/70">
          Claim a username so friends can invite you with `@name` instead of a wallet address.
        </p>
        {usernameRegistryConfigured ? (
          <>
            <div className="mt-4 rounded-[24px] bg-sand/70 p-4 text-sm text-slate/75">
              <p>
                <strong>Current username:</strong> {usernameQuery.data ? `@${usernameQuery.data}` : 'None yet'}
              </p>
            </div>
            <input
              value={usernameInput}
              onChange={(event) => setUsernameInput(normalizeUsername(event.target.value))}
              placeholder="your_name"
              className="mt-4 w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
            />
            <p className="mt-2 text-xs text-slate/60">
              Lowercase only. Use 3-20 letters, numbers, or underscores. Your username will be saved on-chain as @{normalizedUsername || 'your_name'}.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setUsernameMutation.mutate()}
                disabled={setUsernameMutation.isPending || Boolean(usernameValidationError) || !normalizedUsername}
                className="w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand disabled:cursor-not-allowed disabled:opacity-50"
              >
                {setUsernameMutation.isPending ? 'Saving...' : usernameQuery.data ? 'Update username' : 'Claim username'}
              </button>
              <button
                type="button"
                onClick={() => clearUsernameMutation.mutate()}
                disabled={clearUsernameMutation.isPending || !usernameQuery.data}
                className="w-full rounded-full bg-sand px-5 py-4 text-base font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {clearUsernameMutation.isPending ? 'Clearing...' : 'Clear username'}
              </button>
            </div>
            {usernameValidationError ? <p className="mt-3 text-sm text-amber-700">{usernameValidationError}</p> : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-amber-700">
            Username registry is not configured yet. Add `VITE_USERNAME_REGISTRY_ADDRESS` to enable username invites.
          </p>
        )}
      </section>
    </div>
  );
}
