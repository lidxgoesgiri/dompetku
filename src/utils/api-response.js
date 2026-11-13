export function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
export function failure(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}
