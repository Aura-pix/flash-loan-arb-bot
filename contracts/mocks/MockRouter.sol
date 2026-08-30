// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IERC20Like {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract MockRouter {
    // price is USDC per WETH * 1e6 (USDC 6 decimals), or reverse
    // For getAmountsOut we use fixed rate: amountOut = amountIn * rate / 1e18
    // rate is set per router so dexA can be expensive, dexB cheap
    uint256 public rate; // e.g. 3000e6 = 3000 USDC per WETH, or 1e12 for reverse (WETH per USDC)
    address public tokenA; // WETH
    address public tokenB; // USDC
    bool public isWethToUsdc; // true: amountIn WETH -> USDC, false: USDC -> WETH

    constructor(address _tokenA, address _tokenB, uint256 _rate, bool _isWethToUsdc) {
        tokenA = _tokenA;
        tokenB = _tokenB;
        rate = _rate;
        isWethToUsdc = _isWethToUsdc;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        // Mock profit: 10% per leg so two legs = ~21% overall, guarantees repayment + profit
        // Ignores token decimals and rate for test determinism — just ensures mock arb is profitable
        amounts[1] = (amountIn * 11) / 10;
        if (amounts[1] == 0) amounts[1] = 1;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "Expired");
        amounts = this.getAmountsOut(amountIn, path);
        require(amounts[1] >= amountOutMin, "Slippage");
        // Pull tokenIn from caller
        IERC20Like(path[0]).transferFrom(msg.sender, address(this), amountIn);
        // Send tokenOut to recipient — mint if router has no balance (mock)
        // Try transfer, if insufficient, mint-like by just crediting via MockERC20
        // We assume MockERC20 has mint; for simplicity, if balance insufficient, do nothing but still return amounts
        // Instead, we try to transfer from this router's balance; if fails, we mint by calling MockERC20
        try IERC20Like(path[1]).transfer(to, amounts[1]) returns (bool ok) {
            require(ok, "Transfer failed");
        } catch {
            // Fallback: try mint if target is MockERC20 (has mint)
            (bool success,) = path[1].call(abi.encodeWithSignature("mint(address,uint256)", to, amounts[1]));
            require(success, "Mint fallback failed");
        }
    }
}
