const { Router } = require("express");
const controller = require("./auth.controller");
const { verifyToken } = require("../../middleware/auth");

const router = Router();

router.post("/register", controller.register);
router.post("/login", controller.login);
router.get("/me", verifyToken, controller.me); // FR3: rehydrate ( The application restores its authentication state.) AuthContext on app re-load (clears the react memory/state but The browser may still have the authentication cookie/token stored in the browser's storage, like localStorage )
// AuthContext is a React mechanism used to keep the current user's login/authentication information available throughout the entire frontend.
// In this project it is implemented using React Context API ( shared data store for React components ) ( just a place to store application auth state )
// Normally, data in React is passed from a parent component to its child using props ( prop drilling )

router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

module.exports = router;
