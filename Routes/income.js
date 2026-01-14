import express from "express";
import { auth as verifyToken } from "../Auth Middleware/auth.js";
import { addIncome, getIncomes, deleteIncome } from "../controllers/incomeController.js";

const router = express.Router();

router.post("/add", verifyToken, addIncome);
router.get("/list", verifyToken, getIncomes);
router.delete("/delete/:id", verifyToken, deleteIncome);

export default router;