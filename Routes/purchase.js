import express from "express";
import { auth } from "../Auth Middleware/auth.js";
import {
  addPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
} from "../controllers/purchaseController.js";

const router = express.Router();

router.post("/", auth, addPurchase);
router.get("/", auth, getPurchases);
router.get("/:id", auth, getPurchaseById);
router.put("/:id", auth, updatePurchase);
router.delete("/:id", auth, deletePurchase);
export default router;
