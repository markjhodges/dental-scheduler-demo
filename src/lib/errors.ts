export class AppError extends Error {
  constructor(public code: string, public status = 400, message = code) { super(message); }
}
export class UnknownOutcomeError extends Error {}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) return Response.json({error:'invalid_input',message:'Invalid request.'},{status:400});
  if (error instanceof AppError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  console.error('Request failed:', error);
  return Response.json({ error: 'server_error', message: 'The request could not be completed.' }, { status: 500 });
}
import { ZodError } from 'zod';

