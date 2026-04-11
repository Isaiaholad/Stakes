// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl as OZAccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PactRoles} from "./libraries/PactRoles.sol";

contract ProtocolControl is OZAccessControl, Pausable {
    event BootstrapComplete(address indexed admin);

    constructor(address admin) {
        require(admin != address(0), "admin=0");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PactRoles.ADMIN_ROLE, admin);
        _grantRole(PactRoles.ARBITER_ROLE, admin);
        _grantRole(PactRoles.OPERATOR_ROLE, admin);

        _setRoleAdmin(PactRoles.ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(PactRoles.ARBITER_ROLE, PactRoles.ADMIN_ROLE);
        _setRoleAdmin(PactRoles.OPERATOR_ROLE, PactRoles.ADMIN_ROLE);

        emit BootstrapComplete(admin);
    }

    modifier onlyAdmin() {
        require(hasRole(PactRoles.ADMIN_ROLE, msg.sender), "not admin");
        _;
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }
}
