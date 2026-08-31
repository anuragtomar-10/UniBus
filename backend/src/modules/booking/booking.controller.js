const { holdSeat, releaseSeat } = require("./hold.service");
const { confirmBooking } = require("./confirm.service");
const { cancelBooking } = require("./cancel.service");
const { getBookingHistory } = require("./history.service");

async function hold(req, res, next) {
  try {
    const { tripId, seatNumber } = req.body;
    if (!tripId || !seatNumber) {
      return res.status(400).json({ error: "tripId and seatNumber required" });
    }
    const result = await holdSeat(tripId, seatNumber, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function confirm(req, res, next) {
  try {
    const { seatId, idempotencyKey, cardLast4, amount } = req.body;
    if (!seatId || !idempotencyKey) {
      return res.status(400).json({ error: "seatId and idempotencyKey required" });
    }
    const booking = await confirmBooking({
      seatId,
      userId: req.user.id,
      idempotencyKey,
      cardLast4,
      amount,
    });
    res.json({ booking });
  } catch (err) {
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const result = await cancelBooking(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

async function history(req, res, next) {
  try {
    const bookings = await getBookingHistory(req.user.id);
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
}

async function release(req, res, next) {
  try {
    const { tripId, seatNumber } = req.body;
    await releaseSeat(tripId, seatNumber, req.user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { hold, confirm, cancel, history, release };
