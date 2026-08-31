const prisma = require("../../config/prisma");

async function getAuditHistory(req, res, next) {
  try {
    const { bookingId } = req.params;
    const logs = await prisma.auditLog.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAuditHistory };
