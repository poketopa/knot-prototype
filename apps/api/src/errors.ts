import type { FastifyReply, FastifyRequest } from 'fastify'

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message)
  }
}

export function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  const apiError = normalizeError(error)

  return reply.status(apiError.statusCode).send({
    code: apiError.code,
    message: apiError.message,
    retryable: apiError.retryable,
    requestId: request.id
  })
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error
  }
  if (isFastifyValidationError(error)) {
    return new ApiError(400, 'SCHEMA_VALIDATION_FAILED', 'Request schema validation failed')
  }
  if (isErrorWithStatus(error, 413)) {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload is too large')
  }
  if (isPgError(error, '22P02')) {
    return new ApiError(400, 'SCHEMA_VALIDATION_FAILED', 'Request schema validation failed')
  }
  if (isPgError(error, '23505')) {
    return new ApiError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'Resource already exists with a different payload'
    )
  }
  if (isPgError(error, '42501')) {
    return new ApiError(
      500,
      'DATABASE_PERMISSION_DENIED',
      'Server database permission is not configured correctly'
    )
  }
  return new ApiError(500, 'INTERNAL_ERROR', 'Internal error', true)
}

function isFastifyValidationError(error: unknown) {
  return typeof error === 'object' && error !== null && 'validation' in error
}

function isErrorWithStatus(error: unknown, statusCode: number) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === statusCode
  )
}

function isPgError(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
