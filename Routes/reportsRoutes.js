import express from "express";
import { getReportMeta,
  getMonthlyReport,
  getDailyReport,
  getDateRangeReport,
  getBankSummary,
  getOutstanding,
  getGstSummary,
  getMachineryReport} from "../controllers/reportsController.js";
import { auth } from "../Auth Middleware/auth.js";

const router = express.Router();
router.get("/meta", auth, getReportMeta);               // GET
router.post("/monthly", auth, getMonthlyReport);        // POST - accepts filters in body
router.get("/daily", auth, getDailyReport);             // GET
router.post("/range", auth, getDateRangeReport);        // POST
router.get("/bank-summary", auth, getBankSummary);      // GET?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get("/outstanding", auth, getOutstanding);       // GET
router.get("/gst", auth, getGstSummary);                // GET?month=YYYY-MM
router.get("/machinery", auth, getMachineryReport); 
export default router;
