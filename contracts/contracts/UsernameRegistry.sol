// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract UsernameRegistry {
    uint256 public constant MIN_USERNAME_LENGTH = 3;
    uint256 public constant MAX_USERNAME_LENGTH = 20;

    mapping(address => string) internal usernamesByAddress;
    mapping(address => bytes32) internal usernameHashesByAddress;
    mapping(bytes32 => address) internal ownersByUsernameHash;

    event UsernameSet(address indexed user, string username);
    event UsernameCleared(address indexed user, string username);

    function setUsername(string calldata username) external {
        bytes memory usernameBytes = bytes(username);
        require(_isValidUsername(usernameBytes), "invalid username");

        bytes32 nextHash = keccak256(usernameBytes);
        address currentOwner = ownersByUsernameHash[nextHash];
        require(currentOwner == address(0) || currentOwner == msg.sender, "username taken");

        bytes32 previousHash = usernameHashesByAddress[msg.sender];
        if (previousHash != bytes32(0) && previousHash != nextHash) {
            delete ownersByUsernameHash[previousHash];
        }

        ownersByUsernameHash[nextHash] = msg.sender;
        usernameHashesByAddress[msg.sender] = nextHash;
        usernamesByAddress[msg.sender] = username;

        emit UsernameSet(msg.sender, username);
    }

    function clearUsername() external {
        bytes32 previousHash = usernameHashesByAddress[msg.sender];
        require(previousHash != bytes32(0), "no username");

        string memory previousUsername = usernamesByAddress[msg.sender];

        delete ownersByUsernameHash[previousHash];
        delete usernameHashesByAddress[msg.sender];
        delete usernamesByAddress[msg.sender];

        emit UsernameCleared(msg.sender, previousUsername);
    }

    function usernameOf(address user) external view returns (string memory username) {
        return usernamesByAddress[user];
    }

    function resolveUsername(string calldata username) external view returns (address user) {
        return ownersByUsernameHash[keccak256(bytes(username))];
    }

    function _isValidUsername(bytes memory username) internal pure returns (bool) {
        uint256 length = username.length;
        if (length < MIN_USERNAME_LENGTH || length > MAX_USERNAME_LENGTH) {
            return false;
        }

        for (uint256 index = 0; index < length; index++) {
            bytes1 char = username[index];
            bool isNumber = char >= 0x30 && char <= 0x39;
            bool isLowercase = char >= 0x61 && char <= 0x7A;
            bool isUnderscore = char == 0x5F;

            if (!isNumber && !isLowercase && !isUnderscore) {
                return false;
            }
        }

        return true;
    }
}
