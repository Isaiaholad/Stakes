// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IProtocolControl} from "./interfaces/IProtocolControl.sol";
import {IPactManager} from "./interfaces/IPactManager.sol";
import {PactTypes} from "./libraries/PactTypes.sol";

interface IDeclarationResolutionManager {
    function processDeclarationOutcome(uint256 pactId, address triggeredBy) external;
}

contract SubmissionManager {
    struct Declaration {
        bool submitted;
        uint64 submittedAt;
        address declaredWinner;
    }

    IProtocolControl public immutable protocolControl;
    IPactManager public immutable pactManager;

    mapping(uint256 => mapping(address => Declaration)) internal declarations;

    event WinnerDeclared(uint256 indexed pactId, address indexed user, address indexed declaredWinner);

    constructor(address protocolControl_, address pactManager_) {
        require(protocolControl_ != address(0), "control=0");
        require(pactManager_ != address(0), "manager=0");

        protocolControl = IProtocolControl(protocolControl_);
        pactManager = IPactManager(pactManager_);
    }

    modifier notPaused() {
        require(!protocolControl.paused(), "paused");
        _;
    }

    modifier onlyParticipant(uint256 pactId) {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        require(msg.sender == creator || msg.sender == counterparty, "not participant");
        _;
    }

    function submitWinner(uint256 pactId, address declaredWinner) external notPaused onlyParticipant(pactId) {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        (, , uint64 eventEnd, uint64 submissionDeadline, , ) = pactManager.getPactWindow(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Active, "not active");
        require(block.timestamp >= eventEnd, "event active");
        require(block.timestamp <= submissionDeadline, "deadline passed");
        require(declaredWinner == creator || declaredWinner == counterparty || declaredWinner == address(0), "bad winner");
        require(!declarations[pactId][msg.sender].submitted, "already submitted");

        declarations[pactId][msg.sender] = Declaration({
            submitted: true,
            submittedAt: uint64(block.timestamp),
            declaredWinner: declaredWinner
        });

        emit WinnerDeclared(pactId, msg.sender, declaredWinner);

        if (declarations[pactId][creator].submitted && declarations[pactId][counterparty].submitted) {
            address resolutionManager = pactManager.resolutionManager();
            if (resolutionManager != address(0)) {
                IDeclarationResolutionManager(resolutionManager).processDeclarationOutcome(pactId, msg.sender);
            }
        }
    }

    function bothSubmitted(uint256 pactId) external view returns (bool) {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        return declarations[pactId][creator].submitted && declarations[pactId][counterparty].submitted;
    }

    function declarationsMatch(uint256 pactId) external view returns (bool matched, address declaredWinner) {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        Declaration storage creatorDeclaration = declarations[pactId][creator];
        Declaration storage counterpartyDeclaration = declarations[pactId][counterparty];

        if (!creatorDeclaration.submitted || !counterpartyDeclaration.submitted) {
            return (false, address(0));
        }

        matched = creatorDeclaration.declaredWinner == counterpartyDeclaration.declaredWinner;
        declaredWinner = creatorDeclaration.declaredWinner;
    }

    function getDeclaration(uint256 pactId, address user)
        external
        view
        returns (bool submitted, uint64 submittedAt, address declaredWinner)
    {
        Declaration storage declaration = declarations[pactId][user];
        return (declaration.submitted, declaration.submittedAt, declaration.declaredWinner);
    }
}
