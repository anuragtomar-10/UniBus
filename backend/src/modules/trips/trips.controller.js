const svc = require("./trips.service");

async function search(req, res, next) {
  try {
    const { date, time, destination } = req.query;
    const trips = await svc.searchTrips({ date, time, destination });
    res.json({ trips });
  } catch (err) {
    next(err);
  }
}

async function seatMap(req, res, next) {
  try {
    const data = await svc.getSeatMap(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function weeklySchedule(req, res, next) {
  try {
    const grouped = await svc.getWeeklyTrips();
    res.json(grouped);
  } catch (err) {
    next(err);
  }
}

module.exports = { search, seatMap, weeklySchedule };
