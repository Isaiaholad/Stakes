// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IProtocolControl} from "./interfaces/IProtocolControl.sol";
import {PactRoles} from "./libraries/PactRoles.sol";

contract PactVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    struct PactFeeSnapshot {
        address feeRecipient;
        uint16 feeBps;
        bool initialized;
    }

    IERC20 public immutable stablecoin;
    IProtocolControl public immutable protocolControl;

    address public pactManager;
    address public resolutionManager;
    address public feeRecipient;
    uint16 public feeBps;
    bool public systemContractsInitialized;

    mapping(address => uint256) public availableBalance;
    mapping(address => uint256) public reservedBalance;
    mapping(uint256 => mapping(address => uint256)) public pactStakeOf;
    mapping(uint256 => PactFeeSnapshot) public pactFeeSnapshotOf;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event StakeReserved(uint256 indexed pactId, address indexed user, uint256 amount);
    event StakeReleased(uint256 indexed pactId, address indexed user, uint256 amount);
    event WinnerPaid(
        uint256 indexed pactId,
        address indexed winner,
        uint256 grossAmount,
        uint256 netAmount,
        uint256 feeAmount,
        address feeRecipient,
        uint16 feeBps
    );
    event SplitPaid(uint256 indexed pactId, address indexed userA, address indexed userB, uint256 amountA, uint256 amountB);
    event PactFeeSnapshotCaptured(uint256 indexed pactId, address indexed feeRecipient, uint16 feeBps);
    event SystemContractsInitialized(address indexed pactManager, address indexed resolutionManager);
    event SystemContractsRewired(address indexed pactManager, address indexed resolutionManager);
    event FeeConfigUpdated(address indexed feeRecipient, uint16 feeBps, address indexed updatedBy);

    constructor(address stablecoin_, address protocolControl_) {
        require(stablecoin_ != address(0), "token=0");
        require(protocolControl_ != address(0), "control=0");

        stablecoin = IERC20(stablecoin_);
        protocolControl = IProtocolControl(protocolControl_);
    }

    modifier onlyAdmin() {
        require(protocolControl.hasRole(PactRoles.ADMIN_ROLE, msg.sender), "not admin");
        _;
    }

    modifier onlyPactManager() {
        require(msg.sender == pactManager, "not pact manager");
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

    function setSystemContracts(address pactManager_, address resolutionManager_) external onlyAdmin {
        require(!systemContractsInitialized, "system initialized");

        _setSystemContracts(pactManager_, resolutionManager_);
        systemContractsInitialized = true;

        emit SystemContractsInitialized(pactManager_, resolutionManager_);
    }

    function rewireSystemContracts(address pactManager_, address resolutionManager_) external onlyAdmin {
        require(systemContractsInitialized, "system not initialized");
        require(protocolControl.paused(), "pause first");

        _setSystemContracts(pactManager_, resolutionManager_);

        emit SystemContractsRewired(pactManager_, resolutionManager_);
    }

    function setFeeConfig(address feeRecipient_, uint16 feeBps_) external onlyAdmin {
        require(feeBps_ <= 1_000, "fee too high");
        require(feeBps_ == 0 || feeRecipient_ != address(0), "recipient=0");

        feeRecipient = feeRecipient_;
        feeBps = feeBps_;

        emit FeeConfigUpdated(feeRecipient_, feeBps_, msg.sender);
    }

    function deposit(uint256 amount) external nonReentrant notPaused {
        require(amount > 0, "amount=0");

        availableBalance[msg.sender] += amount;
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant notPaused {
        require(amount > 0, "amount=0");
        require(availableBalance[msg.sender] >= amount, "insufficient");

        availableBalance[msg.sender] -= amount;
        stablecoin.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function reserveStake(uint256 pactId, address user, uint256 amount) external onlyPactManager notPaused {
        require(amount > 0, "amount=0");
        require(availableBalance[user] >= amount, "insufficient");

        _snapshotFeeConfigIfNeeded(pactId);
        availableBalance[user] -= amount;
        reservedBalance[user] += amount;
        pactStakeOf[pactId][user] += amount;

        emit StakeReserved(pactId, user, amount);
    }

    function releaseStake(uint256 pactId, address user) external onlyPactManager notPaused returns (uint256 amount) {
        amount = pactStakeOf[pactId][user];
        require(amount > 0, "nothing reserved");

        pactStakeOf[pactId][user] = 0;
        reservedBalance[user] -= amount;
        availableBalance[user] += amount;

        emit StakeReleased(pactId, user, amount);
    }

    function payoutWinner(uint256 pactId, address userA, address userB, address winner)
        external
        onlyResolutionManager
        notPaused
        returns (uint256 netAmount, uint256 feeAmount)
    {
        require(winner == userA || winner == userB, "bad winner");

        PactFeeSnapshot memory feeSnapshot = pactFeeSnapshotOf[pactId];
        require(feeSnapshot.initialized, "fee snapshot missing");

        uint256 totalEscrow = _clearEscrow(pactId, userA, userB);
        feeAmount = (totalEscrow * feeSnapshot.feeBps) / BPS_DENOMINATOR;
        netAmount = totalEscrow - feeAmount;

        availableBalance[winner] += netAmount;
        if (feeAmount > 0) {
            availableBalance[feeSnapshot.feeRecipient] += feeAmount;
        }

        emit WinnerPaid(
            pactId,
            winner,
            totalEscrow,
            netAmount,
            feeAmount,
            feeSnapshot.feeRecipient,
            feeSnapshot.feeBps
        );
    }

    function splitPayout(uint256 pactId, address userA, address userB, uint16 userAShareBps)
        external
        onlyResolutionManager
        notPaused
        returns (uint256 amountA, uint256 amountB)
    {
        require(userAShareBps <= BPS_DENOMINATOR, "bad split");

        PactFeeSnapshot memory feeSnapshot = pactFeeSnapshotOf[pactId];
        require(feeSnapshot.initialized, "fee snapshot missing");

        uint256 totalEscrow = _clearEscrow(pactId, userA, userB);
        uint256 feeAmount = (totalEscrow * feeSnapshot.feeBps) / BPS_DENOMINATOR;
        uint256 distributableAmount = totalEscrow - feeAmount;
        amountA = (distributableAmount * userAShareBps) / BPS_DENOMINATOR;
        amountB = distributableAmount - amountA;

        availableBalance[userA] += amountA;
        availableBalance[userB] += amountB;
        if (feeAmount > 0) {
            availableBalance[feeSnapshot.feeRecipient] += feeAmount;
        }

        emit SplitPaid(pactId, userA, userB, amountA, amountB);
    }

    function _clearEscrow(uint256 pactId, address userA, address userB) internal returns (uint256 totalEscrow) {
        uint256 stakeA = _consumePactReserve(pactId, userA);
        uint256 stakeB = _consumePactReserve(pactId, userB);

        totalEscrow = stakeA + stakeB;
    }

    function _consumePactReserve(uint256 pactId, address user) internal returns (uint256 stakeAmount) {
        stakeAmount = pactStakeOf[pactId][user];
        require(stakeAmount > 0, "missing stake");

        uint256 reserve = reservedBalance[user];
        pactStakeOf[pactId][user] = 0;
        reservedBalance[user] = reserve >= stakeAmount ? reserve - stakeAmount : 0;
    }

    function _setSystemContracts(address pactManager_, address resolutionManager_) internal {
        require(pactManager_ != address(0), "pact manager=0");
        require(resolutionManager_ != address(0), "resolution manager=0");

        pactManager = pactManager_;
        resolutionManager = resolutionManager_;
    }

    function _snapshotFeeConfigIfNeeded(uint256 pactId) internal {
        if (pactFeeSnapshotOf[pactId].initialized) {
            return;
        }

        pactFeeSnapshotOf[pactId] = PactFeeSnapshot({
            feeRecipient: feeRecipient,
            feeBps: feeBps,
            initialized: true
        });

        emit PactFeeSnapshotCaptured(pactId, feeRecipient, feeBps);
    }
}
