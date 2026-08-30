// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IReceiver {
    function receiveFlashLoan(address[] memory tokens, uint256[] memory amounts, uint256[] memory feeAmounts, bytes memory userData) external;
}

interface IERC20Mint {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function mint(address to, uint256 amount) external;
}

contract MockVault {
    // Fee is 0 like Balancer
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external {
        uint256[] memory feeAmounts = new uint256[](tokens.length);
        for (uint i = 0; i < tokens.length; i++) feeAmounts[i] = 0;

        // Fund recipient with the loan amount (mint if needed)
        for (uint i = 0; i < tokens.length; i++) {
            // Try to transfer from vault, else mint
            uint256 bal = IERC20Mint(tokens[i]).balanceOf(address(this));
            if (bal >= amounts[i]) {
                IERC20Mint(tokens[i]).transfer(recipient, amounts[i]);
            } else {
                // Mint directly to recipient
                IERC20Mint(tokens[i]).mint(recipient, amounts[i]);
            }
        }

        IReceiver(recipient).receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        // After callback, recipient should have repaid via transfer to this vault
        // No further check here — FlashLoanReceiver does its own repayment
    }
}
