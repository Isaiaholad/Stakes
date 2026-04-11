function firstMeaningfulLine(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}

export function isTransientReadError(error) {
  const rawMessage = firstMeaningfulLine(error?.message || error?.shortMessage || error?.details || '');
  return /http request failed|failed to fetch|fetch failed|networkerror|network request failed|load failed|indexer/i.test(rawMessage || '');
}

export function getReadableAppError(error, fallbackTitle = 'Could not load on-chain data') {
  const rawMessage = firstMeaningfulLine(error?.message || error?.shortMessage || error?.details || '');
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (!online) {
    return {
      title: 'Online status: Offline',
      message: 'Your device appears to be offline. Reconnect to the internet and try again.',
      tone: 'warning'
    };
  }

  if (isTransientReadError(error)) {
    return {
      title: 'Live data delayed',
      message:
        'StakeWithFriends could not refresh the latest indexed Monad testnet data right now. Your connection may still be fine, so try again in a moment.',
      tone: 'warning'
    };
  }

  if (/only pact participants or arbiters can post/i.test(rawMessage || '')) {
    return {
      title: 'Chat access restricted',
      message: 'Only the involved wallets and arbiters can post in this pact thread.',
      tone: 'warning'
    };
  }

  if (/contract addresses are missing/i.test(rawMessage || '')) {
    return {
      title: 'Contract setup incomplete',
      message: 'The app is missing one or more deployed contract addresses. Update `apps/web/.env` and reload.',
      tone: 'warning'
    };
  }

  if (/pact not found/i.test(rawMessage || '')) {
    return {
      title: 'Pact not found',
      message: 'This pact could not be found on-chain. Check the link or wait for the latest data to sync.',
      tone: 'warning'
    };
  }

  return {
    title: fallbackTitle,
    message: 'StakeWithFriends could not load the latest Monad testnet data right now. Please try again.',
    tone: 'error'
  };
}
