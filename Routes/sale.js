import express from "express";
import { auth } from "../Auth Middleware/auth.js";

import {
  addSale,
  getSales,
  // getNextInvoice,
  updateSale,
  deleteSale
  ,
  getSaleById
} from "../controllers/salesController.js";



const router = express.Router();

// CREATE A SALE
router.post("/", auth, addSale);
router.get("/",auth,getSales )
// router.get("/next-invoice", getNextInvoice);
router.put("/:id", updateSale);
router.delete("/:id", deleteSale);
router.get("/:id", getSaleById);

export default router;
