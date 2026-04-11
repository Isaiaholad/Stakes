import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pactManagerAbi, pactResolutionManagerAbi, submissionManagerAbi } from '../../web/src/lib/abis.js';
import { readContractWithRetry, publicClient, zeroAddress } from './chain.js';
import { apiConfig, hasAutonomousKeeperConfigured } from './config.js';
import { all } from './db.js';

const ACTIVE_STATUS_ID = 2;

let cachedGracePeriodSeconds = null;
let keeperPassInFlight = null;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createKeeperClients() {
  const account = privateKeyToAccount(apiConfig.autonomousKeeperPrivateKey);
  const walletClient = createWalletClient({
    account,
    transport: http(apiConfig.rpcUrl, {
      retryCount: 6,
      retryDelay: 400
    })
  });

  return {
    account,
    walletClient
  };
}

async function readSingleSubmitterGracePeriodSeconds() {
  if (cachedGracePeriodSeconds !== null) {
    return cachedGracePeriodSeconds;
  }

  const gracePeriod = await readContractWithRetry({
    address: apiConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: 'SINGLE_SUBMITTER_GRACE_PERIOD'
  });

  cachedGracePeriodSeconds = Number(gracePeriod || 0);
  return cachedGracePeriodSeconds;
}

async function readActivePactSnapshot(pactId) {
  const core = await readContractWithRetry({
    address: apiConfig.addresses.pactManager,
    abi: pactManagerAbi,
    functionName: 'getPactCore',
    args: [BigInt(pactId)]
  });

  const creator = core[0];
  const counterparty = core[1];
  const submissionDeadline = Number(core[7] || 0);
  const rawStatusId = Number(core[8] || 0);

  if (!creator || creator === zeroAddress || rawStatusId !== ACTIVE_STATUS_ID) {
    return null;
  }

  const [creatorDeclaration, counterpartyDeclaration] = await Promise.all([
    readContractWithRetry({
      address: apiConfig.addresses.submissionManager,
      abi: submissionManagerAbi,
      functionName: 'getDeclaration',
      args: [BigInt(pactId), creator]
    }),
    readContractWithRetry({
      address: apiConfig.addresses.submissionManager,
      abi: submissionManagerAbi,
      functionName: 'getDeclaration',
      args: [BigInt(pactId), counterparty]
    })
  ]);

  const creatorSubmitted = Boolean(creatorDeclaration?.[0]);
  const counterpartySubmitted = Boolean(counterpartyDeclaration?.[0]);
  const bothSubmitted = creatorSubmitted && counterpartySubmitted;
  const singleSubmissionPending = creatorSubmitted !== counterpartySubmitted;

  let declarationsMatch = false;
  if (bothSubmitted) {
    const matchInfo = await readContractWithRetry({
      address: apiConfig.addresses.submissionManager,
      abi: submissionManagerAbi,
      functionName: 'declarationsMatch',
      args: [BigInt(pactId)]
    });

    declarationsMatch = Boolean(matchInfo?.[0]);
  }

  return {
    pactId,
    submissionDeadline,
    creatorSubmitted,
    counterpartySubmitted,
    bothSubmitted,
    declarationsMatch,
    singleSubmissionPending
  };
}

function classifyDueAction(snapshot, gracePeriodSeconds) {
  if (!snapshot) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (snapshot.bothSubmitted) {
    return {
      pactId: snapshot.pactId,
      functionName: snapshot.declarationsMatch ? 'finalizeMatchedResult' : 'openDisputeFromMismatch'
    };
  }

  if (nowSeconds <= snapshot.submissionDeadline) {
    return null;
  }

  if (!snapshot.creatorSubmitted && !snapshot.counterpartySubmitted) {
    return {
      pactId: snapshot.pactId,
      functionName: 'settleAfterDeclarationWindow'
    };
  }

  if (
    snapshot.singleSubmissionPending &&
    nowSeconds > snapshot.submissionDeadline + gracePeriodSeconds
  ) {
    return {
      pactId: snapshot.pactId,
      functionName: 'settleAfterDeclarationWindow'
    };
  }

  return null;
}

async function submitKeeperAction(walletClient, account, action) {
  const { request } = await publicClient.simulateContract({
    account,
    address: apiConfig.addresses.pactResolutionManager,
    abi: pactResolutionManagerAbi,
    functionName: action.functionName,
    args: [BigInt(action.pactId)]
  });

  const hash = await walletClient.writeContract(request);
  return publicClient.waitForTransactionReceipt({ hash });
}

export async function runKeeperPass() {
  if (!hasAutonomousKeeperConfigured()) {
    return [];
  }

  if (keeperPassInFlight) {
    return keeperPassInFlight;
  }

  keeperPassInFlight = (async () => {
    const gracePeriodSeconds = await readSingleSubmitterGracePeriodSeconds();
    const { account, walletClient } = createKeeperClients();
    const candidateRows = all(
      `
        SELECT pact_id
        FROM pacts
        WHERE raw_status = 'Active'
        ORDER BY pact_id ASC
        LIMIT ?
      `,
      [apiConfig.autonomousKeeperBatchSize]
    );

    const receipts = [];
    for (const row of candidateRows) {
      const pactId = Number(row.pact_id);
      if (!pactId) {
        continue;
      }

      try {
        const snapshot = await readActivePactSnapshot(pactId);
        const action = classifyDueAction(snapshot, gracePeriodSeconds);

        if (!action) {
          continue;
        }

        const receipt = await submitKeeperAction(walletClient, account, action);
        receipts.push({
          pactId,
          functionName: action.functionName,
          transactionHash: receipt.transactionHash
        });
      } catch (error) {
        const message = String(error?.shortMessage || error?.message || '');
        if (
          /bad status|already matched|not submitted|deadline open|single submitter grace/i.test(message)
        ) {
          continue;
        }

        console.error(`Autonomous keeper failed for pact #${pactId}:`, error);
      }
    }

    return receipts;
  })();

  try {
    return await keeperPassInFlight;
  } finally {
    keeperPassInFlight = null;
  }
}

export async function startKeeperLoop({ once = false } = {}) {
  if (!hasAutonomousKeeperConfigured()) {
    if (apiConfig.autonomousKeeperEnabled) {
      console.warn('Autonomous keeper is enabled but no valid AUTONOMOUS_KEEPER_PRIVATE_KEY is configured.');
    }
    return;
  }

  while (true) {
    await runKeeperPass();
    if (once) {
      return;
    }

    await wait(apiConfig.autonomousKeeperPollIntervalMs);
  }
}
