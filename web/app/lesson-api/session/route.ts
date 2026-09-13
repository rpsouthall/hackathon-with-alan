import { env, waitUntil } from 'cloudflare:workers';
import { hostedSession } from '@/server/lesson/hosted';
import type { LessonRuntime } from '@/server/lesson/runtime';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return hostedSession(request, env as unknown as LessonRuntime, waitUntil); }
