// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PactTypes} from "../libraries/PactTypes.sol";

interface IPactManager {
    function getPactStatus(uint256 pactId) external view returns (PactTypes.PactStatus status);
    function resolutionManager() external view returns (address);
    function getPactWindow(uint256 pactId)
        external
        view
        returns (
            uint64 acceptanceDeadline,
            uint64 eventStartedAt,
            uint64 eventEnd,
            uint64 submissionDeadline,
            uint64 eventDuration,
            uint64 declarationWindow
        );
    function getParties(uint256 pactId) external view returns (address creator, address counterparty);
    function markDisputed(uint256 pactId) external;
    function markResolved(uint256 pactId, address winner, bytes32 agreedResultHash, address resolvedBy) external;
}
