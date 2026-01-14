import express from "express";
import { auth } from "../Auth Middleware/auth.js";
import { getBankOnlineSummary, getBankBalances,getBankLedger } from "../controllers/bankController.js";

const router = express.Router();

router.get("/online-summary", auth, getBankOnlineSummary);
router.get("/balances", auth, getBankBalances);
router.get("/ledger",  getBankLedger);

export default router;
