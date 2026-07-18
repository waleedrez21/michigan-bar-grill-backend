function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.publicMessage || "Something went wrong. Please try again or call the restaurant directly.",
  });
}

module.exports = errorHandler;
