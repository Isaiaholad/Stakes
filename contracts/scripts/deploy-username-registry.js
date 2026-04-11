const { ethers } = require('hardhat');

async function main() {
  const UsernameRegistry = await ethers.getContractFactory('UsernameRegistry');
  const usernameRegistry = await UsernameRegistry.deploy();
  await usernameRegistry.waitForDeployment();

  console.log(`UsernameRegistry: ${await usernameRegistry.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
