const { ethers } = require('hardhat');
require('dotenv').config();

const tokenMetadataAbi = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

function parseFeeBps(value) {
  if (value === undefined || value === '') {
    return 0;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
    throw new Error('PACT_FEE_BPS must be an integer between 0 and 1000.');
  }

  return parsed;
}

async function assertDeployed(provider, label, address) {
  const code = await provider.getCode(address);
  if (code === '0x') {
    throw new Error(`${label} did not deploy correctly at ${address}.`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.PACT_ADMIN_ADDRESS || deployer.address;
  const stablecoinAddress = process.env.PACT_STABLECOIN_ADDRESS;
  const configuredFeeRecipient = process.env.PACT_FEE_RECIPIENT || '';
  const configuredFeeBps = parseFeeBps(process.env.PACT_FEE_BPS);

  if (!stablecoinAddress) {
    throw new Error('PACT_STABLECOIN_ADDRESS is required. Supply the existing Monad testnet USDC address in contracts/.env.');
  }

  if (!ethers.isAddress(admin)) {
    throw new Error(`PACT_ADMIN_ADDRESS is not a valid address: ${admin}`);
  }

  if (!ethers.isAddress(stablecoinAddress)) {
    throw new Error(`PACT_STABLECOIN_ADDRESS is not a valid address: ${stablecoinAddress}`);
  }

  if (configuredFeeBps > 0 && !ethers.isAddress(configuredFeeRecipient)) {
    throw new Error('PACT_FEE_RECIPIENT must be set to a valid address when PACT_FEE_BPS is greater than 0.');
  }

  const stablecoin = await ethers.getContractAt(tokenMetadataAbi, stablecoinAddress);
  const stablecoinDecimals = Number(await stablecoin.decimals());
  const stablecoinSymbol = await stablecoin.symbol();
  const minimumStakeAmount = process.env.PACT_MIN_STAKE_UNITS
    ? BigInt(process.env.PACT_MIN_STAKE_UNITS)
    : 10n ** BigInt(stablecoinDecimals);

  if (minimumStakeAmount <= 0n) {
    throw new Error('PACT_MIN_STAKE_UNITS must be greater than 0.');
  }

  const ProtocolControl = await ethers.getContractFactory('ProtocolControl');
  const PactVault = await ethers.getContractFactory('PactVault');
  const PactManager = await ethers.getContractFactory('PactManager');
  const SubmissionManager = await ethers.getContractFactory('SubmissionManager');
  const PactResolutionManager = await ethers.getContractFactory('PactResolutionManager');

  const protocolControl = await ProtocolControl.deploy(admin);
  await protocolControl.waitForDeployment();

  const vault = await PactVault.deploy(stablecoinAddress, await protocolControl.getAddress());
  await vault.waitForDeployment();

  const pactManager = await PactManager.deploy(
    await protocolControl.getAddress(),
    await vault.getAddress(),
    minimumStakeAmount
  );
  await pactManager.waitForDeployment();

  const submissionManager = await SubmissionManager.deploy(
    await protocolControl.getAddress(),
    await pactManager.getAddress()
  );
  await submissionManager.waitForDeployment();

  const resolutionManager = await PactResolutionManager.deploy(
    await protocolControl.getAddress(),
    await pactManager.getAddress(),
    await submissionManager.getAddress(),
    await vault.getAddress()
  );
  await resolutionManager.waitForDeployment();

  await (
    await vault.setSystemContracts(await pactManager.getAddress(), await resolutionManager.getAddress())
  ).wait();
  await (
    await pactManager.setSystemContracts(
      await submissionManager.getAddress(),
      await resolutionManager.getAddress()
    )
  ).wait();

  if (configuredFeeBps > 0 || configuredFeeRecipient) {
    await (await vault.setFeeConfig(configuredFeeRecipient, configuredFeeBps)).wait();
  }

  const provider = ethers.provider;
  const protocolControlAddress = await protocolControl.getAddress();
  const vaultAddress = await vault.getAddress();
  const pactManagerAddress = await pactManager.getAddress();
  const submissionManagerAddress = await submissionManager.getAddress();
  const resolutionManagerAddress = await resolutionManager.getAddress();
  const defaultAdminRole = await protocolControl.DEFAULT_ADMIN_ROLE();
  const adminRole = ethers.id('ADMIN_ROLE');
  const arbiterRole = ethers.id('ARBITER_ROLE');
  const operatorRole = ethers.id('OPERATOR_ROLE');

  for (const [label, address] of [
    ['ProtocolControl', protocolControlAddress],
    ['PactVault', vaultAddress],
    ['PactManager', pactManagerAddress],
    ['SubmissionManager', submissionManagerAddress],
    ['PactResolutionManager', resolutionManagerAddress]
  ]) {
    await assertDeployed(provider, label, address);
  }

  if (!(await protocolControl.hasRole(defaultAdminRole, admin))) {
    throw new Error(`Admin ${admin} is missing DEFAULT_ADMIN_ROLE.`);
  }
  if (!(await protocolControl.hasRole(adminRole, admin))) {
    throw new Error(`Admin ${admin} is missing ADMIN_ROLE.`);
  }
  if (!(await protocolControl.hasRole(arbiterRole, admin))) {
    throw new Error(`Admin ${admin} is missing ARBITER_ROLE.`);
  }
  if (!(await protocolControl.hasRole(operatorRole, admin))) {
    throw new Error(`Admin ${admin} is missing OPERATOR_ROLE.`);
  }
  if (await protocolControl.paused()) {
    throw new Error('ProtocolControl is unexpectedly paused right after deployment.');
  }

  if (!(await vault.systemContractsInitialized())) {
    throw new Error('PactVault system contracts were not initialized.');
  }
  if (!(await pactManager.systemContractsInitialized())) {
    throw new Error('PactManager system contracts were not initialized.');
  }
  if ((await vault.pactManager()) !== pactManagerAddress) {
    throw new Error('PactVault.pactManager does not match the deployed PactManager address.');
  }
  if ((await vault.resolutionManager()) !== resolutionManagerAddress) {
    throw new Error('PactVault.resolutionManager does not match the deployed PactResolutionManager address.');
  }
  if ((await pactManager.submissionManager()) !== submissionManagerAddress) {
    throw new Error('PactManager.submissionManager does not match the deployed SubmissionManager address.');
  }
  if ((await pactManager.resolutionManager()) !== resolutionManagerAddress) {
    throw new Error('PactManager.resolutionManager does not match the deployed PactResolutionManager address.');
  }
  if ((await pactManager.minimumStakeAmount()) !== minimumStakeAmount) {
    throw new Error('PactManager.minimumStakeAmount does not match the configured minimum stake.');
  }
  if ((await vault.stablecoin()) !== stablecoinAddress) {
    throw new Error('PactVault.stablecoin does not match the configured stablecoin address.');
  }
  if ((await vault.feeBps()) !== BigInt(configuredFeeBps)) {
    throw new Error('PactVault.feeBps does not match the configured fee basis points.');
  }
  if ((await vault.feeRecipient()) !== (configuredFeeBps > 0 ? configuredFeeRecipient : ethers.ZeroAddress)) {
    throw new Error('PactVault.feeRecipient does not match the configured fee recipient.');
  }

  console.log(`ProtocolControl: ${protocolControlAddress}`);
  console.log(`PactVault: ${vaultAddress}`);
  console.log(`PactManager: ${pactManagerAddress}`);
  console.log(`SubmissionManager: ${submissionManagerAddress}`);
  console.log(`PactResolutionManager: ${resolutionManagerAddress}`);
  console.log(`Stablecoin: ${stablecoinAddress}`);
  console.log(`StablecoinSymbol: ${stablecoinSymbol}`);
  console.log(`StablecoinDecimals: ${stablecoinDecimals}`);
  console.log(`MinimumStakeUnits: ${minimumStakeAmount.toString()}`);
  console.log(`FeeRecipient: ${configuredFeeBps > 0 ? configuredFeeRecipient : ethers.ZeroAddress}`);
  console.log(`FeeBps: ${configuredFeeBps}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
