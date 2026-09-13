import { env } from 'cloudflare:workers';
import { hostedConnect } from '@/server/lesson/hosted';
import type { LessonRuntime } from '@/server/lesson/runtime';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return hostedConnect(request, env as unknown as LessonRuntime); }
