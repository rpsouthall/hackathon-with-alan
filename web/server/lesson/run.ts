import { createLessonServer } from './server';
const port = Number(process.env.LESSON_PORT || 8790);
const app = createLessonServer();
app.server.listen(port, '127.0.0.1', () => console.log(`Lesson service: http://127.0.0.1:${port} (local preview only)`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close(); });
