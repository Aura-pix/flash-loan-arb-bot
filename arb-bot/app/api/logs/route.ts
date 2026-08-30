import { NextResponse } from 'next/server';
import db from '../../../lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  
  try {
    const runs = db.prepare('SELECT * FROM runs ORDER BY ts DESC LIMIT ?').all(limit);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error('Failed to fetch runs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
