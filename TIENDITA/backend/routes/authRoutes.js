const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/authController");

router.post("/register", ctrl.register);
router.post("/login", ctrl.login);
router.get("/google-config", ctrl.googleConfig);
router.post("/google", ctrl.googleLogin);

module.exports = router;
