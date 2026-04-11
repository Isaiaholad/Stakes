const { ethers } = require('hardhat');
require('dotenv').config();

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.PACT_ADMIN_ADDRESS || deployer.address;
  const stablecoinAddress = process.env.PACT_STABLECOIN_ADDRESS;

  if (!stablecoinAddress) {
    throw new Error('PACT_STABLECOIN_ADDRESS is required. Supply the existing Monad testnet USDC address in contracts/.env.');
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

  const pactManager = await PactManager.deploy(await protocolControl.getAddress(), await vault.getAddress());
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

  await (await vault.setSystemContracts(await pactManager.getAddress(), await resolutionManager.getAddress())).wait();
  await (
    await pactManager.setSystemContracts(
      await submissionManager.getAddress(),
      await resolutionManager.getAddress()
    )
  ).wait();

  console.log(`ProtocolControl: ${await protocolControl.getAddress()}`);
  console.log(`PactVault: ${await vault.getAddress()}`);
  console.log(`PactManager: ${await pactManager.getAddress()}`);
  console.log(`SubmissionManager: ${await submissionManager.getAddress()}`);
  console.log(`PactResolutionManager: ${await resolutionManager.getAddress()}`);
  console.log(`Stablecoin: ${stablecoinAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
