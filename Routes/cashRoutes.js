import express from "express";
import {auth}  from "../Auth Middleware/auth.js";
import {
  getCashInHand,
  getCashLedger,
  addCashEntry
} from "../controllers/cashController.js";

const router = express.Router();

router.get("/in-hand", auth, getCashInHand);
router.get("/ledger", auth, getCashLedger);
router.post("/ledger", auth, addCashEntry);

export default router;   // IMPORTANT FIX
