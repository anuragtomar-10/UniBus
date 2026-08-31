const svc = require("./schedule.service");

async function listBaseTrips(req, res, next) {
  try {
    res.json({ trips: await svc.listBaseTrips() });
  } catch (err) { next(err); }
}

async function createBaseTrip(req, res, next) {
  try {
    const trip = await svc.createBaseTrip(req.body);
    res.status(201).json({ trip });
  } catch (err) { next(err); }
}

async function updateBaseTrip(req, res, next) {
  try {
    const trip = await svc.updateBaseTrip(req.params.id, req.body);
    res.json({ trip });
  } catch (err) { next(err); }
}

async function deleteBaseTrip(req, res, next) {
  try {
    await svc.deleteBaseTrip(req.params.id);
    res.json({ message: "Base trip deactivated" });
  } catch (err) { next(err); }
}

async function refreshSchedule(req, res, next) {
  try {
    const result = await svc.refreshWeeklySchedule();
    res.json({ result });
  } catch (err) { next(err); }
}

async function createSpecialTrip(req, res, next) {
  try {
    const trip = await svc.createSpecialTrip(req.body);
    res.status(201).json({ trip });
  } catch (err) { next(err); }
}

async function listBuses(req, res, next) {
  try {
    res.json({ buses: await svc.listBuses() });
  } catch (err) { next(err); }
}

async function listDrivers(req, res, next) {
  try {
    res.json({ drivers: await svc.listDrivers() });
  } catch (err) { next(err); }
}

module.exports = {
  listBaseTrips, createBaseTrip, updateBaseTrip, deleteBaseTrip,
  refreshSchedule, createSpecialTrip, listBuses, listDrivers,
};
