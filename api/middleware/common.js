// ============================================================================
//  Small shared middleware: request logging, async wrapper, error handler.
// ============================================================================

/**
 * Global middleware - runs for EVERY request, whatever the URL.
 * Order matters: it is registered before the routes, so it always runs first.
 */
export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  // 'finish' fires once the response has been sent, so we can log its status.
  res.on('finish', () => {
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();   // without next() the request would hang forever
}

/**
 * Express 4 does not catch rejected promises from async handlers - the request
 * would hang and nodemon would print an UnhandledPromiseRejection. This wrapper
 * forwards any rejection to the error handler below. Three lines instead of a
 * try/catch in every single route.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** 404 for anything no route matched. Registered after all routes. */
export function notFound(req, res) {
  res.status(404).json({ error: 'הנתיב המבוקש לא נמצא', path: req.originalUrl });
}

/**
 * The error handler. Express identifies it by its FOUR arguments - remove
 * `next` and it silently becomes a normal middleware that never runs.
 */
export function errorHandler(err, req, res, _next) {
  console.error('[api] error:', err);

  // MySQL tells us a UNIQUE constraint was violated; translate it into a
  // message the user can act on instead of a 500.
  if (err.code === 'ER_DUP_ENTRY') {
    const field = err.message.includes('phone') ? 'phone'
      : err.message.includes('lora_id') ? 'loraId' : 'unknown';
    return res.status(409).json({
      error: field === 'phone' ? 'מספר הנייד הזה כבר רשום במערכת'
        : field === 'loraId' ? 'מזהה ה-LoRa הזה כבר רשום במערכת'
          : 'הרשומה כבר קיימת',
      field,
    });
  }

  res.status(err.status || 500).json({
    error: err.expose ? err.message : 'שגיאת שרת פנימית',
  });
}
