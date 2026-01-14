import express from "express";
import { auth } from "../Auth Middleware/auth.js";

/**
 * IMPORT FROM THE CORRECT FILE
 */
import {
  getDailyMonthReport,
  getCreditOutstandingReport,
  getGoodsSaleReport,
  getExpenseReport
} from "../controllers/reportDailyController.js";

const router = express.Router();

/* ================= REPORT ROUTES ================= */

router.get("/daily-month", auth, getDailyMonthReport);
router.get("/credit-outstanding", auth, getCreditOutstandingReport);
router.get("/goods-sale", auth, getGoodsSaleReport);
router.get("/expenses", auth, getExpenseReport);

export default router;
