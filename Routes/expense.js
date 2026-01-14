import express from "express";
import { auth } from "../Auth Middleware/auth.js";
import {
  addExpense,
  getExpenses,
  updateExpense,
  deleteExpense,
  getExpenseById
} from "../controllers/expenseController.js";

const router = express.Router();

router.post("/", auth, addExpense);
router.get("/", auth, getExpenses);
router.get("/:id", auth, getExpenseById);   // 🔥 THIS ONE
router.put("/:id", auth, updateExpense);
router.delete("/:id", auth, deleteExpense);
export default router;
