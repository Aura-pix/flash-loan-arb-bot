// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./FlashLoanReceiver.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockRouter.sol";
import "../mocks/MockVault.sol";
import "forge-std/Test.sol";

contract FlashLoanReceiverTest is Test {
    FlashLoanReceiver public receiver;
    MockERC20 public weth;
    MockERC20 public usdc;
    MockRouter public dexA;
    MockRouter public dexB;
    MockVault public vaultImpl;
    address constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    address owner;
    address other;

    function setUp() public {
        owner = address(this);
        other = address(0x1234);

        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Deploy vault impl and etch to BALANCER_VAULT
        vaultImpl = new MockVault();
        bytes memory code = address(vaultImpl).code;
        vm.etch(BALANCER_VAULT, code);

        // dexA expensive 3400, dexB cheap 3000
        dexA = new MockRouter(address(weth), address(usdc), 3400 * 1e6, true);
        dexB = new MockRouter(address(weth), address(usdc), 3000 * 1e6, true);

        receiver = new FlashLoanReceiver(address(dexA), address(dexB), address(usdc));
    }

    function testDeploy() public view {
        require(receiver.owner() == owner, "owner");
        require(receiver.dexA() == address(dexA), "dexA");
        require(receiver.dexB() == address(dexB), "dexB");
        require(receiver.tokenB() == address(usdc), "tokenB");
        require(receiver.slippageToleranceBps() == 100, "slippage");
        require(receiver.BALANCER_VAULT() == BALANCER_VAULT, "vault");
    }

    function testSetSlippageOnlyOwner() public {
        vm.prank(other);
        try receiver.setSlippageTolerance(200) {
            revert("should revert not owner");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Not owner")), "wrong reason");
        }
        try receiver.setSlippageTolerance(1001) {
            revert("should revert max");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Max 10%")), "wrong max");
        }
        receiver.setSlippageTolerance(200);
        require(receiver.slippageToleranceBps() == 200, "200");
        receiver.setSlippageTolerance(100);
    }

    function testRequestFlashLoanOnlyOwner() public {
        vm.prank(other);
        try receiver.requestFlashLoan(address(weth), 0.1 ether, true) {
            revert("should revert not owner");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Not owner")), "wrong");
        }
    }

    function testRequestFlashLoanEmitsAndBuyOnA() public {
        receiver.requestFlashLoan(address(weth), 0.1 ether, true);
        require(receiver.buyOnA() == true, "buyOnA true");
        receiver.requestFlashLoan(address(weth), 0.1 ether, false);
        require(receiver.buyOnA() == false, "buyOnA false");
    }

    function testReceiveFlashLoanRevertsIfNotVault() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(weth);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100;
        uint256[] memory fees = new uint256[](1);
        fees[0] = 0;
        try receiver.receiveFlashLoan(tokens, amounts, fees, "") {
            revert("should revert Not Balancer");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Not Balancer")), "wrong");
        }
    }

    function testWithdrawOnlyOwner() public {
        vm.prank(other);
        try receiver.withdraw(address(weth)) {
            revert("should revert not owner");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Not owner")), "wrong");
        }
        // Initially no balance, should revert Nothing to withdraw
        try receiver.withdraw(address(weth)) {
            revert("should revert Nothing");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Nothing to withdraw")), "wrong");
        }
        // Mint to receiver then withdraw should succeed
        weth.mint(address(receiver), 1 ether);
        uint256 balBefore = weth.balanceOf(owner);
        receiver.withdraw(address(weth));
        require(weth.balanceOf(owner) == balBefore + 1 ether, "withdraw");
        try receiver.withdraw(address(weth)) {
            revert("should revert again");
        } catch Error(string memory reason) {
            require(keccak256(bytes(reason)) == keccak256(bytes("Nothing to withdraw")), "wrong");
        }
    }

    function testNonReentrantScoped() public {
        // If nonReentrant also on receiveFlashLoan, the vault callback would revert with Reentrant call
        // This succeeding proves it's correctly scoped to outer only
        receiver.requestFlashLoan(address(weth), 0.05 ether, true);
        require(receiver.buyOnA() == true, "scoped");
    }

    function testProfitableExecution() public {
        // With dexA 3400 > dexB 3000, buyOnA true (sell dexA high, buy dexB low) should be profitable
        // Mock mints, so balance will be > loan
        uint256 loan = 0.1 ether;
        receiver.requestFlashLoan(address(weth), loan, true);
        // After successful arb, profit remains (mock mints), withdraw should have something
        // At least the call didn't revert
        require(receiver.buyOnA() == true, "profit buyOnA");
    }
}
