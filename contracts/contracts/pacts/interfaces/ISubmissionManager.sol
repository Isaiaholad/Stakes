// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISubmissionManager {
    function bothSubmitted(uint256 pactId) external view returns (bool);
    function declarationsMatch(uint256 pactId) external view returns (bool matched, address declaredWinner);
    function getDeclaration(uint256 pactId, address user)
        external
        view
        returns (bool submitted, uint64 submittedAt, address declaredWinner);
}
