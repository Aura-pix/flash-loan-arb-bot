import { NextResponse } from 'next/server';
import { activeSimulations } from '../../../../lib/contract';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const txHash = searchParams.get('txHash');

  if (!txHash) {
    return NextResponse.json({ error: 'Missing txHash' }, { status: 400 });
  }

  const sim = activeSimulations.get(txHash);
  if (!sim) {
    return NextResponse.json({ error: 'Transaction not found or not tracked' }, { status: 404 });
  }

  return NextResponse.json({
    txHash,
    status: sim.status,
    steps: sim.steps.slice(0, sim.currentStep),
  });
}
