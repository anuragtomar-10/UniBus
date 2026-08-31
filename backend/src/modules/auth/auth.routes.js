const { Router } = require("express");
const controller = require("./auth.controller");
const { verifyToken } = require("../../middleware/auth");

const router = Router();

router.post("/register", controller.register);
router.post("/login", controller.login);
router.get("/me", verifyToken, controller.me); // FR3: rehydrate AuthContext on app load
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

module.exports = router;
