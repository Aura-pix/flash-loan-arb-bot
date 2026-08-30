import { NextResponse } from 'next/server';
import { requestFlashLoan } from '../../../lib/contract';

export async function POST(request: Request) {
  try {
    const txHash = await requestFlashLoan();
    return NextResponse.json({ txHash, status: 'submitted' });
  } catch (error) {
    console.error('Failed to trigger execution:', error);
    return NextResponse.json({ error: 'Failed to trigger execution' }, { status: 500 });
  }
}
