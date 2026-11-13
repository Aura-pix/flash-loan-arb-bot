import { ethers } from 'ethers';
import {
  getNetworkConfig,
  getStrategyConfig,
  isDryRun,
} from '../config/networks.js';
import { recordRun } from './events';
import {
  createExecution,
  updateExecution,
  type ExecutionStep,
  type ExecutionStatus,
} from './executions';

const ABI = [
  'function requestFlashLoan(address token, uint256 amount, bool buyOnA, uint256 minProfit) external',
  'function withdraw(address token) external',
  'function slippageToleranceBps() view returns (uint256)',
  'function dexA() view returns (address)',
  'function dexB() view returns (address)',
  'function tokenB() view returns (address)',
  'event LoanExecuted(address indexed token, uint256 amount, bool buyOnA)',
  'event StepCompleted(string step, uint256 amountOut)',
  'event ArbitrageResult(bool profitable, uint256 profit)',
  'event Withdrawn(address indexed token, uint256 amount)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function randomHash(): string {
  return (
    '0x' +
    Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
  );
}

function synthSteps(gasUsed: number, ts: number): ExecutionStep[] {
  return [
    {
      step: 'loan_taken',
      gasUsedCumulative: Math.floor(gasUsed * 0.25),
      timestamp: ts,
    },
    {
      step: 'swap_1',
      gasUsedCumulative: Math.floor(gasUsed * 0.55),
      timestamp: ts + 40,
    },
    {
      step: 'swap_2',
      gasUsedCumulative: Math.floor(gasUsed * 0.85),
      timestamp: ts + 80,
    },
    { step: 'repaid', gasUsedCumulative: gasUsed, timestamp: ts + 120 },
  ];
}

function stepsFromReceipt(
  receipt: ethers.TransactionReceipt,
  fallbackGas: number,
  ts: number
): ExecutionStep[] {
  const iface = new ethers.Interface(ABI);
  const parsed = receipt.logs
    .map((logItem) => {
      try {
        return iface.parseLog(logItem);
      } catch {
        return null;
      }
    })
    .filter((item): item is ethers.LogDescription => item !== null);

  const hasLoan = parsed.some((item) => item.name === 'LoanExecuted');
  const swapCount = parsed.filter((item) => item.name === 'StepCompleted').length;
  const hasResult = parsed.some((item) => item.name === 'ArbitrageResult');
  const gasUsed = Number(receipt.gasUsed) || fallbackGas;

  if (!hasLoan && swapCount === 0 && !hasResult) {
    return synthSteps(gasUsed, ts);
  }

  const steps: ExecutionStep[] = [];
  if (hasLoan) {
    steps.push({
      step: 'loan_taken',
      gasUsedCumulative: Math.floor(gasUsed * 0.2),
      timestamp: ts,
    });
  }
  if (swapCount >= 1) {
    steps.push({
      step: 'swap_1',
      gasUsedCumulative: Math.floor(gasUsed * 0.5),
      timestamp: ts + 50,
    });
  }
  if (swapCount >= 2) {
    steps.push({
      step: 'swap_2',
      gasUsedCumulative: Math.floor(gasUsed * 0.8),
      timestamp: ts + 100,
    });
  }
  if (hasResult) {
    steps.push({ step: 'repaid', gasUsedCumulative: gasUsed, timestamp: ts + 150 });
  }

  return steps.length > 0 ? steps : synthSteps(gasUsed, ts);
}

function extractProfitWeth(receipt: ethers.TransactionReceipt): number | null {
  const iface = new ethers.Interface(ABI);
  for (const logItem of receipt.logs) {
    try {
      const parsed = iface.parseLog(logItem);
      if (parsed && parsed.name === 'ArbitrageResult') {
        return Number(ethers.formatUnits(parsed.args[1], 18));
      }
    } catch {
      // Not one of our events.
    }
  }
  return null;
}

function validateAmount(amountWeth: string, minLoan: string, maxLoan: string) {
  const amount = Number(amountWeth);
  const min = Number(minLoan);
  const max = Number(maxLoan);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invalid loan amount');
  }
  if (amount < min || amount > max) {
    throw new Error(`Loan amount must be between ${minLoan} and ${maxLoan} WETH`);
  }
}

async function withdrawProfit(
  contract: ethers.Contract,
  wallet: ethers.Wallet,
  rpc: ReturnType<typeof getNetworkConfig>
): Promise<void> {
  const weth = new ethers.Contract(rpc.loanToken.address, ERC20_ABI, wallet);
  const balance = await weth.balanceOf(rpc.contractAddress);
  if (balance === BigInt(0)) return;
  const tx = await contract.withdraw(rpc.loanToken.address);
  await tx.wait();
}

/**
 * Execute the configured flash-loan arbitrage.
 *
 * Returns the transaction hash. In dry-run mode the hash is synthetic and no
 * transaction is sent. In live mode a missing wallet, RPC, contract address, or
 * deployed bytecode is a hard error (fail closed).
 */
