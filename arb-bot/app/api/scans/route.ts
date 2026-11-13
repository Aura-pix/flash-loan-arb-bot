import { NextResponse } from 'next/server';
import db from '../../../lib/db';
import { getNetworkConfig } from '../../../config/networks.js';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const cfg = getNetworkConfig();

  try {
    const scans = db
      .prepare(
        'SELECT * FROM scans WHERE network = ? ORDER BY ts DESC LIMIT ?'
      )
      .all(cfg.key, limit);
    return NextResponse.json({ scans, network: cfg.key });
  } catch (error) {
    console.error('Failed to fetch scans:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
