// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPactVault {
    function reserveStake(uint256 pactId, address user, uint256 amount) external;
    function releaseStake(uint256 pactId, address user) external returns (uint256 amount);
    function payoutWinner(uint256 pactId, address userA, address userB, address winner)
        external
        returns (uint256 netAmount, uint256 feeAmount);
    function splitPayout(uint256 pactId, address userA, address userB, uint16 userAShareBps)
        external
        returns (uint256 amountA, uint256 amountB);
}
