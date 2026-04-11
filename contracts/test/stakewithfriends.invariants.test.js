const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  MIN_STAKE,
  VAULT_DEPOSIT,
  createPact,
  deployFixture,
  joinPact,
  movePastSingleSubmitterGrace,
  movePastSubmissionDeadline,
  moveToEventEnd,
  trackedVaultTotal
} = require('./helpers/pactFixture');

function buildScenario(seed) {
  return {
    seed,
    feeBps: (seed * 137) % 1001,
    stakeAmount: MIN_STAKE + BigInt(seed * 111_111),
    resolutionMode: seed % 5
  };
}

async function resolveScenario(fixture, pactId, scenario) {
  if (scenario.resolutionMode === 0) {
    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.creator.address);
    return;
  }

  if (scenario.resolutionMode === 1) {
    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.counterparty.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.counterparty.address);
    return;
  }

  if (scenario.resolutionMode === 2) {
    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await movePastSubmissionDeadline(fixture, pactId);
    await movePastSingleSubmitterGrace(fixture, pactId);
    await fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId);
    return;
  }

  if (scenario.resolutionMode === 3) {
    await movePastSubmissionDeadline(fixture, pactId);
    await fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId);
    return;
  }

  await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
  await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.counterparty.address);
  await fixture.pactResolutionManager.connect(fixture.creator).submitDisputeEvidence(pactId, `ipfs://proof-${scenario.seed}`);
  await fixture.pactResolutionManager.connect(fixture.counterparty).submitDisputeEvidence(pactId, `ipfs://reply-${scenario.seed}`);
  await fixture.pactResolutionManager
    .connect(fixture.admin)
    .adminResolveSplit(pactId, 6_000, ethers.id(`split-${scenario.seed}`));
}

describe('StakeWithFriends invariant sweeps', function () {
  it('preserves escrow conservation, bounded fees, and single-settlement guarantees across varied outcomes', async function () {
    const scenarios = Array.from({ length: 8 }, (_, index) => buildScenario(index + 1));

    for (const scenario of scenarios) {
      const fixture = await loadFixture(deployFixture);
      const pactId = await createPact(fixture, {
        stakeAmount: scenario.stakeAmount
      });
      const totalDeposited = VAULT_DEPOSIT * 2n;

      await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.admin.address, scenario.feeBps);
      await fixture.pactManager.connect(fixture.creator).cancelUnjoinedPact(pactId);

      const activePactId = await createPact(fixture, {
        stakeAmount: scenario.stakeAmount
      });

      await joinPact(fixture, activePactId);
      await moveToEventEnd(fixture, activePactId);
      await resolveScenario(fixture, activePactId, scenario);

      const trackedTotal = await trackedVaultTotal(fixture);
      const adminAvailable = await fixture.pactVault.availableBalance(fixture.admin.address);
      const totalEscrow = scenario.stakeAmount * 2n;
      const pact = await fixture.pactManager.getPactCore(activePactId);

      expect(trackedTotal, `seed ${scenario.seed} conservation`).to.equal(totalDeposited);
      expect(await fixture.pactVault.reservedBalance(fixture.creator.address), `seed ${scenario.seed} creator reserve`).to.equal(0n);
      expect(await fixture.pactVault.reservedBalance(fixture.counterparty.address), `seed ${scenario.seed} counterparty reserve`).to.equal(0n);
      expect(await fixture.pactVault.availableBalance(fixture.creator.address), `seed ${scenario.seed} creator balance`).to.be.at.least(0n);
      expect(await fixture.pactVault.availableBalance(fixture.counterparty.address), `seed ${scenario.seed} counterparty balance`).to.be.at.least(0n);
      expect(adminAvailable, `seed ${scenario.seed} fee bound`).to.be.at.most(totalEscrow / 10n);
      expect(pact[8], `seed ${scenario.seed} status`).to.equal(4n);

      await expect(
        fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(activePactId)
      ).to.be.reverted;
    }
  });
});
