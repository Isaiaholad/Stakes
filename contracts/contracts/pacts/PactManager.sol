// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IProtocolControl} from "./interfaces/IProtocolControl.sol";
import {IPactVault} from "./interfaces/IPactVault.sol";
import {PactRoles} from "./libraries/PactRoles.sol";
import {PactTypes} from "./libraries/PactTypes.sol";

contract PactManager {
    uint64 public constant ACCEPTANCE_TIMEOUT = 12 hours;
    uint64 public constant MIN_EVENT_DURATION = 5 minutes;
    uint64 public constant DEFAULT_DECLARATION_WINDOW = 20 minutes;
    uint64 public constant MIN_DECLARATION_WINDOW = 5 minutes;
    uint64 public constant MAX_DECLARATION_WINDOW = 60 minutes;

    struct PactCore {
        address creator;
        address counterparty;
        uint256 stakeAmount;
        uint64 acceptanceDeadline;
        uint64 eventDuration;
        uint64 declarationWindow;
        uint64 eventStartedAt;
        uint64 eventEnd;
        uint64 submissionDeadline;
        PactTypes.PactStatus status;
        address winner;
        bytes32 agreedResultHash;
    }

    IProtocolControl public immutable protocolControl;
    IPactVault public immutable vault;

    uint256 public nextPactId = 1;
    uint256 public minimumStakeAmount;
    address public submissionManager;
    address public resolutionManager;
    bool public systemContractsInitialized;

    mapping(uint256 => PactCore) internal pacts;
    mapping(uint256 => string) public descriptions;
    mapping(uint256 => string) public eventTypes;

    event PactCreated(
        uint256 indexed pactId,
        address indexed creator,
        address indexed counterparty,
        uint256 stakeAmount,
        uint64 acceptanceDeadline,
        uint64 eventDuration,
        uint64 declarationWindow,
        string description,
        string eventType
    );
    event PactJoined(
        uint256 indexed pactId,
        address indexed counterparty,
        uint64 eventStartedAt,
        uint64 eventEnd,
        uint64 submissionDeadline,
        uint64 declarationWindow
    );
    event PactCancelled(uint256 indexed pactId);
    event PactExpired(uint256 indexed pactId);
    event PactDisputed(uint256 indexed pactId);
    event PactResolved(
        uint256 indexed pactId,
        address indexed winner,
        bytes32 indexed agreedResultHash,
        address resolvedBy
    );
    event SystemContractsInitialized(address indexed submissionManager, address indexed resolutionManager);
    event SystemContractsRewired(address indexed submissionManager, address indexed resolutionManager);
    event MinimumStakeAmountUpdated(
        uint256 previousMinimumStakeAmount,
        uint256 newMinimumStakeAmount,
        address indexed updatedBy
    );

    constructor(address protocolControl_, address vault_, uint256 minimumStakeAmount_) {
        require(protocolControl_ != address(0), "control=0");
        require(vault_ != address(0), "vault=0");
        require(minimumStakeAmount_ > 0, "min stake=0");

        protocolControl = IProtocolControl(protocolControl_);
        vault = IPactVault(vault_);
        minimumStakeAmount = minimumStakeAmount_;
    }

    modifier onlyAdmin() {
        require(protocolControl.hasRole(PactRoles.ADMIN_ROLE, msg.sender), "not admin");
        _;
    }

    modifier onlyResolutionManager() {
        require(msg.sender == resolutionManager, "not resolution manager");
        _;
    }

    modifier notPaused() {
        require(!protocolControl.paused(), "paused");
        _;
    }

    function setSystemContracts(address submissionManager_, address resolutionManager_) external onlyAdmin {
        require(!systemContractsInitialized, "system initialized");

        _setSystemContracts(submissionManager_, resolutionManager_);
        systemContractsInitialized = true;

        emit SystemContractsInitialized(submissionManager_, resolutionManager_);
    }

    function rewireSystemContracts(address submissionManager_, address resolutionManager_) external onlyAdmin {
        require(systemContractsInitialized, "system not initialized");
        require(protocolControl.paused(), "pause first");

        _setSystemContracts(submissionManager_, resolutionManager_);

        emit SystemContractsRewired(submissionManager_, resolutionManager_);
    }

    function setMinimumStakeAmount(uint256 minimumStakeAmount_) external onlyAdmin {
        require(minimumStakeAmount_ > 0, "min stake=0");

        uint256 previousMinimumStakeAmount = minimumStakeAmount;
        minimumStakeAmount = minimumStakeAmount_;

        emit MinimumStakeAmountUpdated(previousMinimumStakeAmount, minimumStakeAmount_, msg.sender);
    }

    function createPact(
        address counterparty,
        string calldata description,
        string calldata eventType,
        uint64 eventDuration,
        uint256 stakeAmount
    ) external notPaused returns (uint256 pactId) {
        return
            _createPact(
                counterparty,
                description,
                eventType,
                eventDuration,
                DEFAULT_DECLARATION_WINDOW,
                stakeAmount
            );
    }

    function createPact(
        address counterparty,
        string calldata description,
        string calldata eventType,
        uint64 eventDuration,
        uint64 declarationWindow,
        uint256 stakeAmount
    ) external notPaused returns (uint256 pactId) {
        return _createPact(counterparty, description, eventType, eventDuration, declarationWindow, stakeAmount);
    }

    function joinPact(uint256 pactId) external notPaused {
        PactCore storage pact = pacts[pactId];
        require(pact.status == PactTypes.PactStatus.Proposed, "not proposed");
        require(block.timestamp <= pact.acceptanceDeadline, "acceptance expired");
        require(msg.sender != pact.creator, "creator cannot join");

        if (pact.counterparty == address(0)) {
            pact.counterparty = msg.sender;
        } else {
            require(msg.sender == pact.counterparty, "not counterparty");
        }

        vault.reserveStake(pactId, msg.sender, pact.stakeAmount);
        pact.eventStartedAt = uint64(block.timestamp);
        pact.eventEnd = pact.eventStartedAt + pact.eventDuration;
        pact.submissionDeadline = pact.eventEnd + pact.declarationWindow;
        pact.status = PactTypes.PactStatus.Active;

        emit PactJoined(
            pactId,
            msg.sender,
            pact.eventStartedAt,
            pact.eventEnd,
            pact.submissionDeadline,
            pact.declarationWindow
        );
    }

    function cancelUnjoinedPact(uint256 pactId) external notPaused {
        PactCore storage pact = pacts[pactId];
        require(pact.status == PactTypes.PactStatus.Proposed, "not proposed");
        require(msg.sender == pact.creator, "not creator");

        pact.status = PactTypes.PactStatus.Cancelled;
        vault.releaseStake(pactId, pact.creator);

        emit PactCancelled(pactId);
    }

    function cancelExpiredPact(uint256 pactId) external notPaused {
        PactCore storage pact = pacts[pactId];
        require(pact.status == PactTypes.PactStatus.Proposed, "not proposed");
        require(block.timestamp > pact.acceptanceDeadline, "acceptance open");

        pact.status = PactTypes.PactStatus.Cancelled;
        vault.releaseStake(pactId, pact.creator);

        emit PactExpired(pactId);
    }

    function markDisputed(uint256 pactId) external onlyResolutionManager notPaused {
        PactCore storage pact = pacts[pactId];
        require(pact.status == PactTypes.PactStatus.Active, "bad status");

        pact.status = PactTypes.PactStatus.Disputed;
        emit PactDisputed(pactId);
    }

    function markResolved(
        uint256 pactId,
        address winner,
        bytes32 agreedResultHash,
        address resolvedBy
    ) external onlyResolutionManager notPaused {
        PactCore storage pact = pacts[pactId];
        require(
            pact.status == PactTypes.PactStatus.Active || pact.status == PactTypes.PactStatus.Disputed,
            "bad status"
        );

        pact.status = PactTypes.PactStatus.Resolved;
        pact.winner = winner;
        pact.agreedResultHash = agreedResultHash;

        emit PactResolved(pactId, winner, agreedResultHash, resolvedBy);
    }

    function getPactCore(uint256 pactId)
        external
        view
        returns (
            address creator,
            address counterparty,
            uint256 stakeAmount,
            uint64 acceptanceDeadline,
            uint64 eventDuration,
            uint64 eventStartedAt,
            uint64 eventEnd,
            uint64 submissionDeadline,
            PactTypes.PactStatus status,
            address winner,
            bytes32 agreedResultHash,
            uint64 declarationWindow
        )
    {
        PactCore storage pact = pacts[pactId];
        return (
            pact.creator,
            pact.counterparty,
            pact.stakeAmount,
            pact.acceptanceDeadline,
            pact.eventDuration,
            pact.eventStartedAt,
            pact.eventEnd,
            pact.submissionDeadline,
            pact.status,
            pact.winner,
            pact.agreedResultHash,
            pact.declarationWindow
        );
    }

    function getPactStatus(uint256 pactId) external view returns (PactTypes.PactStatus status) {
        return pacts[pactId].status;
    }

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
        )
    {
        PactCore storage pact = pacts[pactId];
        return (
            pact.acceptanceDeadline,
            pact.eventStartedAt,
            pact.eventEnd,
            pact.submissionDeadline,
            pact.eventDuration,
            pact.declarationWindow
        );
    }

    function getParties(uint256 pactId) external view returns (address creator, address counterparty) {
        PactCore storage pact = pacts[pactId];
        return (pact.creator, pact.counterparty);
    }

    function _setSystemContracts(address submissionManager_, address resolutionManager_) internal {
        require(submissionManager_ != address(0), "submission=0");
        require(resolutionManager_ != address(0), "resolution=0");

        submissionManager = submissionManager_;
        resolutionManager = resolutionManager_;
    }

    function _createPact(
        address counterparty,
        string calldata description,
        string calldata eventType,
        uint64 eventDuration,
        uint64 declarationWindow,
        uint256 stakeAmount
    ) internal returns (uint256 pactId) {
        require(counterparty != msg.sender, "same party");
        require(stakeAmount >= minimumStakeAmount, "stake below minimum");
        require(eventDuration >= MIN_EVENT_DURATION, "bad duration");
        require(
            declarationWindow >= MIN_DECLARATION_WINDOW && declarationWindow <= MAX_DECLARATION_WINDOW,
            "bad declaration window"
        );

        pactId = nextPactId++;
        pacts[pactId] = PactCore({
            creator: msg.sender,
            counterparty: counterparty,
            stakeAmount: stakeAmount,
            acceptanceDeadline: uint64(block.timestamp) + ACCEPTANCE_TIMEOUT,
            eventDuration: eventDuration,
            declarationWindow: declarationWindow,
            eventStartedAt: 0,
            eventEnd: 0,
            submissionDeadline: 0,
            status: PactTypes.PactStatus.Proposed,
            winner: address(0),
            agreedResultHash: bytes32(0)
        });

        descriptions[pactId] = description;
        eventTypes[pactId] = eventType;

        vault.reserveStake(pactId, msg.sender, stakeAmount);

        emit PactCreated(
            pactId,
            msg.sender,
            counterparty,
            stakeAmount,
            pacts[pactId].acceptanceDeadline,
            eventDuration,
            declarationWindow,
            description,
            eventType
        );
    }
}
