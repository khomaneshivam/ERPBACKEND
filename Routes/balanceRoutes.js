import express from "express";
import { getTotalBalances } from "../controllers/balanceController.js";
import { auth } from "../Auth Middleware/auth.js";

const router = express.Router();

router.get("/balances", auth, getTotalBalances);

export default router;
