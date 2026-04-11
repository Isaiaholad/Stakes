// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IProtocolControl} from "./interfaces/IProtocolControl.sol";
import {IPactManager} from "./interfaces/IPactManager.sol";
import {IPactVault} from "./interfaces/IPactVault.sol";
import {ISubmissionManager} from "./interfaces/ISubmissionManager.sol";
import {PactRoles} from "./libraries/PactRoles.sol";
import {PactTypes} from "./libraries/PactTypes.sol";

contract PactResolutionManager {
    uint16 public constant SPLIT_BPS = 5_000;
    uint64 public constant SINGLE_SUBMITTER_GRACE_PERIOD = 30 minutes;
    uint64 public constant DISPUTE_TIMEOUT = 7 days;

    IProtocolControl public immutable protocolControl;
    IPactManager public immutable pactManager;
    ISubmissionManager public immutable submissionManager;
    IPactVault public immutable vault;

    mapping(uint256 => mapping(address => string)) internal disputeEvidence;
    mapping(uint256 => uint64) public disputeOpenedAt;

    event PactAutoResolved(
        uint256 indexed pactId,
        address indexed winner,
        address indexed triggeredBy,
        bytes32 resolutionRef
    );
    event PactDisputed(uint256 indexed pactId, address indexed openedBy);
    event PactArbiterResolved(
        uint256 indexed pactId,
        address indexed winner,
        address indexed resolver,
        bytes32 resolutionRef
    );
    event PactArbiterSplit(uint256 indexed pactId, address indexed resolver, uint16 creatorShareBps, bytes32 resolutionRef);
    event PactDisputeTimedOut(uint256 indexed pactId, address indexed triggeredBy);
    event DisputeEvidenceSubmitted(uint256 indexed pactId, address indexed user, string evidenceUri);

    constructor(address protocolControl_, address pactManager_, address submissionManager_, address vault_) {
        require(protocolControl_ != address(0), "control=0");
        require(pactManager_ != address(0), "manager=0");
        require(submissionManager_ != address(0), "submission=0");
        require(vault_ != address(0), "vault=0");

        protocolControl = IProtocolControl(protocolControl_);
        pactManager = IPactManager(pactManager_);
        submissionManager = ISubmissionManager(submissionManager_);
        vault = IPactVault(vault_);
    }

    modifier onlyArbiter() {
        require(protocolControl.hasRole(PactRoles.ARBITER_ROLE, msg.sender), "not arbiter");
        _;
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

    modifier onlySubmissionManager() {
        require(msg.sender == address(submissionManager), "not submission manager");
        _;
    }

    function processDeclarationOutcome(uint256 pactId, address triggeredBy) external onlySubmissionManager notPaused {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Active, "bad status");
        require(submissionManager.bothSubmitted(pactId), "not submitted");

        (bool matched, address winner) = submissionManager.declarationsMatch(pactId);
        if (matched) {
            _resolveByWinner(pactId, creator, counterparty, winner, bytes32(0), triggeredBy);
            emit PactAutoResolved(pactId, winner, triggeredBy, bytes32(0));
            return;
        }

        _openDispute(pactId, triggeredBy);
    }

    function finalizeMatchedResult(uint256 pactId) external notPaused {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Active, "bad status");
        require(submissionManager.bothSubmitted(pactId), "not submitted");

        (bool matched, address winner) = submissionManager.declarationsMatch(pactId);
        require(matched, "mismatch");

        _resolveByWinner(pactId, creator, counterparty, winner, bytes32(0), msg.sender);
        emit PactAutoResolved(pactId, winner, msg.sender, bytes32(0));
    }

    function openDisputeFromMismatch(uint256 pactId) external notPaused {
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Active, "bad status");
        require(submissionManager.bothSubmitted(pactId), "not submitted");

        (bool matched, ) = submissionManager.declarationsMatch(pactId);
        require(!matched, "already matched");

        _openDispute(pactId, msg.sender);
    }

    function openDisputeFromUnansweredDeclaration(uint256 pactId) external notPaused onlyParticipant(pactId) {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        (, , , uint64 submissionDeadline, , ) = pactManager.getPactWindow(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Active, "bad status");
        require(block.timestamp > submissionDeadline, "deadline open");
        require(block.timestamp <= uint256(submissionDeadline) + SINGLE_SUBMITTER_GRACE_PERIOD, "grace closed");

        (bool creatorSubmitted, , ) = submissionManager.getDeclaration(pactId, creator);
        (bool counterpartySubmitted, , ) = submissionManager.getDeclaration(pactId, counterparty);

        require(creatorSubmitted != counterpartySubmitted, "not lone declaration");
        if (creatorSubmitted) {
            require(msg.sender == counterparty, "only missing participant");
        } else {
            require(msg.sender == creator, "only missing participant");
        }

        _openDispute(pactId, msg.sender);
    }

    function settleAfterDeclarationWindow(uint256 pactId) external notPaused {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        (, , , uint64 submissionDeadline, , ) = pactManager.getPactWindow(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Active, "bad status");
        require(block.timestamp > submissionDeadline, "deadline open");

        (bool creatorSubmitted, , address creatorWinner) = submissionManager.getDeclaration(pactId, creator);
        (bool counterpartySubmitted, , address counterpartyWinner) = submissionManager.getDeclaration(pactId, counterparty);

        if (!creatorSubmitted && !counterpartySubmitted) {
            _resolveByWinner(pactId, creator, counterparty, address(0), bytes32(0), msg.sender);
            emit PactAutoResolved(pactId, address(0), msg.sender, bytes32(0));
            return;
        }

        if (creatorSubmitted && !counterpartySubmitted) {
            require(
                block.timestamp > uint256(submissionDeadline) + SINGLE_SUBMITTER_GRACE_PERIOD,
                "single submitter grace"
            );
            _resolveByWinner(pactId, creator, counterparty, creatorWinner, bytes32(0), msg.sender);
            emit PactAutoResolved(pactId, creatorWinner, msg.sender, bytes32(0));
            return;
        }

        if (!creatorSubmitted && counterpartySubmitted) {
            require(
                block.timestamp > uint256(submissionDeadline) + SINGLE_SUBMITTER_GRACE_PERIOD,
                "single submitter grace"
            );
            _resolveByWinner(pactId, creator, counterparty, counterpartyWinner, bytes32(0), msg.sender);
            emit PactAutoResolved(pactId, counterpartyWinner, msg.sender, bytes32(0));
            return;
        }

        (bool matched, address declaredWinner) = submissionManager.declarationsMatch(pactId);
        if (matched) {
            _resolveByWinner(pactId, creator, counterparty, declaredWinner, bytes32(0), msg.sender);
            emit PactAutoResolved(pactId, declaredWinner, msg.sender, bytes32(0));
            return;
        }

        _openDispute(pactId, msg.sender);
    }

    function submitDisputeEvidence(uint256 pactId, string calldata evidenceUri) external notPaused onlyParticipant(pactId) {
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Disputed, "not disputed");
        require(bytes(evidenceUri).length > 0, "evidence=0");

        disputeEvidence[pactId][msg.sender] = evidenceUri;
        emit DisputeEvidenceSubmitted(pactId, msg.sender, evidenceUri);
    }

    function getDisputeEvidence(uint256 pactId, address user) external view returns (string memory evidenceUri) {
        return disputeEvidence[pactId][user];
    }

    function adminResolveWinner(uint256 pactId, address winner, bytes32 resolutionRef) external onlyArbiter notPaused {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Disputed, "not disputed");
        require(winner == creator || winner == counterparty || winner == address(0), "bad winner");
        _requireReviewReady(pactId, creator, counterparty);

        _resolveByWinner(pactId, creator, counterparty, winner, resolutionRef, msg.sender);
        emit PactArbiterResolved(pactId, winner, msg.sender, resolutionRef);
    }

    function adminResolveSplit(uint256 pactId, uint16 creatorShareBps, bytes32 resolutionRef)
        external
        onlyArbiter
        notPaused
    {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);

        require(status == PactTypes.PactStatus.Disputed, "not disputed");
        _requireReviewReady(pactId, creator, counterparty);
        vault.splitPayout(pactId, creator, counterparty, creatorShareBps);

        _clearDisputeState(pactId, creator, counterparty);
        pactManager.markResolved(pactId, address(0), resolutionRef, msg.sender);
        emit PactArbiterSplit(pactId, msg.sender, creatorShareBps, resolutionRef);
    }

    function forceSplitAfterDisputeTimeout(uint256 pactId) external notPaused onlyParticipant(pactId) {
        (address creator, address counterparty) = pactManager.getParties(pactId);
        PactTypes.PactStatus status = pactManager.getPactStatus(pactId);
        uint64 openedAt = disputeOpenedAt[pactId];

        require(status == PactTypes.PactStatus.Disputed, "not disputed");
        require(openedAt > 0, "dispute not opened");
        require(block.timestamp > uint256(openedAt) + DISPUTE_TIMEOUT, "dispute timeout open");

        _resolveByWinner(pactId, creator, counterparty, address(0), bytes32(0), msg.sender);
        emit PactDisputeTimedOut(pactId, msg.sender);
    }

    function _resolveByWinner(
        uint256 pactId,
        address creator,
        address counterparty,
        address winner,
        bytes32 resolutionRef,
        address resolvedBy
    ) internal {
        if (winner == address(0)) {
            vault.splitPayout(pactId, creator, counterparty, SPLIT_BPS);
        } else {
            vault.payoutWinner(pactId, creator, counterparty, winner);
        }

        _clearDisputeState(pactId, creator, counterparty);
        pactManager.markResolved(pactId, winner, resolutionRef, resolvedBy);
    }

    function _openDispute(uint256 pactId, address openedBy) internal {
        pactManager.markDisputed(pactId);
        disputeOpenedAt[pactId] = uint64(block.timestamp);
        emit PactDisputed(pactId, openedBy);
    }

    function _clearDisputeState(uint256 pactId, address creator, address counterparty) internal {
        if (disputeOpenedAt[pactId] == 0) {
            return;
        }

        delete disputeOpenedAt[pactId];
        delete disputeEvidence[pactId][creator];
        delete disputeEvidence[pactId][counterparty];
    }

    function _requireReviewReady(uint256 pactId, address creator, address counterparty) internal view {
        bool creatorHasEvidence = bytes(disputeEvidence[pactId][creator]).length > 0;
        bool counterpartyHasEvidence = bytes(disputeEvidence[pactId][counterparty]).length > 0;

        require(creatorHasEvidence || counterpartyHasEvidence, "evidence required");
    }
}
