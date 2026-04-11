const { loadFixture, time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('StakeWithFriends core functionality', function () {
  const DECIMALS = 6;
  const EVENT_DURATION = 5 * 60;
  const ACCEPTANCE_TIMEOUT = 12 * 60 * 60;
  const DEFAULT_DECLARATION_WINDOW = 20 * 60;
  const CUSTOM_DECLARATION_WINDOW = 45 * 60;
  const SINGLE_SUBMITTER_GRACE_PERIOD = 30 * 60;
  const DISPUTE_TIMEOUT = 7 * 24 * 60 * 60;
  const INITIAL_SUPPLY = ethers.parseUnits('1000000', DECIMALS);
  const USER_STARTING_BALANCE = ethers.parseUnits('500', DECIMALS);
  const VAULT_DEPOSIT = ethers.parseUnits('100', DECIMALS);
  const STAKE = ethers.parseUnits('10', DECIMALS);
  const MIN_STAKE = ethers.parseUnits('1', DECIMALS);
  const TWO_TOKENS = ethers.parseUnits('2', DECIMALS);

  async function deployFixture() {
    const [admin, creator, counterparty, outsider] = await ethers.getSigners();

    const MockStablecoin = await ethers.getContractFactory('MockStablecoin');
    const ProtocolControl = await ethers.getContractFactory('ProtocolControl');
    const PactVault = await ethers.getContractFactory('PactVault');
    const PactManager = await ethers.getContractFactory('PactManager');
    const SubmissionManager = await ethers.getContractFactory('SubmissionManager');
    const PactResolutionManager = await ethers.getContractFactory('PactResolutionManager');
    const UsernameRegistry = await ethers.getContractFactory('UsernameRegistry');

    const stablecoin = await MockStablecoin.deploy(
      'Mock USDC',
      'mUSDC',
      DECIMALS,
      INITIAL_SUPPLY,
      admin.address
    );
    const protocolControl = await ProtocolControl.deploy(admin.address);
    const pactVault = await PactVault.deploy(await stablecoin.getAddress(), await protocolControl.getAddress());
    const pactManager = await PactManager.deploy(
      await protocolControl.getAddress(),
      await pactVault.getAddress(),
      MIN_STAKE
    );
    const submissionManager = await SubmissionManager.deploy(
      await protocolControl.getAddress(),
      await pactManager.getAddress()
    );
    const pactResolutionManager = await PactResolutionManager.deploy(
      await protocolControl.getAddress(),
      await pactManager.getAddress(),
      await submissionManager.getAddress(),
      await pactVault.getAddress()
    );
    const usernameRegistry = await UsernameRegistry.deploy();

    await pactManager.setSystemContracts(
      await submissionManager.getAddress(),
      await pactResolutionManager.getAddress()
    );
    await pactVault.setSystemContracts(
      await pactManager.getAddress(),
      await pactResolutionManager.getAddress()
    );

    for (const user of [creator, counterparty, outsider]) {
      await stablecoin.transfer(user.address, USER_STARTING_BALANCE);
    }

    for (const user of [creator, counterparty]) {
      await stablecoin.connect(user).approve(await pactVault.getAddress(), USER_STARTING_BALANCE);
      await pactVault.connect(user).deposit(VAULT_DEPOSIT);
    }

    return {
      admin,
      creator,
      counterparty,
      outsider,
      stablecoin,
      protocolControl,
      pactVault,
      pactManager,
      submissionManager,
      pactResolutionManager,
      usernameRegistry
    };
  }

  async function createPact(fixture, overrides = {}) {
    const counterpartyAddress = overrides.counterparty ?? fixture.counterparty.address;
    const description = overrides.description ?? 'Winner takes the pot';
    const eventType = overrides.eventType ?? 'Chess Match Pact';
    const eventDuration = overrides.eventDuration ?? EVENT_DURATION;
    const stakeAmount = overrides.stakeAmount ?? STAKE;
    const declarationWindow = overrides.declarationWindow;

    if (declarationWindow === undefined) {
      await fixture.pactManager
        .connect(fixture.creator)
        ['createPact(address,string,string,uint64,uint256)'](
          counterpartyAddress,
          description,
          eventType,
          eventDuration,
          stakeAmount
        );
    } else {
      await fixture.pactManager
        .connect(fixture.creator)
        ['createPact(address,string,string,uint64,uint64,uint256)'](
          counterpartyAddress,
          description,
          eventType,
          eventDuration,
          declarationWindow,
          stakeAmount
        );
    }

    return 1n;
  }

  async function createOpenPact(fixture, overrides = {}) {
    return createPact(fixture, {
      ...overrides,
      counterparty: ethers.ZeroAddress
    });
  }

  async function joinPact(fixture, pactId = 1n, signer = fixture.counterparty) {
    await fixture.pactManager.connect(signer).joinPact(pactId);
  }

  async function moveToEventEnd(fixture, pactId = 1n) {
    const pactWindow = await fixture.pactManager.getPactWindow(pactId);
    await time.increaseTo(Number(pactWindow[2]) + 1);
  }

  async function movePastSubmissionDeadline(fixture, pactId = 1n) {
    const pactWindow = await fixture.pactManager.getPactWindow(pactId);
    await time.increaseTo(Number(pactWindow[3]) + 1);
  }

  async function movePastSingleSubmitterGrace(fixture, pactId = 1n) {
    const pactWindow = await fixture.pactManager.getPactWindow(pactId);
    await time.increaseTo(Number(pactWindow[3]) + SINGLE_SUBMITTER_GRACE_PERIOD + 1);
  }

  async function movePastDisputeTimeout(fixture, pactId = 1n) {
    const openedAt = await fixture.pactResolutionManager.disputeOpenedAt(pactId);
    await time.increaseTo(Number(openedAt) + DISPUTE_TIMEOUT + 1);
  }

  it('lets users claim and clear a username', async function () {
    const { usernameRegistry, creator, counterparty } = await loadFixture(deployFixture);

    await expect(usernameRegistry.connect(creator).setUsername('haz'))
      .to.emit(usernameRegistry, 'UsernameSet')
      .withArgs(creator.address, 'haz');

    expect(await usernameRegistry.usernameOf(creator.address)).to.equal('haz');
    expect(await usernameRegistry.resolveUsername('haz')).to.equal(creator.address);

    await expect(usernameRegistry.connect(counterparty).setUsername('haz')).to.be.revertedWith('username taken');

    await expect(usernameRegistry.connect(creator).clearUsername())
      .to.emit(usernameRegistry, 'UsernameCleared')
      .withArgs(creator.address, 'haz');

    expect(await usernameRegistry.resolveUsername('haz')).to.equal(ethers.ZeroAddress);
  });

  it('enforces a configurable minimum stake', async function () {
    const fixture = await loadFixture(deployFixture);

    await expect(
      createOpenPact(fixture, {
        stakeAmount: MIN_STAKE - 1n
      })
    ).to.be.revertedWith('stake below minimum');

    await fixture.pactManager.connect(fixture.admin).setMinimumStakeAmount(STAKE);

    await expect(createOpenPact(fixture, { stakeAmount: MIN_STAKE })).to.be.revertedWith('stake below minimum');
  });

  it('uses the 20 minute declaration window by default', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createOpenPact(fixture);
    const beforeJoin = await time.latest();

    await expect(fixture.pactManager.connect(fixture.counterparty).joinPact(pactId)).to.emit(
      fixture.pactManager,
      'PactJoined'
    );

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[1]).to.equal(fixture.counterparty.address);
    expect(pact[5]).to.be.greaterThan(BigInt(beforeJoin));
    expect(pact[6]).to.equal(pact[5] + BigInt(EVENT_DURATION));
    expect(pact[7]).to.equal(pact[6] + BigInt(DEFAULT_DECLARATION_WINDOW));
    expect(pact[8]).to.equal(2n);
    expect(pact[11]).to.equal(BigInt(DEFAULT_DECLARATION_WINDOW));
    expect(await fixture.pactVault.reservedBalance(fixture.counterparty.address)).to.equal(STAKE);
  });

  it('lets the creator set a custom declaration window between 5 and 60 minutes', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createOpenPact(fixture, {
      declarationWindow: CUSTOM_DECLARATION_WINDOW
    });

    await fixture.pactManager.connect(fixture.counterparty).joinPact(pactId);

    const pactWindow = await fixture.pactManager.getPactWindow(pactId);
    expect(pactWindow[5]).to.equal(BigInt(CUSTOM_DECLARATION_WINDOW));
    expect(pactWindow[3]).to.equal(pactWindow[2] + BigInt(CUSTOM_DECLARATION_WINDOW));

    await expect(
      createOpenPact(fixture, {
        declarationWindow: 4 * 60
      })
    ).to.be.revertedWith('bad declaration window');

    await expect(
      createOpenPact(fixture, {
        declarationWindow: 61 * 60
      })
    ).to.be.revertedWith('bad declaration window');
  });

  it('reserves and releases creator stake when an open pact is cancelled', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createOpenPact(fixture);

    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT - STAKE);
    expect(await fixture.pactVault.reservedBalance(fixture.creator.address)).to.equal(STAKE);

    await fixture.pactManager.connect(fixture.creator).cancelUnjoinedPact(pactId);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(5n);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT);
    expect(await fixture.pactVault.reservedBalance(fixture.creator.address)).to.equal(0n);
  });

  it('releases stake after the 12 hour acceptance timeout', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await time.increase(ACCEPTANCE_TIMEOUT + 1);
    await fixture.pactManager.connect(fixture.outsider).cancelExpiredPact(pactId);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(5n);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT);
    expect(await fixture.pactVault.reservedBalance(fixture.creator.address)).to.equal(0n);
  });

  it('snapshots the pact fee config at creation time', async function () {
    const fixture = await loadFixture(deployFixture);

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.admin.address, 1_000);
    const pactId = await createPact(fixture);

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.outsider.address, 500);
    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.creator.address);

    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(
      VAULT_DEPOSIT + STAKE - TWO_TOKENS
    );
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - STAKE);
    expect(await fixture.pactVault.availableBalance(fixture.admin.address)).to.equal(TWO_TOKENS);
    expect(await fixture.pactVault.availableBalance(fixture.outsider.address)).to.equal(0n);

    const feeSnapshot = await fixture.pactVault.pactFeeSnapshotOf(pactId);
    expect(feeSnapshot[0]).to.equal(fixture.admin.address);
    expect(feeSnapshot[1]).to.equal(1_000n);
    expect(feeSnapshot[2]).to.equal(true);
  });

  it('only allows the initial system bootstrap once and requires pause for rewiring', async function () {
    const fixture = await loadFixture(deployFixture);

    await expect(
      fixture.pactManager
        .connect(fixture.admin)
        .setSystemContracts(await fixture.submissionManager.getAddress(), await fixture.pactResolutionManager.getAddress())
    ).to.be.revertedWith('system initialized');

    await expect(
      fixture.pactVault
        .connect(fixture.admin)
        .setSystemContracts(await fixture.pactManager.getAddress(), await fixture.pactResolutionManager.getAddress())
    ).to.be.revertedWith('system initialized');

    await expect(
      fixture.pactManager
        .connect(fixture.admin)
        .rewireSystemContracts(await fixture.submissionManager.getAddress(), await fixture.pactResolutionManager.getAddress())
    ).to.be.revertedWith('pause first');

    await expect(
      fixture.pactVault
        .connect(fixture.admin)
        .rewireSystemContracts(await fixture.pactManager.getAddress(), await fixture.pactResolutionManager.getAddress())
    ).to.be.revertedWith('pause first');
  });

  it('finalizes matching declarations to the agreed winner', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.creator.address);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(fixture.creator.address);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT + STAKE);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - STAKE);
  });

  it('auto-resolves to the single declarer only after the grace period expires', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await movePastSubmissionDeadline(fixture, pactId);

    await expect(
      fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId)
    ).to.be.revertedWith('single submitter grace');

    await movePastSingleSubmitterGrace(fixture, pactId);
    await fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(fixture.creator.address);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT + STAKE);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - STAKE);
  });

  it('auto-resolves to a split when nobody declares by the deadline', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await movePastSubmissionDeadline(fixture, pactId);
    await fixture.pactResolutionManager.connect(fixture.outsider).settleAfterDeclarationWindow(pactId);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(ethers.ZeroAddress);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT);
  });

  it('opens a dispute on mismatched declarations and lets an arbiter resolve once one side submits proof', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.counterparty.address);

    await expect(
      fixture.pactResolutionManager
        .connect(fixture.admin)
        .adminResolveWinner(pactId, fixture.creator.address, ethers.id('creator-wins'))
    ).to.be.revertedWith('evidence required');

    await fixture.pactResolutionManager
      .connect(fixture.creator)
      .submitDisputeEvidence(pactId, 'ipfs://creator-proof');

    await expect(
      fixture.pactResolutionManager
        .connect(fixture.admin)
        .adminResolveWinner(pactId, fixture.creator.address, ethers.id('creator-wins'))
    )
      .to.emit(fixture.pactResolutionManager, 'PactArbiterResolved')
      .withArgs(pactId, fixture.creator.address, fixture.admin.address, ethers.id('creator-wins'));

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(fixture.creator.address);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT + STAKE);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - STAKE);
  });

  it('lets the arbiter resolve a disputed pact immediately once both sides submit evidence', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.counterparty.address);

    await fixture.pactResolutionManager
      .connect(fixture.creator)
      .submitDisputeEvidence(pactId, 'ipfs://creator-proof');
    await fixture.pactResolutionManager
      .connect(fixture.counterparty)
      .submitDisputeEvidence(pactId, 'ipfs://counterparty-proof');
    await fixture.pactResolutionManager
      .connect(fixture.admin)
      .adminResolveSplit(pactId, 6_000, ethers.id('split-60-40'));

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(ethers.ZeroAddress);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT + TWO_TOKENS);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - TWO_TOKENS);
  });

  it('resolves a disputed pact even when one participant still has reserve locked in another pact', async function () {
    const fixture = await loadFixture(deployFixture);
    const disputedPactId = await createPact(fixture);

    await joinPact(fixture, disputedPactId);
    await moveToEventEnd(fixture, disputedPactId);
    await fixture.submissionManager.connect(fixture.creator).submitWinner(disputedPactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(disputedPactId, fixture.counterparty.address);
    await fixture.pactResolutionManager
      .connect(fixture.creator)
      .submitDisputeEvidence(disputedPactId, 'ipfs://creator-proof');
    await fixture.pactResolutionManager
      .connect(fixture.counterparty)
      .submitDisputeEvidence(disputedPactId, 'ipfs://counterparty-proof');

    await fixture.pactManager
      .connect(fixture.counterparty)
      ['createPact(address,string,string,uint64,uint256)'](
        fixture.outsider.address,
        'Second reserve',
        'Football Match Pact',
        EVENT_DURATION,
        STAKE
      );

    expect(await fixture.pactVault.reservedBalance(fixture.counterparty.address)).to.equal(STAKE * 2n);

    await fixture.pactResolutionManager
      .connect(fixture.admin)
      .adminResolveSplit(disputedPactId, 5_000, ethers.id('split-50-50'));

    const pact = await fixture.pactManager.getPactCore(disputedPactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(ethers.ZeroAddress);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - STAKE);
    expect(await fixture.pactVault.reservedBalance(fixture.counterparty.address)).to.equal(STAKE);
  });

  it('lets either participant force a 50-50 split after the dispute timeout', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.counterparty.address);

    await expect(
      fixture.pactResolutionManager.connect(fixture.creator).forceSplitAfterDisputeTimeout(pactId)
    ).to.be.revertedWith('dispute timeout open');

    await movePastDisputeTimeout(fixture, pactId);
    await fixture.pactResolutionManager.connect(fixture.creator).forceSplitAfterDisputeTimeout(pactId);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(ethers.ZeroAddress);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(VAULT_DEPOSIT);
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT);
  });

  it('lets only the silent party raise a dispute during the single-declaration review period', async function () {
    const fixture = await loadFixture(deployFixture);
    const pactId = await createPact(fixture);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);
    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await movePastSubmissionDeadline(fixture, pactId);

    await expect(
      fixture.pactResolutionManager.connect(fixture.creator).openDisputeFromUnansweredDeclaration(pactId)
    ).to.be.revertedWith('only missing participant');

    await fixture.pactResolutionManager
      .connect(fixture.counterparty)
      .openDisputeFromUnansweredDeclaration(pactId);

    const pact = await fixture.pactManager.getPactCore(pactId);
    expect(pact[8]).to.equal(3n);
  });
});
