import { NextResponse } from 'next/server';
import { getExecution } from '../../../../lib/executions';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get('txHash');

  if (!txHash) {
    return NextResponse.json({ error: 'Missing txHash' }, { status: 400 });
  }

  const execution = getExecution(txHash);
  if (!execution) {
    return NextResponse.json(
      { error: 'Transaction not found or not tracked' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    txHash,
    status: execution.status,
    steps: execution.steps.slice(0, execution.currentStep),
  });
}
