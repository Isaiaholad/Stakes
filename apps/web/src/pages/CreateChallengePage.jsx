import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Info } from 'lucide-react';
import { parseUnits, zeroAddress } from 'viem';
import ConfigBanner from '../components/ConfigBanner.jsx';
import ConnectCard from '../components/ConnectCard.jsx';
import { hasUsernameRegistryConfigured, isProtocolConfigured } from '../lib/contracts.js';
import { formatDuration, formatToken, shortenAddress } from '../lib/formatters.js';
import {
  createPact,
  isValidUsername,
  normalizeUsername,
  readVaultSnapshot,
  rememberCreatedPactPendingIndex,
  resolveUsernameToAddress
} from '../lib/pacts.js';
import { useWalletStore } from '../store/useWalletStore.js';

const presets = ['Chess Match Pact', 'Football Match Pact', 'Call Of Duty Pact'];
const customPactTypeValue = '__custom__';
const minimumEventDurationMinutes = 5;
const defaultDeclarationWindowMinutes = 20;
const minimumDeclarationWindowMinutes = 5;
const maximumDeclarationWindowMinutes = 60;

function FieldLabel({ children, tip }) {
  return (
    <span className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">
      <span>{children}</span>
      {tip ? (
        <span className="group relative inline-flex">
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-sand text-slate/70"
            aria-label={typeof tip === 'string' ? tip : 'Show field help'}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-64 -translate-x-1/2 rounded-2xl bg-ink px-3 py-2 text-xs font-normal leading-5 text-sand shadow-lg group-hover:block group-focus-within:block">
            {tip}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function hasValidTokenPrecision(value, decimals) {
  try {
    parseUnits(String(value || '0'), decimals);
    return true;
  } catch {
    return false;
  }
}

export default function CreateChallengePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const address = useWalletStore((state) => state.address);
  const configured = isProtocolConfigured();
  const usernameRegistryConfigured = hasUsernameRegistryConfigured();
  const [form, setForm] = useState({
    pactType: presets[0],
    customTitle: '',
    description: '',
    stakeAmount: '10',
    counterparty: '',
    openToPublic: false,
    eventDurationMinutes: String(minimumEventDurationMinutes),
    declarationWindowMinutes: String(defaultDeclarationWindowMinutes)
  });

  const vaultQuery = useQuery({
    queryKey: ['vault', address],
    queryFn: () => readVaultSnapshot(address),
    enabled: Boolean(address) && configured
  });

  const availableBalance = Number(vaultQuery.data?.availableBalance || 0);
  const requestedStake = Number(form.stakeAmount || 0);
  const requestedEventDurationMinutes = Number(form.eventDurationMinutes || 0);
  const requestedDeclarationWindowMinutes = Number(form.declarationWindowMinutes || 0);
  const stablecoinDecimals = Number(vaultQuery.data?.decimals || 6);
  const tokenStep = stablecoinDecimals > 0 ? `0.${'0'.repeat(Math.max(stablecoinDecimals - 1, 0))}1` : '1';
  const resolvedTitle = form.pactType === customPactTypeValue ? form.customTitle.trim() : form.pactType;
  const composedDescription = useMemo(() => String(form.description || '').trim(), [form.description]);
  const eventDurationSeconds = useMemo(() => Math.floor(requestedEventDurationMinutes * 60), [requestedEventDurationMinutes]);
  const declarationWindowSeconds = useMemo(
    () => Math.floor(requestedDeclarationWindowMinutes * 60),
    [requestedDeclarationWindowMinutes]
  );
  const counterpartyValue = form.counterparty.trim();
  const normalizedCounterpartyUsername = normalizeUsername(counterpartyValue);

  const counterpartyLookupQuery = useQuery({
    queryKey: ['username-lookup', normalizedCounterpartyUsername],
    queryFn: () => resolveUsernameToAddress(normalizedCounterpartyUsername),
    enabled:
      configured &&
      usernameRegistryConfigured &&
      !form.openToPublic &&
      Boolean(normalizedCounterpartyUsername) &&
      isValidUsername(normalizedCounterpartyUsername)
  });

  const resolvedCounterpartyAddress = counterpartyLookupQuery.data || zeroAddress;

  let validationError = '';

  if (!requestedStake || requestedStake <= 0) {
    validationError = 'Enter a stake amount greater than zero.';
  } else if (!resolvedTitle) {
    validationError = 'Enter a custom pact type.';
  } else if (!form.openToPublic && !counterpartyValue) {
    validationError = 'Add the counterparty username or switch to an open pact.';
  } else if (!form.openToPublic && !usernameRegistryConfigured) {
    validationError = 'Username invites are unavailable until the username registry is configured.';
  } else if (!form.openToPublic && !isValidUsername(normalizedCounterpartyUsername)) {
    validationError = 'Counterparty username must use 3-20 lowercase letters, numbers, or underscores.';
  } else if (!form.openToPublic && counterpartyLookupQuery.isFetched && resolvedCounterpartyAddress === zeroAddress) {
    validationError = 'Counterparty username was not found. Ask them to claim it from the wallet page first.';
  } else if (
    !form.openToPublic &&
    resolvedCounterpartyAddress !== zeroAddress &&
    resolvedCounterpartyAddress.toLowerCase() === address?.toLowerCase()
  ) {
    validationError = 'You cannot invite your own username.';
  } else if (!Number.isFinite(requestedEventDurationMinutes) || requestedEventDurationMinutes < minimumEventDurationMinutes) {
    validationError = `Event duration must be at least ${minimumEventDurationMinutes} minutes.`;
  } else if (
    !Number.isFinite(requestedDeclarationWindowMinutes) ||
    requestedDeclarationWindowMinutes < minimumDeclarationWindowMinutes ||
    requestedDeclarationWindowMinutes > maximumDeclarationWindowMinutes
  ) {
    validationError = `Declaration window must be between ${minimumDeclarationWindowMinutes} and ${maximumDeclarationWindowMinutes} minutes.`;
  } else if (!hasValidTokenPrecision(form.stakeAmount, stablecoinDecimals)) {
    validationError = `Stake supports up to ${stablecoinDecimals} decimal places.`;
  } else if (requestedStake > availableBalance) {
    validationError = 'Deposit more USDC into the vault before creating this pact.';
  }

  const mutation = useMutation({
    mutationFn: () =>
      createPact(address, {
        title: resolvedTitle,
        description: composedDescription,
        counterparty: form.openToPublic ? '' : resolvedCounterpartyAddress,
        eventDurationSeconds,
        declarationWindowSeconds,
        stakeAmount: form.stakeAmount,
        decimals: vaultQuery.data.decimals
      }),
    onSuccess: async (result) => {
      if (result?.pactId) {
        rememberCreatedPactPendingIndex(queryClient, {
          account: address,
          pactId: result.pactId,
          title: resolvedTitle,
          description: composedDescription,
          counterparty: form.openToPublic ? '' : resolvedCounterpartyAddress,
          eventDurationSeconds,
          declarationWindowSeconds,
          stakeAmount: form.stakeAmount,
          symbol: vaultQuery.data?.symbol || 'USDC'
        });
      }

      await queryClient.invalidateQueries({ queryKey: ['vault', address] });
      navigate(result?.pactId ? `/pact/${result.pactId}` : '/');
    }
  });

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

  return (
    <section className="rounded-[32px] bg-white/85 p-5 shadow-glow">
      <ConfigBanner />
      <p className="text-xs uppercase tracking-[0.24em] text-slate/50">Pact creation</p>
      <h1 className="mt-2 font-display text-3xl text-ink">Create a pact</h1>
      <p className="mt-2 text-sm text-slate/70">
        Your stake must already be in the vault, and creating a pact reserves it immediately.
      </p>
      <div className="mt-4 rounded-[24px] bg-sand/85 p-4 text-sm text-slate/75">
        <p><strong>Available vault balance:</strong> {formatToken(vaultQuery.data?.availableBalance || 0, vaultQuery.data?.symbol || 'USDC')}</p>
        <p className="mt-1"><strong>Pact flow:</strong> fund vault, create, let the other side accept, then declare the result after the event duration runs out.</p>
        <p className="mt-1"><strong>Declaration window:</strong> set how long both sides have to declare after the event ends.</p>
      </div>

      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!validationError) {
            mutation.mutate();
          }
        }}
      >
        <label className="block">
          <FieldLabel tip="Choose the type of challenge this pact is for. You can also enter a custom pact type.">
            Pact type
          </FieldLabel>
          <select
            value={form.pactType}
            onChange={(event) => setForm((current) => ({ ...current, pactType: event.target.value }))}
            className="w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
          >
            {presets.map((preset) => (
              <option key={preset} value={preset}>
                {preset}
              </option>
            ))}
            <option value={customPactTypeValue}>Custom pact type</option>
          </select>
        </label>

        {form.pactType === customPactTypeValue ? (
          <label className="block">
            <FieldLabel tip="Use a custom pact type when the presets do not match your challenge.">
              Custom pact type
            </FieldLabel>
            <input
              value={form.customTitle}
              onChange={(event) => setForm((current) => ({ ...current, customTitle: event.target.value }))}
              placeholder="Enter a custom pact type"
              className="w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none placeholder:text-slate/40"
            />
          </label>
        ) : null}

        <label className="block">
          <FieldLabel tip="Add a short note so both sides understand what the pact covers.">
            Description
          </FieldLabel>
          <textarea
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Winner takes the whole escrow once both declarations match."
            className="min-h-[110px] w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <FieldLabel tip="This is the amount each participant locks into the pact vault.">
              Stake
            </FieldLabel>
            <input
              type="number"
              min={tokenStep}
              step={tokenStep}
              value={form.stakeAmount}
              onChange={(event) => setForm((current) => ({ ...current, stakeAmount: event.target.value }))}
              className="w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
            />
            <p className="mt-2 text-xs text-slate/60">
              Supports decimal {vaultQuery.data?.symbol || 'USDC'} amounts up to {stablecoinDecimals} places.
            </p>
          </label>
          <label className="block">
            <FieldLabel
              tip={
                <>
                  <span className="block">
                    The timing/duration of pact before users can declare themself winner.
                  </span>
                  <span className="mt-1 block">
                    Set this in minutes. The timer starts after acceptance, runs for about {formatDuration(eventDurationSeconds)}, then opens the declaration window.
                  </span>
                </>
              }
            >
              Event duration
            </FieldLabel>
            <input
              type="number"
              min={minimumEventDurationMinutes}
              step="1"
              value={form.eventDurationMinutes}
              onChange={(event) => setForm((current) => ({ ...current, eventDurationMinutes: event.target.value }))}
              className="w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none"
            />
          </label>
        </div>

        <div className="rounded-[22px] border border-slate/10 bg-sand px-4 py-4">
          <FieldLabel
            tip={`Choose how long both sides have to declare after the event ends. Default is ${defaultDeclarationWindowMinutes} minutes, with a minimum of ${minimumDeclarationWindowMinutes} and a maximum of ${maximumDeclarationWindowMinutes} minutes.`}
          >
            Declaration window
          </FieldLabel>
          <input
            type="number"
            min={minimumDeclarationWindowMinutes}
            max={maximumDeclarationWindowMinutes}
            step="1"
            value={form.declarationWindowMinutes}
            onChange={(event) => setForm((current) => ({ ...current, declarationWindowMinutes: event.target.value }))}
            className="w-full rounded-[22px] border border-slate/10 bg-white px-4 py-4 outline-none"
          />
          <p className="mt-2 text-xs text-slate/60">
            Default is {defaultDeclarationWindowMinutes} minutes. The current declaration window is about {formatDuration(declarationWindowSeconds)}.
          </p>
        </div>

        <label className="flex items-center gap-3 rounded-[22px] border border-slate/10 bg-sand px-4 py-4 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.openToPublic}
            onChange={(event) => setForm((current) => ({ ...current, openToPublic: event.target.checked }))}
          />
          Make this an open pact anyone can join
        </label>

        {!form.openToPublic ? (
          <label className="block">
            <FieldLabel tip="Only this wallet can accept the pact unless you leave it open for anyone to join.">
              Counterparty username
            </FieldLabel>
            <input
              value={form.counterparty}
              onChange={(event) => setForm((current) => ({ ...current, counterparty: event.target.value }))}
              placeholder="@friend_name"
              className="w-full rounded-[22px] border border-slate/10 bg-sand px-4 py-4 outline-none placeholder:text-slate/40"
            />
            {counterpartyValue ? (
              <p className="mt-2 text-xs text-slate/60">
                {counterpartyLookupQuery.isLoading
                  ? 'Looking up username...'
                  : counterpartyLookupQuery.isFetched && resolvedCounterpartyAddress !== zeroAddress
                    ? `@${normalizedCounterpartyUsername} resolves to ${shortenAddress(resolvedCounterpartyAddress)}`
                    : 'Ask your friend to claim this username from the wallet page first.'}
              </p>
            ) : (
              <p className="mt-2 text-xs text-slate/60">
                Invite a registered username instead of pasting a wallet address.
              </p>
            )}
          </label>
        ) : null}

        <button
          type="submit"
          disabled={mutation.isPending || vaultQuery.isLoading || counterpartyLookupQuery.isLoading || Boolean(validationError)}
          className="w-full rounded-full bg-ink px-5 py-4 text-base font-semibold text-sand"
        >
          {mutation.isPending ? 'Creating on-chain pact...' : 'Reserve stake and create pact'}
        </button>

        {validationError ? <p className="text-sm text-amber-700">{validationError}</p> : null}
        {mutation.error ? <p className="text-sm text-red-600">{mutation.error.message}</p> : null}
      </form>
    </section>
  );
}
