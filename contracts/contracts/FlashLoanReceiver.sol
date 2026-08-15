// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

contract FlashLoanReceiver {
    address public owner;
    address public dexA;
    address public dexB;
    address public tokenB; // set at deploy time — no hardcoded mainnet address
    bool public buyOnA;

    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    // Basis points, e.g. 100 = 1%. Owner-adjustable per network's typical volatility.
    uint256 public slippageToleranceBps = 100;

    bool private locked;

    event LoanExecuted(address indexed token, uint256 amount, bool buyOnA);
    event StepCompleted(string step, uint256 amountOut);
    event ArbitrageResult(bool profitable, uint256 profit);
    event Withdrawn(address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _dexA, address _dexB, address _tokenB) {
        owner = msg.sender;
        dexA = _dexA;
        dexB = _dexB;
        tokenB = _tokenB;
    }

    function setSlippageTolerance(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "Max 10%");
        slippageToleranceBps = _bps;
    }

    function requestFlashLoan(address token, uint256 amount, bool _buyOnA)
        external
        onlyOwner
        nonReentrant
    {
        buyOnA = _buyOnA;

        address[] memory tokens = new address[](1);
        tokens[0] = token;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        IVault(BALANCER_VAULT).flashLoan(address(this), tokens, amounts, "");

        emit LoanExecuted(token, amount, _buyOnA);
    }

    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory /* userData */
    ) external {
        require(msg.sender == BALANCER_VAULT, "Not Balancer");

        address asset = tokens[0];
        uint256 amount = amounts[0];
        uint256 totalRepayment = amount + feeAmounts[0];

        address sellDex = buyOnA ? dexA : dexB;
        address buyDex = buyOnA ? dexB : dexA;

        // Step 1: asset -> tokenB on the higher-priced DEX
        address[] memory pathA = new address[](2);
        pathA[0] = asset;
        pathA[1] = tokenB;

        uint256 minOutA = _applySlippage(
            IUniswapV2Router(sellDex).getAmountsOut(amount, pathA)[1]
        );

        IERC20(asset).approve(sellDex, amount);
        uint256[] memory amountsA = IUniswapV2Router(sellDex).swapExactTokensForTokens(
            amount, minOutA, pathA, address(this), block.timestamp + 300
        );
        uint256 tokenBReceived = amountsA[amountsA.length - 1];
        emit StepCompleted("swap1", tokenBReceived);

        // Step 2: tokenB -> asset on the lower-priced DEX
        address[] memory pathB = new address[](2);
        pathB[0] = tokenB;
        pathB[1] = asset;

        uint256 minOutB = _applySlippage(
            IUniswapV2Router(buyDex).getAmountsOut(tokenBReceived, pathB)[1]
        );

        IERC20(tokenB).approve(buyDex, tokenBReceived);
        uint256[] memory amountsB = IUniswapV2Router(buyDex).swapExactTokensForTokens(
            tokenBReceived, minOutB, pathB, address(this), block.timestamp + 300
        );
        uint256 assetReceived = amountsB[amountsB.length - 1];
        emit StepCompleted("swap2", assetReceived);

        // Step 3: repay Balancer
        uint256 assetBalance = IERC20(asset).balanceOf(address(this));
        require(assetBalance >= totalRepayment, "Insufficient balance to repay flash loan");

        IERC20(asset).transfer(BALANCER_VAULT, totalRepayment);

        uint256 profit = assetBalance - totalRepayment;
        emit ArbitrageResult(profit > 0, profit);
    }

    function _applySlippage(uint256 expectedOut) internal view returns (uint256) {
        return expectedOut - ((expectedOut * slippageToleranceBps) / 10000);
    }

    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "Nothing to withdraw");
        IERC20(token).transfer(owner, balance);
        emit Withdrawn(token, balance);
    }
}
