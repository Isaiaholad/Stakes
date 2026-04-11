// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStablecoin is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply,
        address initialHolder
    ) ERC20(name_, symbol_) {
        require(initialHolder != address(0), "holder=0");

        _customDecimals = decimals_;
        _mint(initialHolder, initialSupply);
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }
}
