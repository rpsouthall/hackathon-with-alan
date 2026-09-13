import { env } from 'cloudflare:workers';
import { hostedConfig } from '@/server/lesson/hosted';
import type { LessonRuntime } from '@/server/lesson/runtime';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return hostedConfig(request, env as unknown as LessonRuntime); }
