const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { anyValue } = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const {
  CUSTOM_DECLARATION_WINDOW,
  DEFAULT_DECLARATION_WINDOW,
  MIN_STAKE,
  STAKE,
  VAULT_DEPOSIT,
  createOpenPact,
  createPact,
  deployFixture,
  joinPact,
  movePastSubmissionDeadline,
  movePastSingleSubmitterGrace,
  moveToEventEnd,
  openMismatchDispute
} = require('./helpers/pactFixture');

describe('StakeWithFriends payout and guard regressions', function () {
  it('emits indexer-friendly lifecycle events across create, join, fee snapshot, and matched resolution', async function () {
    const fixture = await loadFixture(deployFixture);
    const feeBps = 333;
    const totalEscrow = STAKE * 2n;
    const feeAmount = (totalEscrow * BigInt(feeBps)) / 10_000n;
    const netAmount = totalEscrow - feeAmount;

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.admin.address, feeBps);

    await expect(
      fixture.pactManager
        .connect(fixture.creator)
        ['createPact(address,string,string,uint64,uint64,uint256)'](
          fixture.counterparty.address,
          'Winner takes the pot',
          'Chess Match Pact',
          5 * 60,
          CUSTOM_DECLARATION_WINDOW,
          STAKE
        )
    )
      .to.emit(fixture.pactVault, 'PactFeeSnapshotCaptured')
      .withArgs(1n, fixture.admin.address, feeBps)
      .and.to.emit(fixture.pactManager, 'PactCreated')
      .withArgs(
        1n,
        fixture.creator.address,
        fixture.counterparty.address,
        STAKE,
        anyValue,
        5 * 60,
        CUSTOM_DECLARATION_WINDOW,
        'Winner takes the pot',
        'Chess Match Pact'
      );

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.outsider.address, 1000);

    await expect(fixture.pactManager.connect(fixture.counterparty).joinPact(1n))
      .to.emit(fixture.pactManager, 'PactJoined')
      .withArgs(1n, fixture.counterparty.address, anyValue, anyValue, anyValue, CUSTOM_DECLARATION_WINDOW);

    await moveToEventEnd(fixture, 1n);
    await fixture.submissionManager.connect(fixture.creator).submitWinner(1n, fixture.creator.address);
    await expect(fixture.submissionManager.connect(fixture.counterparty).submitWinner(1n, fixture.creator.address))
      .to.emit(fixture.pactVault, 'WinnerPaid')
      .withArgs(1n, fixture.creator.address, totalEscrow, netAmount, feeAmount, fixture.admin.address, feeBps)
      .and.to.emit(fixture.pactManager, 'PactResolved')
      .withArgs(1n, fixture.creator.address, ethers.ZeroHash, fixture.counterparty.address)
      .and.to.emit(fixture.pactResolutionManager, 'PactAutoResolved')
      .withArgs(1n, fixture.creator.address, fixture.counterparty.address, ethers.ZeroHash);

    const feeSnapshot = await fixture.pactVault.pactFeeSnapshotOf(1n);
    expect(feeSnapshot[0]).to.equal(fixture.admin.address);
    expect(feeSnapshot[1]).to.equal(BigInt(feeBps));
    expect(feeSnapshot[2]).to.equal(true);
  });

  it('uses the original fee snapshot and rounds winner fees down safely after a single declaration', async function () {
    const fixture = await loadFixture(deployFixture);
    const feeBps = 333;
    const oddStake = MIN_STAKE + 1n;
    const totalEscrow = oddStake * 2n;
    const feeAmount = (totalEscrow * BigInt(feeBps)) / 10_000n;
    const netAmount = totalEscrow - feeAmount;
    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.admin.address, feeBps);
    const pactId = await createPact(fixture, {
      stakeAmount: oddStake
    });

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.outsider.address, 1000);
    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);
    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await movePastSubmissionDeadline(fixture, pactId);
    await movePastSingleSubmitterGrace(fixture, pactId);

    await expect(fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId))
      .to.emit(fixture.pactVault, 'WinnerPaid')
      .withArgs(
        pactId,
        fixture.creator.address,
        totalEscrow,
        netAmount,
        feeAmount,
        fixture.admin.address,
        feeBps
      );

    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(
      VAULT_DEPOSIT + oddStake - feeAmount
    );
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(
      VAULT_DEPOSIT - oddStake
    );
    expect(await fixture.pactVault.availableBalance(fixture.admin.address)).to.equal(feeAmount);
    expect(await fixture.pactVault.availableBalance(fixture.outsider.address)).to.equal(0n);
  });

  it('charges the pact fee snapshot on no-declaration split settlements', async function () {
    const fixture = await loadFixture(deployFixture);
    const totalEscrow = STAKE * 2n;
    const feeAmount = (totalEscrow * 1_000n) / 10_000n;
    const distributableAmount = totalEscrow - feeAmount;
    const splitAmount = distributableAmount / 2n;

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.admin.address, 1000);
    const pactId = await createPact(fixture);
    await joinPact(fixture, pactId);
    await movePastSubmissionDeadline(fixture, pactId);

    await expect(fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId))
      .to.emit(fixture.pactVault, 'SplitPaid')
      .withArgs(pactId, fixture.creator.address, fixture.counterparty.address, splitAmount, splitAmount);

    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(
      VAULT_DEPOSIT - STAKE + splitAmount
    );
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(
      VAULT_DEPOSIT - STAKE + splitAmount
    );
    expect(await fixture.pactVault.availableBalance(fixture.admin.address)).to.equal(feeAmount);
  });

  it('lets the arbiter resolve a disputed pact to a winner or split once one side has submitted proof', async function () {
    const fixture = await loadFixture(deployFixture);
    const winnerPactId = await createPact(fixture);

    await openMismatchDispute(fixture, winnerPactId);
    await expect(
      fixture.pactResolutionManager.connect(fixture.outsider).submitDisputeEvidence(winnerPactId, 'ipfs://oops')
    ).to.be.revertedWith('not participant');
    await expect(
      fixture.pactResolutionManager.connect(fixture.creator).submitDisputeEvidence(winnerPactId, '')
    ).to.be.revertedWith('evidence=0');

    await fixture.pactResolutionManager
      .connect(fixture.creator)
      .submitDisputeEvidence(winnerPactId, 'ipfs://creator-proof');

    await expect(
      fixture.pactResolutionManager
        .connect(fixture.admin)
        .adminResolveWinner(winnerPactId, fixture.creator.address, ethers.id('creator-wins'))
    )
      .to.emit(fixture.pactResolutionManager, 'PactArbiterResolved')
      .withArgs(winnerPactId, fixture.creator.address, fixture.admin.address, ethers.id('creator-wins'));

    const splitPactId = await createPact(fixture, {
      stakeAmount: MIN_STAKE + 10n
    });

    await openMismatchDispute(fixture, splitPactId);
    await fixture.pactResolutionManager
      .connect(fixture.creator)
      .submitDisputeEvidence(splitPactId, 'ipfs://creator-proof');
    await fixture.pactResolutionManager
      .connect(fixture.counterparty)
      .submitDisputeEvidence(splitPactId, 'ipfs://counterparty-proof');

    const totalEscrow = (MIN_STAKE + 10n) * 2n;
    const creatorShare = (totalEscrow * 6_000n) / 10_000n;
    const counterpartyShare = totalEscrow - creatorShare;

    await expect(
      fixture.pactResolutionManager
        .connect(fixture.admin)
        .adminResolveSplit(splitPactId, 6_000, ethers.id('split-60-40'))
    )
      .to.emit(fixture.pactResolutionManager, 'PactArbiterSplit')
      .withArgs(splitPactId, fixture.admin.address, 6_000, ethers.id('split-60-40'))
      .and.to.emit(fixture.pactVault, 'SplitPaid')
      .withArgs(splitPactId, fixture.creator.address, fixture.counterparty.address, creatorShare, counterpartyShare);
  });

  it('blocks core user actions while the protocol is paused', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createOpenPact(fixture);

    await fixture.protocolControl.connect(fixture.admin).pause();

    await expect(
      fixture.pactManager
        .connect(fixture.creator)
        ['createPact(address,string,string,uint64,uint256)'](
          ethers.ZeroAddress,
          'Paused create',
          'Sprint',
          5 * 60,
          STAKE
        )
    ).to.be.revertedWith('paused');
    await expect(fixture.pactManager.connect(fixture.counterparty).joinPact(pactId)).to.be.revertedWith('paused');
    await expect(fixture.pactVault.connect(fixture.creator).deposit(1n)).to.be.revertedWith('paused');
    await expect(fixture.pactVault.connect(fixture.creator).withdraw(1n)).to.be.revertedWith('paused');

    await fixture.protocolControl.connect(fixture.admin).unpause();
    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);
    await fixture.protocolControl.connect(fixture.admin).pause();

    await expect(
      fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address)
    ).to.be.revertedWith('paused');
    await expect(fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId)).to.be.revertedWith(
      'paused'
    );

    await fixture.protocolControl.connect(fixture.admin).unpause();
    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await time.increase(DEFAULT_DECLARATION_WINDOW + 2);
    await fixture.protocolControl.connect(fixture.admin).pause();

    await expect(fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId)).to.be.revertedWith(
      'paused'
    );
  });
});
