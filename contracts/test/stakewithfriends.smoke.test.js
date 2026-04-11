const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { CUSTOM_DECLARATION_WINDOW, STAKE, VAULT_DEPOSIT, createPact, deployFixture, joinPact, moveToEventEnd } = require('./helpers/pactFixture');

describe('StakeWithFriends deployment smoke tests', function () {
  it('deploys, wires, verifies, and settles one full pact lifecycle', async function () {
    const fixture = await loadFixture(deployFixture);
    const defaultAdminRole = await fixture.protocolControl.DEFAULT_ADMIN_ROLE();
    const adminRole = ethers.id('ADMIN_ROLE');
    const arbiterRole = ethers.id('ARBITER_ROLE');
    const operatorRole = ethers.id('OPERATOR_ROLE');

    expect(await fixture.protocolControl.hasRole(defaultAdminRole, fixture.admin.address)).to.equal(true);
    expect(await fixture.protocolControl.hasRole(adminRole, fixture.admin.address)).to.equal(true);
    expect(await fixture.protocolControl.hasRole(arbiterRole, fixture.admin.address)).to.equal(true);
    expect(await fixture.protocolControl.hasRole(operatorRole, fixture.admin.address)).to.equal(true);
    expect(await fixture.protocolControl.paused()).to.equal(false);

    expect(await fixture.pactVault.systemContractsInitialized()).to.equal(true);
    expect(await fixture.pactManager.systemContractsInitialized()).to.equal(true);
    expect(await fixture.pactVault.pactManager()).to.equal(await fixture.pactManager.getAddress());
    expect(await fixture.pactVault.resolutionManager()).to.equal(await fixture.pactResolutionManager.getAddress());
    expect(await fixture.pactManager.submissionManager()).to.equal(await fixture.submissionManager.getAddress());
    expect(await fixture.pactManager.resolutionManager()).to.equal(await fixture.pactResolutionManager.getAddress());
    expect(await fixture.pactVault.stablecoin()).to.equal(await fixture.stablecoin.getAddress());

    await fixture.pactVault.connect(fixture.admin).setFeeConfig(fixture.admin.address, 250);

    const pactId = await createPact(fixture, {
      eventDuration: 15 * 60,
      declarationWindow: CUSTOM_DECLARATION_WINDOW
    });

    const pactBeforeJoin = await fixture.pactManager.getPactCore(pactId);
    expect(pactBeforeJoin[3]).to.be.greaterThan(0n);

    await joinPact(fixture, pactId);
    await moveToEventEnd(fixture, pactId);

    await fixture.submissionManager.connect(fixture.creator).submitWinner(pactId, fixture.creator.address);
    await fixture.submissionManager.connect(fixture.counterparty).submitWinner(pactId, fixture.creator.address);

    const pact = await fixture.pactManager.getPactCore(pactId);
    const feeSnapshot = await fixture.pactVault.pactFeeSnapshotOf(pactId);
    expect(pact[8]).to.equal(4n);
    expect(pact[9]).to.equal(fixture.creator.address);
    expect(pact[11]).to.equal(BigInt(CUSTOM_DECLARATION_WINDOW));
    expect(feeSnapshot[0]).to.equal(fixture.admin.address);
    expect(feeSnapshot[1]).to.equal(250n);
    expect(feeSnapshot[2]).to.equal(true);
    expect(await fixture.pactVault.availableBalance(fixture.creator.address)).to.equal(
      VAULT_DEPOSIT + (STAKE * 2n * 9_750n) / 10_000n - STAKE
    );
    expect(await fixture.pactVault.availableBalance(fixture.counterparty.address)).to.equal(VAULT_DEPOSIT - STAKE);
    expect(await fixture.pactVault.availableBalance(fixture.admin.address)).to.equal((STAKE * 2n * 250n) / 10_000n);
    expect(await fixture.pactVault.reservedBalance(fixture.creator.address)).to.equal(0n);
    expect(await fixture.pactVault.reservedBalance(fixture.counterparty.address)).to.equal(0n);
  });
});
