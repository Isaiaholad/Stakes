// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library PactTypes {
    enum PactStatus {
        None,
        Proposed,
        Active,
        Disputed,
        Resolved,
        Cancelled
    }
}
