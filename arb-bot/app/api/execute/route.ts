import { NextResponse } from 'next/server';
import { requestFlashLoan } from '../../../lib/contract';
import {
  getStrategyConfig,
  isDryRun,
  isExecutorEnabled,
  isLiveExecutionEnabled,
} from '../../../config/networks.js';

type ExecuteBody = {
  amount?: unknown;
  buyOnA?: unknown;
  minProfit?: unknown;
};

export async function POST(request: Request) {
  try {
    if (!isExecutorEnabled()) {
      return NextResponse.json(
        { error: 'Manual execution disabled. Set EXECUTOR_ENABLED=true on the server to enable it.' },
        { status: 403 }
      );
    }

    const expectedToken = process.env.EXECUTOR_TOKEN;
    if (!expectedToken) {
      return NextResponse.json(
        { error: 'EXECUTOR_TOKEN is not configured on the server.' },
        { status: 503 }
      );
    }

    const providedToken = request.headers.get('x-executor-token');
    if (!providedToken || providedToken !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isDryRun() && !isLiveExecutionEnabled()) {
      return NextResponse.json(
        { error: 'Live execution disabled. Set ENABLE_LIVE_EXECUTION=true to allow real transactions.' },
        { status: 403 }
      );
    }

    let body: ExecuteBody = {};
    try {
      body = (await request.json()) as ExecuteBody;
    } catch {
      body = {};
    }

    const strategy = getStrategyConfig();
    const amount =
      typeof body.amount === 'string' || typeof body.amount === 'number'
        ? String(body.amount)
        : strategy.minLoanWeth;

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    if (
      amountNumber < Number(strategy.minLoanWeth) ||
      amountNumber > Number(strategy.maxLoanWeth)
    ) {
      return NextResponse.json(
        {
          error: `Amount must be between ${strategy.minLoanWeth} and ${strategy.maxLoanWeth} WETH`,
        },
        { status: 400 }
      );
    }

    if (typeof body.buyOnA !== 'boolean') {
      return NextResponse.json(
        { error: 'buyOnA must be a boolean' },
        { status: 400 }
      );
    }

    const minProfit =
      typeof body.minProfit === 'string' || typeof body.minProfit === 'number'
        ? String(body.minProfit)
        : undefined;

    const txHash = await requestFlashLoan(amount, body.buyOnA, minProfit);
    return NextResponse.json({ txHash, status: 'submitted' });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to trigger execution';
    console.error('Failed to trigger execution:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
