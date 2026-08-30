import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', network: 'sepolia', chainId: 11155111 });
}
