pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract MagicIsCodeFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error BatchNotClosed();
    error ReplayDetected();
    error StateMismatch();
    error InvalidBatchId();
    error InvalidCooldown();

    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event SpellSubmitted(address indexed provider, uint256 indexed batchId, uint256 encryptedValue);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 decryptedValue);

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct SpellData {
        euint32 encryptedValue;
        bool exists;
    }

    mapping(address => bool) public isProvider;
    mapping(uint256 => SpellData) public spellData;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    address public owner;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    bool public batchOpen;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        cooldownSeconds = 60; 
        currentBatchId = 0;
        batchOpen = false;
        paused = false;
    }

    function addProvider(address _provider) external onlyOwner {
        if (!isProvider[_provider]) {
            isProvider[_provider] = true;
            emit ProviderAdded(_provider);
        }
    }

    function removeProvider(address _provider) external onlyOwner {
        if (isProvider[_provider]) {
            isProvider[_provider] = false;
            emit ProviderRemoved(_provider);
        }
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldownSeconds(uint256 _cooldownSeconds) external onlyOwner {
        if (_cooldownSeconds == 0) revert InvalidCooldown();
        emit CooldownSet(cooldownSeconds, _cooldownSeconds);
        cooldownSeconds = _cooldownSeconds;
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchNotClosed();
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchClosed();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitSpell(uint256 _batchId, euint32 _encryptedValue) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen || _batchId != currentBatchId) revert InvalidBatchId();
        if (!_encryptedValue.isInitialized()) revert("FHE: euint32 not initialized");

        spellData[_batchId] = SpellData({ encryptedValue: _encryptedValue, exists: true });
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit SpellSubmitted(msg.sender, _batchId, _encryptedValue.toBytes32());
    }

    function requestSpellDecryption(uint256 _batchId) external onlyProvider whenNotPaused checkDecryptionCooldown {
        if (spellData[_batchId].exists == false) revert InvalidBatchId();

        euint32 memory encryptedSpellValue = spellData[_batchId].encryptedValue;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedSpellValue.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: _batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, _batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayDetected();

        uint256 batchId = decryptionContexts[requestId].batchId;
        if (spellData[batchId].exists == false) revert InvalidBatchId();

        euint32 memory encryptedSpellValue = spellData[batchId].encryptedValue;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = encryptedSpellValue.toBytes32();

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 decryptedValue = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, decryptedValue);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage s, uint32 val) internal {
        if (!s.isInitialized()) {
            s = FHE.asEuint32(val);
        }
    }

    function _requireInitialized(euint32 storage s) internal view {
        if (!s.isInitialized()) {
            revert("FHE: euint32 not initialized");
        }
    }
}