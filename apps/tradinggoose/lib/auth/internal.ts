import { timingSafeEqual } from 'crypto'
import { jwtVerify, SignJWT } from 'jose'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CronAuth')

// Create a secret key for JWT signing
const getJwtSecret = () => {
  const secret = new TextEncoder().encode(env.INTERNAL_API_SECRET)
  return secret
}

export type InternalWorkflowExecutionContext = {
  source: 'workflow_block'
  parentWorkflowId?: string
  parentExecutionId?: string
  parentBlockId: string
}

type GenerateInternalTokenOptions = {
  workflowExecution?: InternalWorkflowExecutionContext
}

function isInternalWorkflowExecutionContext(
  value: unknown
): value is InternalWorkflowExecutionContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).source === 'workflow_block' &&
    typeof (value as Record<string, unknown>).parentBlockId === 'string' &&
    ((value as Record<string, unknown>).parentBlockId as string).length > 0
  )
}

/**
 * Generate an internal JWT token for server-side API calls
 * Token expires in 5 minutes to keep it short-lived
 * @param userId Optional user ID to embed in the token payload
 */
export async function generateInternalToken(
  userId?: string,
  options: GenerateInternalTokenOptions = {}
): Promise<string> {
  const secret = getJwtSecret()
  const payload: {
    type: 'internal'
    userId?: string
    workflowExecution?: InternalWorkflowExecutionContext
  } = { type: 'internal' }

  if (userId) {
    payload.userId = userId
  }
  if (options.workflowExecution) {
    payload.workflowExecution = options.workflowExecution
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer('tradinggoose-internal')
    .setAudience('tradinggoose-api')
    .sign(secret)

  return token
}

/**
 * Structured verification result for internal JWTs.
 */
export interface InternalTokenVerificationResult {
  valid: boolean
  userId?: string
  workflowExecution?: InternalWorkflowExecutionContext
}

/**
 * Verify an internal JWT token and return structured metadata.
 */
export async function verifyInternalTokenDetailed(
  token: string
): Promise<InternalTokenVerificationResult> {
  try {
    const secret = getJwtSecret()

    const { payload } = await jwtVerify(token, secret, {
      issuer: 'tradinggoose-internal',
      audience: 'tradinggoose-api',
    })

    // Check that it's an internal token
    if (payload.type === 'internal') {
      return {
        valid: true,
        userId: typeof payload.userId === 'string' ? payload.userId : undefined,
        workflowExecution: isInternalWorkflowExecutionContext(payload.workflowExecution)
          ? payload.workflowExecution
          : undefined,
      }
    }

    return { valid: false }
  } catch (error) {
    // Token verification failed
    return { valid: false }
  }
}

function isExpectedCronToken(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)

  // timingSafeEqual throws on a length mismatch, which would leak the secret's
  // length through the difference between a thrown error and a false result.
  if (providedBytes.length !== expectedBytes.length) {
    return false
  }

  return timingSafeEqual(providedBytes, expectedBytes)
}

/**
 * Verify CRON authentication for scheduled API endpoints
 * Returns null if authorized, or a NextResponse with error if unauthorized
 */
export function verifyCronAuth(request: NextRequest, context?: string): NextResponse | null {
  const authHeader = request.headers.get('authorization')
  const secret = env.CRON_SECRET?.trim()

  // CRON_SECRET is optional in the env schema, and interpolating an unset one
  // produced the literal string 'Bearer undefined' as the expected header —
  // which any caller could simply send. A deployment without the secret has no
  // cron caller to authenticate, so the endpoints stay closed instead.
  if (!secret) {
    const contextInfo = context ? ` for ${context}` : ''
    logger.warn(`CRON endpoint called${contextInfo} but CRON_SECRET is not configured`, {
      context,
    })

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!authHeader || !isExpectedCronToken(authHeader, `Bearer ${secret}`)) {
    const contextInfo = context ? ` for ${context}` : ''
    logger.warn(`Unauthorized CRON access attempt${contextInfo}`, {
      providedAuth: authHeader,
      ip: request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown',
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      context,
    })

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
