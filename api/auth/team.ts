// Vercel serverless function. All logic lives in /server/http.ts.
import { route } from '../../server/http.js';

export const GET = (request: Request) => route(request);
export const POST = (request: Request) => route(request);
export const OPTIONS = (request: Request) => route(request);
