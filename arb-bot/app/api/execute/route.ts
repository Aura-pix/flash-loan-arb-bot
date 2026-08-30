import { NextResponse } from 'next/server';
import { requestFlashLoan } from '../../../lib/contract';

export async function POST(request: Request) {
  try {
    let amount: string | undefined;
    let buyOnA: boolean | undefined;
    try {
      const body = await request.json();
      amount = body.amount;
      buyOnA = body.buyOnA;
    } catch {}
    const txHash = await requestFlashLoan(amount, buyOnA);
    return NextResponse.json({ txHash, status: 'submitted' });
  } catch (error: any) {
    console.error('Failed to trigger execution:', error);
    return NextResponse.json({ error: error.message || 'Failed to trigger execution' }, { status: 500 });
  }
}
