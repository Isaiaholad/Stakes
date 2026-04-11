// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IProtocolControl {
    function paused() external view returns (bool);
    function hasRole(bytes32 role, address account) external view returns (bool);
}
