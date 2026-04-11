// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library PactRoles {
    bytes32 internal constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 internal constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 internal constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
}