export async function requestFlashLoan(
  amountWeth?: string,
  buyOnA?: boolean,
  minProfitWeth?: string
): Promise<string> {
  const cfg = getNetworkConfig();
  const strategy = getStrategyConfig();
  const dryRun = isDryRun();

  const loanSizeWeth = amountWeth || strategy.minLoanWeth;
  validateAmount(loanSizeWeth, strategy.minLoanWeth, strategy.maxLoanWeth);

  const buyOnAFlag = buyOnA ?? false;
  const minProfit = minProfitWeth || strategy.minNetProfitWeth;
  if (!Number.isFinite(Number(minProfit)) || Number(minProfit) < 0) {
    throw new Error('Invalid minProfit');
  }

  if (dryRun) {
    const txHash = randomHash();
    const now = Date.now();
    const steps: ExecutionStep[] = [
      { step: 'loan_taken', gasUsedCumulative: 0, timestamp: now },
      { step: 'swap_1', gasUsedCumulative: 0, timestamp: now + 100 },
      { step: 'swap_2', gasUsedCumulative: 0, timestamp: now + 200 },
      { step: 'repaid', gasUsedCumulative: 0, timestamp: now + 300 },
    ];
    createExecution(txHash, 'dry_run', steps);
    recordRun({
      network: cfg.key,
      txHash,
      status: 'dry_run',
      gasUsed: null,
      elapsedMs: 0,
      loanSizeWeth,
      profitWeth: null,
    });
    return txHash;
  }

  if (!cfg.rpcUrl) throw new Error(`RPC URL not configured (${cfg.rpcEnv || 'RPC'})`);
  if (!cfg.contractAddress) {
    throw new Error(`Contract address not configured (${cfg.contractEnv})`);
  }
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not configured');
  }

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const network = await provider.getNetwork();
  if (!cfg.skipChainCheck && Number(network.chainId) !== cfg.chainId) {
    throw new Error(
      `RPC chain ID ${Number(network.chainId)} does not match ${cfg.key} (${cfg.chainId})`
    );
  }

  const code = await provider.getCode(cfg.contractAddress);
  if (code === '0x') {
    throw new Error(`No contract bytecode at ${cfg.contractAddress}`);
  }

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(cfg.contractAddress, ABI, wallet);
  const amountWei = ethers.parseUnits(loanSizeWeth, 18);
  const minProfitWei = ethers.parseUnits(minProfit, 18);

  const startTime = Date.now();
  const gasEstimate = await contract.requestFlashLoan.estimateGas(
    cfg.loanToken.address,
    amountWei,
    buyOnAFlag,
    minProfitWei
  );
  const gasLimit = (gasEstimate * BigInt(120)) / BigInt(100);
  const tx = await contract.requestFlashLoan(
    cfg.loanToken.address,
    amountWei,
    buyOnAFlag,
    minProfitWei,
    { gasLimit }
  );

  createExecution(tx.hash, 'pending');

  void (async () => {
    try {
      const receipt = await tx.wait();
      if (!receipt) {
        updateExecution(tx.hash, 'error', []);
        recordRun({
          network: cfg.key,
          txHash: tx.hash,
          status: 'error',
          gasUsed: null,
          elapsedMs: Date.now() - startTime,
          loanSizeWeth,
          profitWeth: null,
        });
        return;
      }

      const ts = Date.now();
      const gasUsed = Number(receipt.gasUsed);

      if (receipt.status === 1) {
        const steps = stepsFromReceipt(receipt, gasUsed, ts);
        const profit = extractProfitWeth(receipt);
        updateExecution(tx.hash, 'success', steps);
        recordRun({
          network: cfg.key,
          txHash: tx.hash,
          status: 'success',
          gasUsed,
          elapsedMs: Date.now() - startTime,
          loanSizeWeth,
          profitWeth: profit,
        });
        try {
          await withdrawProfit(contract, wallet, cfg);
        } catch (err) {
          console.warn('Profit withdraw failed:', err);
        }
      } else {
        updateExecution(tx.hash, 'reverted', synthSteps(gasUsed, ts).slice(0, 1));
        recordRun({
          network: cfg.key,
          txHash: tx.hash,
          status: 'reverted',
          gasUsed,
          elapsedMs: Date.now() - startTime,
          loanSizeWeth,
          profitWeth: null,
        });
      }
    } catch (err: unknown) {
      const status: ExecutionStatus = 'error';
      updateExecution(tx.hash, status, []);
      recordRun({
        network: cfg.key,
        txHash: tx.hash,
        status,
        gasUsed: null,
        elapsedMs: Date.now() - startTime,
        loanSizeWeth,
        profitWeth: null,
      });
      console.error('Execution failed:', err);
    }
  })();

  return tx.hash;
}
