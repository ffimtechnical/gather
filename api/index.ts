// The app's only Vercel function. Every /api/* address is sent here (see vercel.json),
// so the free Hobby plan's 12-function limit is never reached. All logic is in /server/http.ts.
import { route } from '../server/http.js';

export const GET = (request: Request) => route(request);
export const POST = (request: Request) => route(request);
export const OPTIONS = (request: Request) => route(request);
