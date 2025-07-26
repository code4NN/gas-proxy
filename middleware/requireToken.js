export function requireToken(req, res, next) {
    const token = req.headers['x-api-token'];
    if (token !== process.env.PRIVATE_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
