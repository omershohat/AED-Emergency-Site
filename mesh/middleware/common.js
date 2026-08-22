// ============================================================================
//  Shared middleware for the mesh service.
//  Deliberately a copy of api/middleware/common.js rather than a shared package:
//  the two services are independent processes that must be able to start,
//  deploy and fail on their own. Duplicating ~30 lines is the cheaper price.
// ============================================================================

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`[mesh] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
  });
  next();
}

/** Forwards rejected promises from async route handlers to the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: 'הנתיב המבוקש לא נמצא', path: req.originalUrl });
}

/** Four arguments - this is what marks it as Express's error handler. */
export function errorHandler(err, req, res, _next) {
  console.error('[mesh] error:', err);
  res.status(err.status || 500).json({
    error: err.status === 502
      ? 'שירות הרישום אינו זמין כרגע'   // the api service is down
      : 'שגיאת שרת פנימית',
  });
}
