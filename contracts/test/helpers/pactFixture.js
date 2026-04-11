const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { ethers } = require('hardhat');

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
  const pactId = await fixture.pactManager.nextPactId();
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

  return pactId;
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

async function openMismatchDispute(fixture, pactId = 1n, creatorWinner, counterpartyWinner) {
  await joinPact(fixture, pactId);
  await moveToEventEnd(fixture, pactId);
  await fixture.submissionManager.connect(fixture.creator).submitWinner(
    pactId,
    creatorWinner ?? fixture.creator.address
  );
  await fixture.submissionManager.connect(fixture.counterparty).submitWinner(
    pactId,
    counterpartyWinner ?? fixture.counterparty.address
  );
}

async function trackedVaultTotal(fixture, users = [fixture.creator, fixture.counterparty, fixture.admin, fixture.outsider]) {
  let total = 0n;

  for (const user of users) {
    total += await fixture.pactVault.availableBalance(user.address);
    total += await fixture.pactVault.reservedBalance(user.address);
  }

  return total;
}

module.exports = {
  DECIMALS,
  EVENT_DURATION,
  ACCEPTANCE_TIMEOUT,
  DEFAULT_DECLARATION_WINDOW,
  CUSTOM_DECLARATION_WINDOW,
  SINGLE_SUBMITTER_GRACE_PERIOD,
  DISPUTE_TIMEOUT,
  INITIAL_SUPPLY,
  USER_STARTING_BALANCE,
  VAULT_DEPOSIT,
  STAKE,
  MIN_STAKE,
  TWO_TOKENS,
  deployFixture,
  createPact,
  createOpenPact,
  joinPact,
  moveToEventEnd,
  movePastSubmissionDeadline,
  movePastSingleSubmitterGrace,
  movePastDisputeTimeout,
  openMismatchDispute,
  trackedVaultTotal
};
