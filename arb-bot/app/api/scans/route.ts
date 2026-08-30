import { NextResponse } from 'next/server';
import db from '../../../lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  
  try {
    const scans = db.prepare('SELECT * FROM scans ORDER BY ts DESC LIMIT ?').all(limit);
    return NextResponse.json({ scans });
  } catch (error) {
    console.error('Failed to fetch scans:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
