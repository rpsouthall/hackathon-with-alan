import type { EventEmitter } from 'node:events';

export type LessonSocket = Pick<EventEmitter, 'on' | 'once'> & {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
};
export type SocketFactory = (url: string, options: { headers?: Record<string, string>; maxPayload?: number }) => LessonSocket;
