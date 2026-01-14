import express from "express";
import { auth } from "../Auth Middleware/auth.js";
import {
  getSalesOutstanding,
  getPurchaseOutstanding,
getPaymentHistory,
  receivePayment,
  receivePurchasePayment   // 🔥 ADD THIS
} from "../controllers/paymentsController.js";

const router = express.Router();

router.get("/sales-outstanding", auth, getSalesOutstanding);
router.get("/purchase-outstanding", auth, getPurchaseOutstanding);

router.post("/receive", auth, receivePayment);   // CUSTOMER PAYMENT
router.post("/purchase-receive", auth, receivePurchasePayment); // 🔥 SUPPLIER PAYMENT
router.get("/history",  getPaymentHistory);

export default router;
